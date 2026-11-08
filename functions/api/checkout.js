// Turns the basket into a Stripe Checkout page.
// Needs one secret in Cloudflare Pages (Settings, Variables and Secrets): STRIPE_SECRET_KEY.
// Prices always come from /shop.json on the server, never from the browser.
import { quote, orderText } from '../../shop-calc.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function loadShop(env, request) {
  const r = await env.ASSETS.fetch(new URL('/shop.json', request.url));
  if (!r.ok) throw new Error('shop.json missing');
  return r.json();
}

// Stripe takes form encoding with nested keys, e.g. line_items[0][quantity]=2
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') encode(v, key, out);
    else out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}

const clip = (s, n) => (s.length > n ? s.slice(0, n - 3) + '...' : s);

export function buildSession(shop, q, origin) {
  const R = shop.repeat;
  const recurring = { interval: R.interval, interval_count: R.interval_count };
  const items = q.lines.map((l) => ({
    quantity: l.qty,
    price_data: {
      currency: shop.currency,
      unit_amount: l.unit,
      product_data: { name: l.repeat ? `${l.name} (${R.label.toLowerCase()})` : l.name },
      recurring: l.repeat ? recurring : undefined,
    },
  }));

  const label = q.method === 'collect' ? '' : shop.delivery[q.method].label;
  const extraToday = q.deliveryToday - q.deliveryRepeat;
  if (q.deliveryRepeat > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: shop.currency,
        unit_amount: q.deliveryRepeat,
        product_data: { name: `${label} (${R.label.toLowerCase()})` },
        recurring,
      },
    });
  }
  if (extraToday > 0) {
    items.push({
      quantity: 1,
      price_data: {
        currency: shop.currency,
        unit_amount: extraToday,
        product_data: { name: q.hasRepeat ? `${label} (one-off items)` : label },
      },
    });
  }

  const text = orderText(shop, q);
  const meta = {
    delivery: q.method === 'collect' ? 'Collect' : label,
    collect_from: q.point || undefined,
    order: clip(text.replace(/\n/g, ' | '), 500),
  };
  const heard = shop.heard.map((h) => ({ label: clip(h, 100), value: h.replace(/[^A-Za-z0-9]/g, '').slice(0, 100) }));

  const p = {
    mode: q.hasRepeat ? 'subscription' : 'payment',
    line_items: items,
    success_url: origin + '/dog-food?order=done',
    cancel_url: origin + '/dog-food?basket=open',
    locale: 'en-GB',
    allow_promotion_codes: true,
    phone_number_collection: { enabled: true },
    custom_fields: [
      { key: 'dogname', label: { type: 'custom', custom: "Your dog's name" }, type: 'text', optional: true },
      {
        key: 'heard',
        label: { type: 'custom', custom: 'How did you hear about us?' },
        type: 'dropdown',
        dropdown: { options: heard },
        optional: true,
      },
    ],
    custom_text: {
      submit: {
        message:
          q.method === 'collect'
            ? `You will collect your order from ${q.point}. We will message you when it is ready.`
            : q.method === 'local'
              ? 'Local delivery is for homes within about 3 miles of one of our places. We will message you to book a time.'
              : 'We post 12kg bags anywhere in the UK. We will message you when it is on its way.',
      },
    },
    metadata: meta,
  };
  if (q.method !== 'collect') p.shipping_address_collection = { allowed_countries: ['GB'] };
  if (q.hasRepeat) p.subscription_data = { description: clip(text, 500), metadata: meta };
  else p.payment_intent_data = { description: clip(text, 1000), metadata: meta };
  return p;
}

export async function onRequestGet({ env }) {
  return json({ ready: !!env.STRIPE_SECRET_KEY });
}

export async function onRequestPost({ request, env }) {
  if (!env.STRIPE_SECRET_KEY) return json({ error: 'not-ready' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad-request' }, 400);
  }
  const shop = await loadShop(env, request);
  const q = quote(shop, body);
  if (q.errors.length) return json({ error: q.errors[0] }, 400);
  if (q.tbc) return json({ error: 'delivery-price-not-set' }, 400);
  const lineCount = q.lines.length + 2;
  if (lineCount > 20) return json({ error: 'too-many-lines' }, 400);

  const origin = new URL(request.url).origin;
  const res = await fetch((env.STRIPE_API_BASE || 'https://api.stripe.com') + '/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + env.STRIPE_SECRET_KEY,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encode(buildSession(shop, q, origin)),
  });
  const data = await res.json();
  if (!res.ok) {
    console.log('Stripe error', JSON.stringify(data.error || data));
    return json({ error: 'stripe', message: (data.error && data.error.message) || 'Stripe error' }, 502);
  }
  return json({ url: data.url });
}
