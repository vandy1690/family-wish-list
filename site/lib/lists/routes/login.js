// POST { email }        -> emails a sign-in link and a six digit code
// POST { email, code }  -> checks the code and signs this device in
//
// The answer to the first is the same whether or not the address is on the list, so
// the page cannot be used to find out who is.
//
// The very first sign-in: while nobody is on the list yet, LISTS_ADMIN_EMAIL may sign in
// and becomes the admin, named LISTS_ADMIN_NAME (default "Admin"; it can be changed on People).
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { isConfigured, linkToken, newCode, codeHash, codeMatches, sessionCookie, LINK_MINUTES } from '../auth.js';
import { readState, updateState, storageConfigured } from '../store.js';
import { normEmail, newId } from '../rules.js';
import { sendSignIn, mailConfigured } from '../mail.js';
import { siteInfo } from '../site.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const RESEND_AFTER = 45_000;          // one email per address per 45 seconds
const DAILY_SENDS = 10;               // and no more than this many a day
const sent = site => ({
  ok: true,
  message: 'Check your email. If that address is on the list, a sign-in link and code are on the way. ' +
           `Nothing after five minutes? Check spam, then ask ${site.adminName} to add this address.`
});

export async function POST(request) {
  if (!isConfigured() || !storageConfigured() || !mailConfigured()) {
    return json({ error: 'not_configured', message: 'Sign-in is not set up yet. Let the person who runs this list know.' }, 503);
  }
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request);
  const email = normEmail(body && body.email);
  if (!email || !email.includes('@')) return json({ error: 'invalid', message: 'Enter your email address.' }, 400);
  try {
    return body.code !== undefined ? await checkCode(email, body.code) : await sendLink(request, email);
  } catch (e) {
    console.error('login failed', e);
    return json({ error: 'server_error', message: 'Sign-in is having trouble. Try again in a moment.' }, 500);
  }
}

async function sendLink(request, email) {
  const now = Date.now();
  const admin = normEmail(process.env.LISTS_ADMIN_EMAIL);
  const { state } = await readState();
  const found = state.people.find(p => p.email === email);
  const bootstrap = !found && state.people.length === 0 && admin && email === admin;
  const site = siteInfo(state);
  const SENT = sent(site);
  if (!found && !bootstrap) { await sleep(300 + Math.random() * 500); return json(SENT); }
  if (found && found.linkAt && now - found.linkAt < RESEND_AFTER) return json(SENT);

  const code = newCode();
  const { extra: p } = await updateState(s => {
    let p = s.people.find(x => x.email === email);
    if (!p && bootstrap && s.people.length === 0) {
      p = { id: newId(), name: (process.env.LISTS_ADMIN_NAME || 'Admin').slice(0, 40), email, admin: true,
            managers: [], parentsSee: false, about: '', ver: 0, createdAt: now };
      s.people.push(p);
    }
    if (!p) return null;
    const day = new Date(now).toISOString().slice(0, 10);
    const sends = p.sends && p.sends.d === day ? p.sends.n : 0;
    if (sends >= DAILY_SENDS) return null;
    p.sends = { d: day, n: sends + 1 };
    p.linkAt = now;
    p.code = { h: codeHash(p, code), x: now + LINK_MINUTES * 60_000, n: 0 };
    return { id: p.id, name: p.name, email: p.email, ver: p.ver || 0 };
  });
  if (!p) return json(SENT);

  const origin = process.env.LISTS_ORIGIN || new URL(request.url).origin;
  const link = `${origin}/api/lists/verify?t=${encodeURIComponent(linkToken(p, now))}`;
  try {
    const r = await sendSignIn({ to: p.email, name: p.name, link, code, minutes: LINK_MINUTES, site: bootstrap ? { ...site, adminName: p.name } : site });
    return json(r.dev ? { ...SENT, dev: r.dev } : SENT);
  } catch (e) {
    console.error('mail failed', e);
    return json({ error: 'mail_failed', message: `The email could not be sent. Try again in a minute, or let ${site.adminName} know.` }, 502);
  }
}

async function checkCode(email, code) {
  const now = Date.now();
  const wrong = async () => {
    await sleep(600);
    return json({ error: 'wrong_code', message: 'That code is not right, or it has run out. Use the newest email, or send a new code.' }, 401);
  };
  const { state } = await readState();
  const found = state.people.find(p => p.email === email);
  if (!found || !found.code) return wrong();
  const { extra } = await updateState(s => {
    const p = s.people.find(x => x.email === email);
    if (!p || !p.code) return null;
    if (codeMatches(p, code, now)) { p.code = null; return { id: p.id, ver: p.ver || 0, email: p.email }; }
    p.code.n = (p.code.n || 0) + 1;
    return null;
  });
  if (!extra) return wrong();
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(extra, now) });
}
