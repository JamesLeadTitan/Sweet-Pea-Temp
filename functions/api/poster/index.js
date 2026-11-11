// POST: upload a poster from the editor (needs login). Body is the image itself.
// Posters are kept in the same KV store as the calendar, under "poster:<id>".
import { json, isAdmin } from '../../_lib/cal.js';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 4 * 1024 * 1024;

export async function onRequestPost({ env, request }) {
  if (!(await isAdmin(env, request))) return json({ error: 'login' }, 401);
  if (!env.CAL) return json({ error: 'no-storage' }, 503);
  const type = (request.headers.get('content-type') || '').split(';')[0].trim();
  if (!TYPES.includes(type)) return json({ error: 'type' }, 415);
  const buf = await request.arrayBuffer();
  if (!buf.byteLength || buf.byteLength > MAX) return json({ error: 'size' }, 413);
  const id = crypto.randomUUID().replace(/-/g, '');
  await env.CAL.put('poster:' + id, buf, { metadata: { type, t: Date.now() } });
  return json({ ok: true, id });
}
