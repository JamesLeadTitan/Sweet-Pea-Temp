// GET: the calendar for the homepage. PUT: save from the editor (needs login).
// Needs a KV binding called CAL in Cloudflare Pages.
import { json, isAdmin, loadCalendar, cleanCalendar, postersIn } from '../_lib/cal.js';

export async function onRequestGet({ env, request }) {
  return json(await loadCalendar(env, request));
}

export async function onRequestPut({ env, request }) {
  if (!(await isAdmin(env, request))) return json({ error: 'login' }, 401);
  if (!env.CAL) return json({ error: 'no-storage' }, 503);
  let data;
  try {
    data = cleanCalendar(await request.json());
  } catch {
    return json({ error: 'bad-data' }, 400);
  }
  // keep the last version so a mistake can be undone
  const old = await env.CAL.get('calendar');
  if (old) await env.CAL.put('calendar-previous', old);
  await env.CAL.put('calendar', JSON.stringify(data));
  try { await tidyPosters(env, data, old ? JSON.parse(old) : null); } catch {}
  return json({ ok: true, data });
}

// Delete posters no longer used by this save or the backup. Anything uploaded in the
// last day is kept, in case it belongs to changes that have not been saved yet.
async function tidyPosters(env, now, prev) {
  const keep = postersIn(now);
  postersIn(prev).forEach((id) => keep.add(id));
  const dayAgo = Date.now() - 864e5;
  let cursor;
  do {
    const page = await env.CAL.list({ prefix: 'poster:', cursor });
    for (const k of page.keys) {
      const id = k.name.slice(7);
      const t = (k.metadata && k.metadata.t) || 0;
      if (!keep.has(id) && t < dayAgo) await env.CAL.delete(k.name);
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
}
