// POST {}  signs this device out. Only this site's own page can ask (same check as every
// other change), so another site cannot sign someone out behind their back.
import { clearedCookie } from '../auth.js';
import { json, isSameSiteJson, BAD } from '../http.js';

export async function POST(request) {
  if (!isSameSiteJson(request)) return json(BAD, 400);
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() });
}
