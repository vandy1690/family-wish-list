// "Fill in from link": reads a product page once, the way a chat app builds a link
// preview, and pulls out the name, photo and price the page publishes for that purpose
// (Open Graph tags and schema.org Product data).
//
// The legal line (a firm rule for this app): it names itself honestly, honors the
// store's robots.txt, and never tries to get past a block. If a store says no, or answers
// with a robot check, the page says so and the person uses the Add button on the store's
// page instead, which reads the page they are already looking at in their own browser.
import { lookup } from 'node:dns/promises';
import net from 'node:net';

const AGENT = 'FamilyWishList';
const UA = `${AGENT}/1.0 (+${(process.env.LISTS_ORIGIN || 'https://github.com/vandy1690/family-wish-list').replace(/\/$/, '')}${process.env.LISTS_ORIGIN ? '/lists' : ''}; family wish list link preview)`;
const TIMEOUT = 6000;
const MAX_BYTES = 1_500_000;

export class Blocked extends Error {
  constructor(reason) { super(reason); this.reason = reason; }
}

// ---------------------------------------------------------------- address safety

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
}
function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') ||
    v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

// Only public web addresses on the normal ports. Stops the lookup being pointed at
// anything inside Vercel's network.
// Local tests only: LISTS_LOOKUP_ALLOW_LOCAL=1 lets the lookup read a stand-in store on
// 127.0.0.1, so the tests never depend on a real store. Ignored on Vercel.
const allowLocal = url => !process.env.VERCEL && process.env.LISTS_LOOKUP_ALLOW_LOCAL === '1' && url.hostname === '127.0.0.1';

async function assertPublic(url) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Blocked('scheme');
  if (allowLocal(url)) return;
  if (url.port && url.port !== '443' && url.port !== '80') throw new Blocked('port');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) { if (privateIp(host)) throw new Blocked('private'); return; }
  if (!host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) throw new Blocked('private');
  const addrs = await lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Blocked('private');
}

async function getText(url, accept) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    await assertPublic(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    let res;
    try {
      res = await fetch(current, { redirect: 'manual', signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.8' } });
    } finally { clearTimeout(timer); }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    const reader = res.body?.getReader();
    const chunks = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        chunks.push(value);
        if (size > MAX_BYTES) { try { await reader.cancel(); } catch {} break; }
      }
    }
    const text = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map(c => Buffer.from(c))));
    return { status: res.status, text, url: current.toString() };
  }
  throw new Blocked('redirects');
}

// ---------------------------------------------------------------- robots.txt

// Standard rules: the group naming this app, else the * group; the longest matching
// rule wins and Allow wins a tie. * and $ work as in Google's parser.
export function robotsAllows(robots, path) {
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of robots.split(/\r?\n/)) {
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
      if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
    }
  }
  const mine = groups.filter(g => g.agents.includes(AGENT.toLowerCase()));
  const rules = (mine.length ? mine : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules);
  let best = null;
  for (const r of rules) {
    if (!r.path) continue;                       // "Disallow:" with nothing means allow all
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (!re.test(path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return !best || best.allow;
}

async function checkRobots(url) {
  const u = new URL(url);
  let r;
  try { r = await getText(`${u.origin}/robots.txt`, 'text/plain'); }
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
  await checkRobots(url);
  const page = await getText(url, 'text/html,application/xhtml+xml');
  if (page.status === 401 || page.status === 403 || page.status === 429 || page.status === 503) throw new Blocked('refused');
  if (page.status >= 400) throw new Blocked('missing');
  // A robot check page is a "no", not something to get around.
  if (/captcha|robot check|are you a human|access denied|unusual traffic/i.test(page.text.slice(0, 20000)) &&
      !/og:title/i.test(page.text)) throw new Blocked('refused');
  return parseProduct(page.text, page.url);
}
