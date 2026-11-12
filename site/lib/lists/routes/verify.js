// The link in the sign-in email.
//
// GET ?t=<token>   checks the link and sends the browser to /lists#t=<token>. It does not sign
//                  anyone in. Some email services open every link in a message ahead of time
//                  to scan it; if this GET signed in and used up the link, the person would
//                  find it already spent.
// POST { t }       the page sends the token back from its own address bar. This signs the
//                  device in and uses the link up, so it works once.
import { json, redirect, isSameSiteJson, readJson, BAD } from '../http.js';
import { isConfigured, personForLink, sessionCookie } from '../auth.js';
import { readState, updateState } from '../store.js';

const EXPIRED = { error: 'expired', message: 'That sign-in link has run out, was already used, or was replaced by a newer one. Type your email to get a new code.' };

export async function GET(request) {
  if (!isConfigured()) return redirect('/lists?signin=off');
  const token = new URL(request.url).searchParams.get('t') || '';
  try {
    const { state } = await readState();
    if (!personForLink(state, token)) return redirect('/lists?signin=expired');
    return redirect(`/lists#t=${encodeURIComponent(token)}`);
  } catch (e) {
    console.error('verify failed', e);
    return redirect('/lists?signin=error');
  }
}

export async function POST(request) {
  if (!isConfigured()) return json({ error: 'not_configured', message: 'Sign-in is not set up yet.' }, 503);
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request, 2048);
  const token = body && typeof body.t === 'string' ? body.t : '';
  try {
    const now = Date.now();
    const { state } = await readState();
    if (!personForLink(state, token, now)) return json(EXPIRED, 401);
    const { extra } = await updateState(s => {
      const p = personForLink(s, token, now);
      if (!p) return null;
      p.linkAt = null;          // used: this link, and the code sent with it, stop working
      p.code = null;
      return { id: p.id, ver: p.ver || 0 };
    });
    if (!extra) return json(EXPIRED, 401);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(extra, now) });
  } catch (e) {
    console.error('verify failed', e);
    return json({ error: 'server_error', message: 'Sign-in is having trouble right now. Try again in a few minutes.' }, 500);
  }
}
