// Is a store link safe to open? Checked when someone adds or changes a link, and shown to
// everyone who later opens that gift, since the person most at risk is the one who clicks.
//
// Never blocks anything: it warns. Two kinds of checks:
//
//   On the link itself (instant, no network): http instead of https, a bare number address,
//   letters from another alphabet that imitate ours, a big store's name on someone else's site,
//   a name one letter off a big store's, short links that hide where they go, and endings
//   that scam stores favor.
//
//   Looked up (server only, a few seconds at most, remembered for six hours): whether any
//   website answers at that name, whether its security certificate checks out, how long ago the
//   name was registered (public RDAP records, rdap.org), and, when LISTS_SAFE_BROWSING_KEY is
//   set, whether Google Safe Browsing lists it as a scam or harmful site.
//
// The answer: { level: 'ok' | 'caution' | 'danger', host, site, store, notes: [text...] }.
// `site` is the website's own name (amazon.com for www.amazon.com); `store` names a big store
// when the link really goes to it.
import tls from 'node:tls';
import net from 'node:net';
import { promises as dns } from 'node:dns';
import { safeLookup, getText, whereTo, Blocked } from './meta.js';
import { devMode } from './dev.js';

const DEADLINE = 4000;
// Local tests only: LISTS_LINKCHECK_OFFLINE=1 keeps to the instant checks, so the test suites
// never reach out to real websites. Works only inside dev/server.mjs (see dev.js).
const offline = () => devMode() && process.env.LISTS_LINKCHECK_OFFLINE === '1';
const DAY = 864e5;

// Big stores, by website name. Their own short links count as theirs.
const STORES = {
  'amazon.com': 'Amazon', 'amazon.ca': 'Amazon', 'amazon.co.uk': 'Amazon', 'a.co': 'Amazon', 'amzn.to': 'Amazon', 'amzn.com': 'Amazon',
  'target.com': 'Target', 'walmart.com': 'Walmart', 'bestbuy.com': 'Best Buy', 'lego.com': 'LEGO', 'rei.com': 'REI',
  'etsy.com': 'Etsy', 'etsy.me': 'Etsy', 'kohls.com': "Kohl's", 'costco.com': 'Costco', 'homedepot.com': 'Home Depot',
  'lowes.com': "Lowe's", 'macys.com': "Macy's", 'nordstrom.com': 'Nordstrom', 'ebay.com': 'eBay', 'ebay.us': 'eBay',
  'wayfair.com': 'Wayfair', 'dickssportinggoods.com': "Dick's", 'barnesandnoble.com': 'Barnes & Noble', 'apple.com': 'Apple',
  'nike.com': 'Nike', 'zappos.com': 'Zappos', 'chewy.com': 'Chewy', 'sephora.com': 'Sephora', 'ulta.com': 'Ulta',
  'samsclub.com': "Sam's Club", 'michaels.com': 'Michaels', 'hobbylobby.com': 'Hobby Lobby', 'basspro.com': 'Bass Pro',
  'cabelas.com': "Cabela's", 'llbean.com': 'L.L.Bean', 'patagonia.com': 'Patagonia', 'oldnavy.com': 'Old Navy', 'gap.com': 'Gap',
  'potterybarn.com': 'Pottery Barn', 'crateandbarrel.com': 'Crate & Barrel', 'williams-sonoma.com': 'Williams Sonoma',
  'uncommongoods.com': 'Uncommon Goods', 'bookshop.org': 'Bookshop', 'temu.com': 'Temu', 'shein.com': 'Shein',
  'aliexpress.com': 'AliExpress', 'kroger.com': 'Kroger', 'meijer.com': 'Meijer', 'menards.com': 'Menards', 'scheels.com': 'Scheels'
};
// The word each big store goes by in a web address, for spotting imitations.
const WORDS = [...new Set(Object.keys(STORES).filter(d => d.split('.')[0].length >= 4).map(d => d.split('.')[0]))];
const SHORT = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at',
  'tiny.cc', 'rb.gy', 'shorte.st', 'bl.ink', 'lnkd.in', 's.id']);
// Endings that show up most in lists of scam and junk sites (Spamhaus and others).
const RISKY_ENDINGS = new Set(['zip', 'mov', 'top', 'xyz', 'click', 'gq', 'tk', 'ml', 'cf', 'ga', 'cfd', 'sbs', 'bond', 'cyou',
  'icu', 'buzz', 'rest', 'monster', 'quest', 'country', 'kim', 'work', 'support']);
// Country endings where the website name takes three parts (shop.co.uk, not co.uk).
const TWO_PART = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'com.br', 'com.mx',
  'co.in', 'com.cn', 'co.za', 'com.sg', 'com.tr', 'co.kr']);
