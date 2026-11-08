// Login for the calendar editor. The password is the ADMIN_PASSWORD secret in Cloudflare Pages.
import { json, checkPassword, loginCookie, logoutCookie, isAdmin } from '../_lib/cal.js';

export async function onRequestGet({ env, request }) {
  return json({ in: await isAdmin(env, request) });
}

export async function onRequestPost({ env, request }) {
  let body = {};
  try { body = await request.json(); } catch {}
  if (body.logout) return json({ in: false }, 200, { 'set-cookie': logoutCookie() });
  if (!(await checkPassword(env, body.password))) {
    await new Promise((r) => setTimeout(r, 800)); // slows down guessing
    return json({ in: false, error: 'wrong' }, 401);
  }
  return json({ in: true }, 200, { 'set-cookie': await loginCookie(env) });
}
