import { clearedCookie } from '../auth.js';
import { json } from '../http.js';

export async function POST() {
  return json({ ok: true }, 200, { 'Set-Cookie': clearedCookie() });
}
