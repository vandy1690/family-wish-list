// "Fill in from link": reads a product page once, the way a chat app builds a link
// preview, and pulls out the name, photo and price the page publishes for that purpose
// (Open Graph tags and schema.org Product data).
//
// The legal line (a firm rule for this app): it names itself honestly, honors the
// store's robots.txt, and never tries to get past a block. If a store says no, or answers
// with a robot check, the page says so and the person uses the Add button on the store's
// page instead, which reads the page they are already looking at in their own browser.
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import { devMode } from './dev.js';

const AGENT = 'FamilyWishList';
const UA = `${AGENT}/1.0 (+${(process.env.LISTS_ORIGIN || 'https://github.com/vandy1690/family-wish-list').replace(/\/$/, '')}${process.env.LISTS_ORIGIN ? '/lists' : ''}; family wish list link preview)`;
const TIMEOUT = 8000;               // the whole lookup: robots.txt, redirects and both bodies
const MAX_BYTES = 1_500_000;
const MAX_ROBOTS = 500_000;         // the most of a robots.txt that is read, as Google does

export class Blocked extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

// ---------------------------------------------------------------- address safety

// Every address that is not the public internet: private networks, this machine, link-local,
// shared and test ranges, multicast, and the IPv6 forms that can carry an IPv4 address inside
// them (compatible, NAT64, 6to4, Teredo), so none of those can be used to reach inside. An
// IPv4 address written the IPv6 way (::ffff:10.0.0.1) is checked against the IPv4 ranges by
// BlockList itself.
const PRIVATE = new net.BlockList();
for (const [net4, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) PRIVATE.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64],
  ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) PRIVATE.addSubnet(net6, bits, 'ipv6');

export function privateIp(ip) {
  const family = net.isIP(ip);
  if (!family) return true;
  return PRIVATE.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

// Only public web addresses on the normal ports. Stops the lookup being pointed at
// anything inside Vercel's network.
// Local tests only: LISTS_LOOKUP_ALLOW_LOCAL=1 lets the lookup read a stand-in store on
// 127.0.0.1, so the tests never depend on a real store. Works only inside dev/server.mjs.
const allowLocal = url => devMode() && process.env.LISTS_LOOKUP_ALLOW_LOCAL === '1' && url.hostname === '127.0.0.1';

function assertPublic(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Blocked('scheme');
  if (url.username || url.password) throw new Blocked('private');
  if (allowLocal(url)) return;
  if (url.port && url.port !== '443' && url.port !== '80') throw new Blocked('port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (privateIp(host)) throw new Blocked('private'); return; }
  if (!host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) throw new Blocked('private');
}

// The address check happens inside the connection's own name lookup, so the address that
// was checked is the one connected to. A store's name cannot be switched to a private address
// between a check and the request.
export function safeLookup(hostname, options, callback) {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return callback(err);
    if (!addrs.length || addrs.some(a => privateIp(a.address))) return callback(new Blocked('private'));
    if (options && options.all) return callback(null, addrs);
    callback(null, addrs[0].address, addrs[0].family);
  });
}

// One GET, no redirects followed, the body cut off at `max` bytes. Rejects with Blocked.
function getOnce(url, accept, deadline, max) {
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) { reject(new Blocked('unreachable')); return; }
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); fn(v); } };
    const fail = e => done(reject, e instanceof Blocked ? e : new Blocked('unreachable'));
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(url, {
      method: 'GET', lookup: safeLookup, agent: false,
      headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8', 'Accept-Encoding': 'gzip, deflate, br' }
    }, res => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        done(resolve, { status, location: res.headers.location });
        req.destroy();
        return;
      }
      const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
      const body = enc === 'gzip' || enc === 'x-gzip' ? res.pipe(zlib.createGunzip())
        : enc === 'deflate' ? res.pipe(zlib.createInflate())
        : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
      const chunks = [];
      let size = 0;
      const finish = () => done(resolve, { status, text: new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks)) });
      body.on('data', c => {
        if (settled) return;
        size += c.length;
        chunks.push(c);
        if (size >= max) { finish(); req.destroy(); }
      });
      body.on('end', finish);
      // Cut off part way (time ran out, or a bad stream): use what arrived, if anything did.
      body.on('error', e => (size ? finish() : fail(e)));
      body.on('close', () => (size ? finish() : fail(new Blocked('unreachable'))));
    });
    const timer = setTimeout(() => req.destroy(new Blocked('unreachable')), left);
    req.on('error', fail);
    req.end();
  });
}

