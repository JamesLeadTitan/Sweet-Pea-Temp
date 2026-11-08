// GET: the calendar for the homepage. PUT: save from the editor (needs login).
// Needs a KV binding called CAL in Cloudflare Pages.
import { json, isAdmin, loadCalendar, cleanCalendar } from '../_lib/cal.js';

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
  return json({ ok: true, data });
}