const CERT_ERRORS = new Set(['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID', 'CERT_REVOKED', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_UNTRUSTED']);

// The website's own name: shop.example.co.uk -> example.co.uk, www.amazon.com -> amazon.com.
export function siteOf(host) {
  const parts = String(host || '').toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  return TWO_PART.has(last2) ? parts.slice(-3).join('.') : last2;
}

// Swaps that make one name read like another: 0 for o, 1 for l, rn for m, vv for w.
const plainLetters = s => s.replace(/0/g, 'o').replace(/[1|]/g, 'l').replace(/rn/g, 'm').replace(/vv/g, 'w');

function oneOff(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a === b) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) === 1;
}

const LEVELS = ['ok', 'caution', 'danger'];
const worst = notes => notes.reduce((l, n) => (LEVELS.indexOf(n.level) > LEVELS.indexOf(l) ? n.level : l), 'ok');
// Notes at level ok are plain facts ("This short link goes to amazon.com.").
const result = (host, site, store, notes) => ({
  level: worst(notes), host, site, store, notes: notes.map(n => n.text), codes: notes.map(n => n.code), levels: notes.map(n => n.level)
});

// ---------------------------------------------------------------- checks on the link itself

const memo = new Map();
export function localCheck(raw) {
  if (memo.has(raw)) return memo.get(raw);
  let u;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const site = net.isIP(host) ? host : siteOf(host);
  const store = STORES[site] || '';
  const notes = [];
  const add = (level, code, text) => notes.push({ level, code, text });

  if (u.protocol === 'http:') {
    add('caution', 'insecure', 'This link is not secure: it starts with http, not https. Do not type a password or card number on that page.');
  }
  if (net.isIP(host)) {
    add('danger', 'number', 'This link goes to a number instead of a website name. Real stores use their name.');
  } else {
    if (u.port && u.port !== '80' && u.port !== '443') {
      add('caution', 'port', 'This link has an unusual number after the website name. Store pages almost never do.');
    }
    if (host.split('.').some(p => p.startsWith('xn--'))) {
      add('danger', 'alphabet', 'This website name uses letters from another alphabet that can look like ours, so it may not be the site it looks like.');
    }
    if (!store) {
      const label = site.split('.')[0];
      const tokens = host.split(/[.-]/);
      // A big store's full name early in the address, with the real site at the end: amazon.com.deals.io
      const inside = Object.keys(STORES).find(d => host.startsWith(d + '.') || host.includes('.' + d + '.'));
      const word = WORDS.find(w => tokens.includes(w));
      const typo = WORDS.find(w => w.length >= 5 && (plainLetters(label) === w || (w.length >= 6 && oneOff(label, w))));
      if (inside) {
        add('danger', 'inside', `This link starts like ${inside}, but it really goes to ${site}. That is a common trick.`);
      } else if (typo) {
        const real = Object.keys(STORES).find(d => d.startsWith(typo + '.'));
        add('danger', 'typo', `This website name is almost the same as ${real}, but not quite. Check the spelling: scam sites use names like this.`);
      } else if (word) {
        const real = Object.keys(STORES).find(d => d.startsWith(word + '.'));
        add('caution', 'borrowed', `This link has ${STORES[real]} in its name, but it goes to ${site}, not ${real}. Scam stores often borrow a big store's name.`);
      }
    }
    if (SHORT.has(site)) add('caution', 'short', 'This is a short link, so it does not show where it really goes.');
    const ending = host.split('.').pop();
    if (RISKY_ENDINGS.has(ending)) add('caution', 'ending', `Web addresses that end in .${ending} are often used by scam stores. Be careful.`);
  }
  const out = result(host, site, store, notes);
  if (memo.size > 2000) memo.clear();
  memo.set(raw, out);
  return out;
}

// ---------------------------------------------------------------- checks that look things up

const timeLeft = deadline => Math.max(0, deadline - Date.now());

// Does the site's certificate check out? Connects to port 443 and stops after the handshake.
// 'ok', 'bad', 'private', or null when the site did not answer clearly (tried twice).
async function certCheck(host, deadline) {
  const first = await certOnce(host, deadline);
  return first === null && timeLeft(deadline) > 500 ? certOnce(host, deadline) : first;
}
function certOnce(host, deadline) {
  return new Promise(resolve => {
    let done = false;
    let timer = null;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); sock.destroy(); resolve(v); } };
    const sock = tls.connect({ host, port: 443, servername: host, lookup: safeLookup, rejectUnauthorized: true, ALPNProtocols: ['http/1.1'] });
    timer = setTimeout(() => finish(null), timeLeft(deadline));
    sock.once('secureConnect', () => finish('ok'));
    sock.once('error', e => finish(e && CERT_ERRORS.has(e.code) ? 'bad' : e instanceof Blocked ? 'private' : null));
  });
}

