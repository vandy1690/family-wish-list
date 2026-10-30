// POST { name, email, note } from the sign-in page: asks the admin to add this person.
//
// The admin stays the gatekeeper: a request only puts a name on their People page; nobody can
// sign in until they are added. The answer is the same whether or not the address is already on the
// list, so this cannot be used to find out who is.
//
// Guards against a stranger or a bot filling it: a hidden "website" field people never see
// (anything in it is quietly dropped), at most LIMITS.requests waiting at once, one entry per
// email (a second request updates the first), and at most MAIL_PER_DAY emails to the admin a day.
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { readState, updateState, storageConfigured } from '../store.js';
import { cleanJoinRequest, newId, LIMITS, OpError } from '../rules.js';
import { sendJoinRequest } from '../mail.js';
import { siteInfo } from '../site.js';

const MAIL_PER_DAY = 10;
const sent = site => ({
  ok: true,
  message: `Thanks. ${site.adminName} will see your request. Once you are added, sign in here with that email.`
});

export async function POST(request) {
  if (!storageConfigured()) return json({ error: 'not_configured', message: 'This is not set up yet.' }, 503);
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request, 4096);
  if (!body) return json(BAD, 400);
  let req;
  try { req = cleanJoinRequest(body); } catch (e) {
    if (e instanceof OpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
  if (typeof body.website === 'string' && body.website.trim()) return json(sent(siteInfo(null)));   // the hidden field: a bot

  const now = Date.now();
  try {
    const { state } = await readState();
    const site = siteInfo(state);
    if (state.people.some(p => p.email === req.email)) return json(sent(site));       // already on the list
    const { extra } = await updateState(s => {
      s.requests = s.requests || [];
      if (s.people.some(p => p.email === req.email)) return null;
      const old = s.requests.find(r => r.email === req.email);
      if (old) { Object.assign(old, { name: req.name, note: req.note, at: now }); return null; }
      if (s.requests.length >= LIMITS.requests) return null;
      s.requests.push({ id: newId(), ...req, at: now });
      const day = new Date(now).toISOString().slice(0, 10);
      const m = s.settings && s.settings.requestMail;
      const n = m && m.d === day ? m.n : 0;
      if (n >= MAIL_PER_DAY) return null;
      s.settings = { ...(s.settings || {}), requestMail: { d: day, n: n + 1 } };
      return req;
    });
    if (extra) {
      const origin = process.env.LISTS_ORIGIN || new URL(request.url).origin;
      try { await sendJoinRequest({ ...extra, link: `${origin}/lists?view=people`, site }); }
      catch (e) { console.error('request mail failed', e && e.message); }   // the request is saved either way
    }
    return json(sent(site));
  } catch (e) {
    console.error('request failed', e);
    return json({ error: 'server_error', message: 'That did not go through. Try again in a moment.' }, 500);
  }
}
