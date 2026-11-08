// Shared by the calendar and login functions.

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

// ---------- login cookie ----------
const COOKIE = 'sp_admin';
const DAYS = 30;

async function sign(secret, msg) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function checkPassword(env, given) {
  if (!env.ADMIN_PASSWORD || typeof given !== 'string') return false;
  // compare hashes so the check takes the same time whatever is typed
  return same(await sign('pw', given), await sign('pw', env.ADMIN_PASSWORD));
}

export async function loginCookie(env) {
  const exp = Date.now() + DAYS * 864e5;
  const v = exp + '.' + (await sign(env.ADMIN_PASSWORD, 'sp-admin|' + exp));
  return `${COOKIE}=${v}; Path=/; Max-Age=${DAYS * 86400}; HttpOnly; Secure; SameSite=Strict`;
}
export const logoutCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export async function isAdmin(env, request) {
  if (!env.ADMIN_PASSWORD) return false;
  const m = (request.headers.get('cookie') || '').match(/(?:^|;\s*)sp_admin=(\d+)\.([0-9a-f]{64})/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return same(m[2], await sign(env.ADMIN_PASSWORD, 'sp-admin|' + m[1]));
}

// ---------- calendar data ----------
export async function loadCalendar(env, request) {
  if (env.CAL) {
    const saved = await env.CAL.get('calendar', 'json');
    if (saved) return saved;
  }
  const r = await env.ASSETS.fetch(new URL('/calendar-default.json', request.url));
  return r.json();
}

const str = (v, n) => String(v == null ? '' : v).replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, n);
const time = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const num = (v, lo, hi) => (typeof v === 'number' && v >= lo && v <= hi ? Math.round(v * 1e5) / 1e5 : null);
const colour = (v) => (/^#[0-9a-fA-F]{6}$/.test(v) ? v : '#622A3C');

// Checks everything sent from the editor. Anything odd is dropped rather than saved.
export function cleanCalendar(sp) {
  if (!sp || typeof sp !== 'object') throw new Error('bad data');
  const out = { locs: {}, order: [], weekly: {}, monthly: [], events: [], changes: [] };

  const keys = Object.keys(sp.locs || {}).filter((k) => /^[a-z0-9-]{1,30}$/.test(k)).slice(0, 40);
  for (const k of keys) {
    const l = sp.locs[k] || {};
    const name = str(l.name, 80);
    if (!name) continue;
    out.locs[k] = {
      name,
      short: str(l.short, 30) || name.slice(0, 30),
      addr: str(l.addr, 150),
      lat: num(l.lat, 49, 61),
      lng: num(l.lng, -9, 3),
      col: colour(l.col),
      regular: str(l.regular, 200),
    };
    const note = str(l.note, 150);
    if (note) out.locs[k].note = note;
  }
  const has = (k) => Object.prototype.hasOwnProperty.call(out.locs, k);
  out.order = (Array.isArray(sp.order) ? sp.order : []).filter(has);
  for (const k of Object.keys(out.locs)) if (!out.order.includes(k)) out.order.push(k);

  for (let d = 0; d < 7; d++) {
    const rows = ((sp.weekly || {})[d] || [])
      .filter((r) => Array.isArray(r) && has(r[0]) && time(r[1]) && time(r[2]))
      .slice(0, 10)
      .map((r) => [r[0], r[1], r[2]]);
    if (rows.length) out.weekly[d] = rows;
  }

  out.monthly = (sp.monthly || [])
    .filter((m) => m && has(m.loc) && [1, 2, 3, 4, -1].includes(m.n) && m.dow >= 0 && m.dow <= 6 && time(m.from) && time(m.to))
    .slice(0, 20)
    .map((m) => ({ loc: m.loc, n: m.n, dow: m.dow, from: m.from, to: m.to }));

  // dated items: keep the last 60 days and everything ahead
  const cutoff = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  out.events = (sp.events || [])
    .filter((e) => e && day(e.date) && e.date >= cutoff && time(e.from) && time(e.to) && (has(e.loc) || str(e.name, 80)))
    .slice(0, 300)
    .map((e) => {
      const o = { date: e.date, from: e.from, to: e.to };
      if (has(e.loc)) o.loc = e.loc;
      else {
        o.name = str(e.name, 80);
        o.addr = str(e.addr, 150);
        const lat = num(e.lat, 49, 61), lng = num(e.lng, -9, 3);
        if (lat != null && lng != null) { o.lat = lat; o.lng = lng; }
      }
      const note = str(e.note, 150);
      if (note) o.note = note;
      return o;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  out.changes = (sp.changes || [])
    .filter((c) => c && day(c.date) && c.date >= cutoff && has(c.loc))
    .slice(0, 300)
    .map((c) => {
      const o = { date: c.date, loc: c.loc };
      if (c.closed) o.closed = true;
      else {
        if (time(c.from)) o.from = c.from;
        if (time(c.to)) o.to = c.to;
      }
      const note = str(c.note, 150);
      if (note) o.note = note;
      return o;
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return out;
}