export async function getText(url, accept, deadline, max = MAX_BYTES) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    assertPublic(current);
    const res = await getOnce(current, accept, deadline, max);
    if (res.location) {
      try { current = new URL(res.location, current); } catch { throw new Blocked('unreachable'); }
      continue;
    }
    return { status: res.status, text: res.text, url: current.toString() };
  }
  throw new Blocked('redirects');
}

// Where a link ends up, following its redirects without reading the pages (for short links).
export async function whereTo(url, deadline) {
  let current = new URL(url);
  for (let hop = 0; hop < 5; hop++) {
    assertPublic(current);
    const res = await getOnce(current, '*/*', deadline, 1);
    if (!res.location) return current.toString();
    try { current = new URL(res.location, current); } catch { break; }
  }
  return current.toString();
}

// ---------------------------------------------------------------- robots.txt

// Standard rules: the group naming this app, else the * group; the longest matching
// rule wins and Allow wins a tie. * and $ work as in Google's parser.
export function robotsAllows(robots, path) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of robots.slice(0, MAX_ROBOTS).split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val.slice(0, 500) });
    }
  }
  const mine = groups.filter(g => g.agents.includes(AGENT.toLowerCase()));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;                       // "Disallow:" with nothing means allow all
    if (!robotsMatch(r.path, path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

// Does one robots.txt rule cover this path? A rule matches from the start of the path; * is
// any run of characters, and a $ at the very end means the path must end there. Built
// without regular expressions, so a rule full of * cannot make the check run for ages.
export function robotsMatch(rule, path) {
  const ends = rule.endsWith('$');
  const pat = ends ? rule.slice(0, -1) : rule + '*';
  let p = 0, s = 0, star = -1, mark = 0;
  while (s < path.length) {
    if (p < pat.length && pat[p] === '*') { star = p++; mark = s; }
    else if (p < pat.length && pat[p] === path[s]) { p++; s++; }
    else if (star !== -1) { p = star + 1; s = ++mark; }
    else return false;
  }
  while (p < pat.length && pat[p] === '*') p++;
  return p === pat.length;
}

async function checkRobots(url, deadline) {
  const u = new URL(url);
  let r;
  try { r = await getText(`${u.origin}/robots.txt`, 'text/plain', deadline, MAX_ROBOTS); }
  catch (e) { if (e instanceof Blocked) throw e; throw new Blocked('unreachable'); }
  if (r.status >= 500) throw new Blocked('unreachable');     // treat a broken robots.txt as "no"
  if (r.status >= 400) return;                               // no robots.txt: allowed
  if (!robotsAllows(r.text, u.pathname + u.search)) throw new Blocked('robots');
}

// ---------------------------------------------------------------- page parsing

const decode = s => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

function metaTags(html) {
  const out = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && val !== undefined && !(key.toLowerCase() in out)) out[key.toLowerCase()] = decode(val);
  }
  return out;
}

function productLd(html) {
  for (const m of html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const o = stack.shift();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { stack.push(...o); continue; }
      const type = [].concat(o['@type'] || []).join(' ');
      if (/\bProduct\b/.test(type)) return o;
      if (o['@graph']) stack.push(o['@graph']);
    }
  }
  return null;
}

const first = v => (Array.isArray(v) ? first(v[0]) : v && typeof v === 'object' ? v.url || v.contentUrl || '' : v || '');

export function parseProduct(html, pageUrl) {
  const meta = metaTags(html);
  const ld = productLd(html) || {};
  const offers = [].concat(ld.offers || [])[0] || {};
  const title = meta['og:title'] || meta['twitter:title'] || decode(ld.name) ||
    decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  let image = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || first(ld.image);
  if (image) { try { image = new URL(image, pageUrl).toString(); } catch { image = ''; } }
  const price = meta['product:price:amount'] || meta['og:price:amount'] || offers.price || offers.lowPrice ||
    (offers.priceSpecification && offers.priceSpecification.price) || meta.price || '';
  return { title: tidyTitle(title, pageUrl).slice(0, 200), image: String(image || ''), price: String(price || '') };
}

// ---------------------------------------------------------------- names without asking the store