// When the website name was registered, from the public RDAP records. null when unknown.
async function registered(site, deadline) {
  try {
    const r = await getText(`https://rdap.org/domain/${encodeURIComponent(site)}`, 'application/rdap+json, application/json', deadline, 200_000);
    if (r.status !== 200) return null;
    const data = JSON.parse(r.text);
    const ev = (data.events || []).find(e => /registration/i.test(e.eventAction || ''));
    const t = ev ? Date.parse(ev.eventDate) : NaN;
    return Number.isFinite(t) ? t : null;
  } catch { return null; }
}

// Google Safe Browsing (free for non-commercial use; needs a key from Google Cloud).
async function googleSays(url, deadline) {
  const key = process.env.LISTS_SAFE_BROWSING_KEY;
  if (!key) return null;
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(Math.max(1, timeLeft(deadline))),
      body: JSON.stringify({
        client: { clientId: 'family-wish-list', clientVersion: '1.0' },
        threatInfo: { threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
          platformTypes: ['ANY_PLATFORM'], threatEntryTypes: ['URL'], threatEntries: [{ url }] }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.matches) && data.matches.length > 0;
  } catch { return null; }
}

const looked = new Map();      // scheme and host -> { at, notes } for six hours
const lastCert = new Map();
const KEEP = 6 * 3600e3;

async function lookedUp(u, host, site, deadline) {
  const key = `${u.protocol}//${host}`;
  const hit = looked.get(key);
  if (hit && Date.now() - hit.at < KEEP) return hit.notes;
  const notes = [];
  const add = (level, code, text) => notes.push({ level, code, text });
  let answers = true;
  try { await dns.lookup(host); } catch (e) {
    if (e && (e.code === 'ENOTFOUND' || e.code === 'ENODATA')) answers = false;
  }
  if (!answers) {
    add('caution', 'nosite', 'No website answers at this address. Check the spelling.');
  } else {
    const [cert, born] = await Promise.all([
      u.protocol === 'https:' ? certCheck(host, deadline) : Promise.resolve(null),
      registered(site, deadline)
    ]);
    lastCert.set(host, cert);
    if (cert === 'private') add('danger', 'private', 'This website name points into a private network, not the public internet. Do not trust it.');
    if (cert === 'bad') add('danger', 'certificate', 'This website\'s security certificate does not check out, so it may not be the site it claims to be.');
    if (born) {
      const days = Math.floor((Date.now() - born) / DAY);
      if (days < 30) add('danger', 'new', `This website was set up ${days === 1 ? '1 day' : `${days} days`} ago. Brand new stores are a common sign of a scam.`);
      else if (days < 180) add('caution', 'new', `This website is only ${Math.max(1, Math.round(days / 30))} months old. Newer stores can be fine, but check reviews before you buy.`);
    }
  }
  // Remember a clear answer only. A site that did not answer this time is asked again next time.
  const clear = !answers || u.protocol !== 'https:' || notes.some(n => n.code === 'certificate') || lastCert.get(host) === 'ok';
  if (looked.size > 500) { looked.clear(); lastCert.clear(); }
  if (clear) looked.set(key, { at: Date.now(), notes });
  return notes;
}

// The full check. Never throws: anything that cannot be looked up in time is skipped.
export async function checkLink(raw, { deadline = Date.now() + DEADLINE } = {}) {
  const local = localCheck(raw);
  if (!local) return null;
  const u = new URL(raw);
  if (net.isIP(local.host) || offline()) return local;
  const notes = local.notes.map((text, i) => ({ text, code: local.codes[i], level: local.levels[i] }));
  const add = (level, code, text) => notes.push({ level, code, text });
  let { site, store } = local;
  try {
    const [more, flagged] = await Promise.all([lookedUp(u, local.host, local.site, deadline), googleSays(raw, deadline)]);
    notes.push(...more);
    if (flagged) add('danger', 'flagged', 'Google lists this website as dangerous (scams or harmful software). Do not open it.');
    // A short link: say where it really goes, and check that address too.
    if (local.codes.includes('short')) {
      const to = await whereTo(raw, deadline).catch(() => null);
      const there = to && new URL(to).hostname !== u.hostname ? localCheck(to) : null;
      if (there) {
        const i = notes.findIndex(n => n.code === 'short');
        notes[i] = { level: there.level === 'ok' ? 'ok' : 'caution', code: 'short', text: `This short link goes to ${there.site}.` };
        there.notes.forEach((text, k) => add(there.levels[k], there.codes[k], text));
        ({ site, store } = there);
      }
    }
  } catch { /* out of time, or nothing useful came back: keep what is known */ }
  return result(local.host, site, store, notes);
}

// What is kept with a gift and sent to the page: the level, the website, and the notes.
export const forPage = c => (c ? { level: c.level, site: c.site, store: c.store || '', notes: c.notes.filter((n, i) => !c.levels || c.levels[i] !== 'ok' || c.level === 'ok') } : null);
