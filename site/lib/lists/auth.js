// Wish list sign-in. Nobody has a password. A person types their email, gets a link and a
// six digit code, and either one signs them in. After that a signed cookie keeps that
// device signed in for 400 days (the most a browser allows).
//
// Settings (Vercel env vars, never in a file):
//   LISTS_SECRET   long random string that signs links and cookies. Changing it signs
//                  everyone out everywhere.
//
// Each person has a version number (`ver`). The admin's "Sign out everywhere" bumps it, which
// voids every cookie and link that person was given before.
import { createHash, createHmac, randomInt, timingSafeEqual } from 'node:crypto';

const COOKIE = 'wl_session';
const SESSION_MAX_AGE = 400 * 24 * 60 * 60;   // seconds
export const LINK_MINUTES = 60;
export const CODE_TRIES = 5;

function secret() {
  const s = process.env.LISTS_SECRET || '';
  return s.length >= 32 ? s : null;
}
export const isConfigured = () => Boolean(secret());

const mac = (kind, payload) => createHmac('sha256', secret()).update(`${kind}.${payload}`).digest('base64url');

function same(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// A token is base64url(JSON) plus a signature. `kind` keeps a link from working as a
// cookie and the other way round.
function seal(kind, obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
  return `${payload}.${mac(kind, payload)}`;
}
function unseal(kind, token) {
  if (!secret() || typeof token !== 'string' || token.length > 800) return null;
  const i = token.lastIndexOf('.');
  if (i < 1) return null;
  const payload = token.slice(0, i);
  if (!same(mac(kind, payload), token.slice(i + 1))) return null;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
}

// ---------------------------------------------------------------- email link

export function linkToken(person, now = Date.now()) {
  return seal('link', { p: person.id, v: person.ver || 0, x: now + LINK_MINUTES * 60_000 });
}

export function personForLink(state, token, now = Date.now()) {
  const t = unseal('link', token);
  if (!t || typeof t.x !== 'number' || t.x < now) return null;
  const p = state.people.find(x => x.id === t.p);
  return p && p.email && (p.ver || 0) === t.v ? p : null;
}

// ---------------------------------------------------------------- six digit code

export function newCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}
export function codeHash(person, code) {
  return createHash('sha256').update(`${secret()}.${person.id}.${person.ver || 0}.${code}`).digest('base64url');
}
// True when `code` matches. The caller counts tries and clears the code.
export function codeMatches(person, code, now = Date.now()) {
  const c = person.code;
  if (!c || typeof c.h !== 'string' || c.x < now || (c.n || 0) >= CODE_TRIES) return false;
  return same(c.h, codeHash(person, String(code).replace(/\D/g, '').slice(0, 6)));
}

// ---------------------------------------------------------------- session cookie

export function sessionCookie(person, now = Date.now()) {
  const value = seal('session', { p: person.id, v: person.ver || 0, t: now });
  return `${COOKIE}=${value}; Path=/; Max-Age=${SESSION_MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearedCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

// The signed-in person, or null. Needs the current state so a removed person, or one
// the admin signed out everywhere, is turned away even with a cookie that still verifies.
export function personForRequest(request, state, now = Date.now()) {
  const raw = request.headers.get('cookie') || '';
  const pair = raw.split(/;\s*/).find(p => p.startsWith(COOKIE + '='));
  if (!pair) return null;
  const t = unseal('session', pair.slice(COOKIE.length + 1));
  if (!t || typeof t.t !== 'number' || now - t.t > SESSION_MAX_AGE * 1000 || t.t > now + 60_000) return null;
  const p = state.people.find(x => x.id === t.p);
  return p && p.email && (p.ver || 0) === t.v ? p : null;
}
