// GET ?t=<token>  The link in the sign-in email. Signs this device in and opens the list.
import { redirect } from '../http.js';
import { isConfigured, personForLink, sessionCookie } from '../auth.js';
import { readState } from '../store.js';

export async function GET(request) {
  if (!isConfigured()) return redirect('/lists?signin=off');
  const token = new URL(request.url).searchParams.get('t') || '';
  try {
    const { state } = await readState();
    const p = personForLink(state, token);
    if (!p) return redirect('/lists?signin=expired');
    return redirect('/lists?signin=ok', { 'Set-Cookie': sessionCookie(p) });
  } catch (e) {
    console.error('verify failed', e);
    return redirect('/lists?signin=error');
  }
}
