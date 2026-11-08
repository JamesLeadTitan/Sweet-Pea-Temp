// Works out a basket's prices and delivery. Used by the basket on the page AND by the
// checkout function (functions/api/checkout.js), so what the customer sees is what Stripe charges.
// All money is in pence.

export const MAX_QTY = 50;

export function repeatPrice(shop, unit) {
  const d = Number(shop.repeat && shop.repeat.discount_percent) || 0;
  return Math.round(unit * (100 - d) / 100);
}

// basket: { items: [{ key, qty, repeat }], method: 'collect' | 'local' | 'post', point }
export function quote(shop, basket) {
  const lines = [];
  for (const it of (basket && basket.items) || []) {
    const p = shop.products[it && it.key];
    const qty = Math.floor(Number(it && it.qty));
    if (!p || !(qty >= 1)) continue;
    const repeat = !!(it.repeat && p.repeat);
    const q = Math.min(qty, MAX_QTY);
    const unit = repeat ? repeatPrice(shop, p.price) : p.price;
    lines.push({ key: it.key, name: p.name, qty: q, unit, repeat, post: !!p.post, total: unit * q });
  }
  const sum = (ls) => ls.reduce((a, l) => a + l.total, 0);
  const bags = (ls) => ls.reduce((a, l) => a + l.qty, 0);
  const repeatLines = lines.filter((l) => l.repeat);
  const D = shop.delivery;

  // Delivery cost for a set of lines. null means "price not set yet".
  function fee(method, ls) {
    if (!ls.length || method === 'collect') return 0;
    if (method === 'local') return sum(ls) >= D.local.free_over ? 0 : D.local.price;
    if (method === 'post') return D.post.price_per_bag == null ? null : D.post.price_per_bag * bags(ls);
    return 0;
  }

  const canPost = lines.length > 0 && lines.every((l) => l.post);
  const method = ['collect', 'local', 'post'].includes(basket && basket.method) ? basket.method : 'collect';
  const errors = [];
  if (!lines.length) errors.push('empty');
  if (method === 'post' && !canPost) errors.push('post-not-allowed');
  if (method === 'collect' && !D.collect.points.includes(basket && basket.point)) errors.push('no-point');

  const all = fee(method, lines);
  const rep = repeatLines.length ? fee(method, repeatLines) : 0;
  const tbc = all == null || rep == null;
  // Repeat orders pay their own delivery every time. Anything extra today covers the one-off items.
  const deliveryRepeat = tbc ? null : rep;
  const deliveryToday = tbc ? null : rep + Math.max(0, all - rep);

  const subtotal = sum(lines);
  return {
    lines,
    method,
    point: method === 'collect' ? basket.point : '',
    subtotal,
    repeatSubtotal: sum(repeatLines),
    hasRepeat: repeatLines.length > 0,
    canPost,
    tbc,
    deliveryToday,
    deliveryRepeat,
    totalToday: tbc ? null : subtotal + deliveryToday,
    totalRepeat: tbc ? null : sum(repeatLines) + deliveryRepeat,
    freeLocalGap: method === 'local' ? Math.max(0, D.local.free_over - subtotal) : 0,
    errors,
  };
}

export function money(p) {
  // £35 rather than £35.00, but £2.25 stays as it is
  return '£' + (p % 100 ? (p / 100).toFixed(2) : String(p / 100));
}

// Plain text order, used for WhatsApp and for Claire's Stripe notes
export function orderText(shop, q) {
  const out = q.lines.map((l) => `${l.qty} x ${l.name}${l.repeat ? ' (' + shop.repeat.label.toLowerCase() + ')' : ''}`);
  if (q.method === 'collect') out.push('Collect from: ' + q.point);
  else out.push(shop.delivery[q.method].label);
  return out.join('\n');
}