// Store names that pages tack onto product names, by the store's web address.
const BRANDS = { amazon: 'Amazon', target: 'Target', walmart: 'Walmart', bestbuy: 'Best Buy', lego: 'LEGO', rei: 'REI',
  etsy: 'Etsy', kohls: "Kohl's", costco: 'Costco', homedepot: 'Home Depot', lowes: "Lowe's", macys: "Macy's",
  nordstrom: 'Nordstrom', ebay: 'eBay', wayfair: 'Wayfair', dickssportinggoods: "Dick's", barnesandnoble: 'Barnes & Noble' };
const brandOf = host => {
  const parts = String(host || '').toLowerCase().replace(/^www\./, '').split('.');
  return parts.map(p => BRANDS[p]).find(Boolean) || '';
};

// "Amazon.com: LEGO Batmobile : Toys & Games" -> "LEGO Batmobile"; "Lamp : Target" -> "Lamp";
// "Socks | REI Co-op" -> "Socks". Only trims a store name the page itself added.
export function tidyTitle(title, pageUrl) {
  let t = decode(title);
  let host = '';
  try { host = new URL(pageUrl).hostname; } catch {}
  t = t.replace(/^amazon\.[a-z.]+\s*:\s*/i, '');
  if (/amazon\./i.test(host)) t = t.replace(/\s+:\s+[^:]{2,40}$/, '');           // Amazon's trailing ": Category"
  const brand = brandOf(host);
  if (!brand) return t.trim();
  // Split on " | ", " - ", " : " and cut at the first piece after the name that names the store.
  const plain = s => s.toLowerCase().replace(/[®™'’.]/g, '');
  const b = plain(brand);
  const parts = t.split(/(\s[|\-–—:]\s)/);
  for (let i = 2; i < parts.length; i += 2) {
    if (plain(parts[i]).includes(b)) { t = parts.slice(0, i - 1).join(''); break; }
  }
  if (plain(parts[0]) === b && parts.length > 2) t = parts.slice(2).join('');     // "Target : Lamp"
  return t.trim();
}

// Many store links carry the product's name in the address itself:
//   amazon.com/LEGO-Technic-Batmobile-Tumbler-42239/dp/B0...   target.com/p/fleece-throw-blanket/-/A-123
//   rei.com/product/168177/big-agnes-torchlight-20-sleeping-bag   lego.com/en-us/product/millennium-falcon-75192
// When a store will not let the app read its page, this fills the name from the link alone,
// without contacting the store at all.
const SKIP = new Set(['dp', 'gp', 'product', 'products', 'p', 'ip', 'site', 'listing', 'item', 'itm', 'shop', 'en-us', 'en', 'us', 'pd', 'prod', 'buy', 'c', 'b']);
const SMALL = new Set(['a', 'an', 'and', 'or', 'of', 'the', 'for', 'with', 'in', 'on', 'to', 'by', 'at']);
export function guessFromUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  const segs = u.pathname.split('/').map(s => { try { return decodeURIComponent(s); } catch { return s; } })
    .map(s => s.replace(/\.(html?|p|aspx?|php|jsp|cfm)$/i, ''));
  // The piece that names the product: letters, two or more words, not an id or a path word.
  // Stores put categories first and the product last, so the last such piece wins.
  const pick = segs
    .filter(s => !SKIP.has(s.toLowerCase()) && /[a-z]/i.test(s) && /[-_+ ]/.test(s) && !/^[A-Z]{1,4}-?\d+$/i.test(s) && !/^[A-Z0-9]{10}$/.test(s))
    .map(s => s.replace(/[-_+]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(s => s.split(' ').filter(w => /[a-z]/i.test(w)).length >= 2)
    .pop();
  if (!pick) return null;
  // all lowercase -> Title Case, but leave a name that already has capitals alone
  const words = pick.split(' ');
  const title = pick === pick.toLowerCase()
    ? words.map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
    : pick;
  return { title: title.slice(0, 200), store: brandOf(u.hostname) };
}

// The whole lookup. Returns { title, image, price } or throws Blocked.
export async function lookupProduct(url) {
  const deadline = Date.now() + TIMEOUT;
  await checkRobots(url, deadline);
  const page = await getText(url, 'text/html,application/xhtml+xml', deadline);
  if (page.status === 401 || page.status === 403 || page.status === 429 || page.status === 503) throw new Blocked('refused');
  if (page.status >= 400) throw new Blocked('missing');
  // A robot check page is a "no", not something to get around.
  if (/captcha|robot check|are you a human|access denied|unusual traffic/i.test(page.text.slice(0, 20000)) &&
      !/og:title/i.test(page.text)) throw new Blocked('refused');
  return parseProduct(page.text, page.url);
}
