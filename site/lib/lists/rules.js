// The wish list rules: what each person may see, and every change they may make.
//
// THE PROMISE: a list's owner never learns what was bought for them, who bought it,
// what anyone chipped in, or what secret ideas others added. That is enforced HERE,
// on the server, by leaving those things out of what the owner's browser receives.
// Hiding them in the page would not be enough, since anyone can read a page's data.
//
// How a person relates to a list (`rel`):
//   own     it is their list                        -> sees and edits items, never purchases
//   manage  they keep a kid's list, purchases hidden -> same as own
//   parent  they keep a kid's list, purchases shown  -> edits items AND shops it
//   shop    anyone else                             -> shops it, adds secret ideas
//
// WHO CAN SIGN IN: only people the admin adds with an email (People page). Any grown-up who
// signs in may also add a list for their own child (saveKid). A child has no email, so
// that never lets anyone new sign in; the parent keeps the list for them.
import { randomUUID, randomInt } from 'node:crypto';
import { siteInfo } from './site.js';

export const LIMITS = { people: 80, itemsPerList: 250, items: 5000, title: 200, note: 400, about: 600, name: 40, kidsPerParent: 12, draws: 30, requests: 25 };
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
const DAY = 864e5;
const KEEP_DONE_DAYS = 120;        // finished items and given gifts are kept this long, then pruned
const SHOW_GIVEN_DAYS = 90;        // "My shopping" shows given gifts for this long

export class OpError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export const newId = () => randomUUID().replace(/-/g, '').slice(0, 16);

// ---------------------------------------------------------------- input cleaning

const oneLine = (v, max) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const multiLine = (v, max) => (typeof v === 'string'
  ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, max) : '');
export const normEmail = v => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '');
const isId = v => typeof v === 'string' && ID_RE.test(v);

// A link is optional (write-ins have none). Without a scheme, https is assumed.
export function cleanUrl(v) {
  let s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.hostname.includes('.') || u.username || u.password) return null;
    const out = u.toString();
    return out.length <= 2000 ? out : null;
  } catch { return null; }
}

// A photo is either one uploaded here ("photo:<id>") or an https address. Plain http
// addresses are upgraded, since the page is https and would block them.
export function cleanImage(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return '';
  if (/^photo:[a-f0-9]{16,40}$/.test(s)) return s;
  const u = cleanUrl(s.replace(/^http:/i, 'https:'));
  return u && u.startsWith('https://') ? u : '';
}

// "$1,299.99", "1299.99", "USD 45" -> cents. Anything unreadable is "no price".
export function parsePrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  const m = v.replace(/[,\s]/g, '').match(/\d+(?:\.\d{1,2})?/);
  if (!m) return null;
  const cents = Math.round(parseFloat(m[0]) * 100);
  return cents > 0 && cents < 10_000_000 ? cents : null;
}

export function storeOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').slice(0, 60); } catch { return ''; }
}

const qtyOf = v => Math.min(20, Math.max(1, Number.parseInt(v, 10) || 1));

// ---------------------------------------------------------------- gift timing

// Anything still marked "bought" counts as given once Christmas is over: midnight
// Central time on December 26 (06:00 UTC; Chicago is on standard time in December).
const CENTRAL = 6 * 3600e3;
export function autoGivenAt(boughtAt) {
  const y = new Date(boughtAt - CENTRAL).getUTCFullYear();
  let cut = Date.UTC(y, 11, 26) + CENTRAL;
  if (cut <= boughtAt) cut = Date.UTC(y + 1, 11, 26) + CENTRAL;
  return cut;
}
export const isGiven = (b, now) => Boolean(b.givenAt) || now >= autoGivenAt(b.at);
const givenTime = (b, now) => b.givenAt || (now >= autoGivenAt(b.at) ? autoGivenAt(b.at) : null);

// ---------------------------------------------------------------- relations

export function relation(state, me, ownerId) {
  if (ownerId === me.id) return 'own';
  const owner = state.people.find(p => p.id === ownerId);
  if (owner && Array.isArray(owner.managers) && owner.managers.includes(me.id)) {
    return owner.parentsSee ? 'parent' : 'manage';
  }
  return 'shop';
}
export const hidesPurchases = rel => rel === 'own' || rel === 'manage';
const keepsList = rel => rel !== 'shop';

// ---------------------------------------------------------------- who can see a list
// A person may limit who sees their list (`audience`: the grown-ups who may, or null for
// everyone). Parents set it for a kid's list. Some people always see a list: its owner, the
// parents who keep it, the admin, and anyone who drew that person in a name draw.

// The people this person (or a kid they keep) drew in a name draw that has been drawn.
export function drawnFor(state, me) {
  const out = new Set();
  const mine = new Set([me.id, ...state.people.filter(p => !p.email && (p.managers || []).includes(me.id)).map(p => p.id)]);
  for (const d of state.draws || []) {
    if (!d.pairs) continue;
    for (const [giver, receiver] of Object.entries(d.pairs)) if (mine.has(giver)) out.add(receiver);
  }
  return out;
}

export function canSee(state, me, ownerId, drawn = drawnFor(state, me)) {
  if (ownerId === me.id || me.admin) return true;
  const owner = state.people.find(p => p.id === ownerId);
  if (!owner) return false;
  if ((owner.managers || []).includes(me.id)) return true;
  if (!Array.isArray(owner.audience) || owner.audience.includes(me.id)) return true;
  return drawn.has(ownerId);
}

function itemTotals(state, item, now) {
  const buys = state.buys.filter(b => b.itemId === item.id);
  const given = buys.filter(b => isGiven(b, now));
  const open = buys.filter(b => !isGiven(b, now));
  const givenQty = given.reduce((n, b) => n + b.qty, 0);
  const openQty = open.reduce((n, b) => n + b.qty, 0);
  const left = Math.max(0, item.qty - givenQty);
  return { buys, open, openQty, left, need: Math.max(0, left - openQty) };
}

// ---------------------------------------------------------------- what a person sees

export function view(state, me, now = Date.now()) {
  const nameOf = id => state.people.find(p => p.id === id)?.name || 'Someone no longer on the list';
  const itemOf = id => state.items.find(i => i.id === id);

  const drawn = drawnFor(state, me);
  const sees = id => canSee(state, me, id, drawn);
  const audienceOf = p => (Array.isArray(p.audience) ? p.audience : null);

  // Only the lists this person may see. Everyone else stays out of the names entirely.
  const people = state.people.filter(p => sees(p.id)).map(p => {
    const rel = relation(state, me, p.id);
    const out = { id: p.id, name: p.name, about: p.about || '', kid: !p.email, rel };
    if (Array.isArray(p.managers) && p.managers.length) out.keptBy = p.managers.map(nameOf);
    if (me.admin) {
      Object.assign(out, { email: p.email || '', admin: Boolean(p.admin),
        managers: Array.isArray(p.managers) ? p.managers : [], parentsSee: Boolean(p.parentsSee), audience: audienceOf(p) });
      if (p.addedBy && p.addedBy !== me.id) out.addedBy = nameOf(p.addedBy);
    } else if (keepsList(rel)) {
      // Their own list, or a child's list they keep: they see who it is shared with.
      out.audience = audienceOf(p);
      // A parent who keeps a child's list sees its settings, to change them.
      if (out.kid) Object.assign(out, { managers: Array.isArray(p.managers) ? p.managers : [], parentsSee: Boolean(p.parentsSee) });
    }
    return out;
  });
  // Everyone who can sign in, by name only: for choosing who sees a list.
  const members = state.people.filter(p => p.email).map(p => ({ id: p.id, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const items = [];
  for (const it of state.items) {
    if (!sees(it.ownerId)) continue;
    const rel = relation(state, me, it.ownerId);
    const t = itemTotals(state, it, now);
    const base = {
      id: it.id, ownerId: it.ownerId, title: it.title, url: it.url || '', store: it.store || '',
      image: it.image || '', priceCents: it.priceCents ?? null, note: it.note || '', createdAt: it.createdAt, rel
    };
    if (hidesPurchases(rel)) {
      // The owner's copy: no secret ideas, nothing they removed, nothing already given,
      // and no purchase or chip-in data of any kind.
      if (it.secret || it.removedAt || t.left <= 0) continue;
      items.push({ ...base, qty: t.left, canEdit: true });
      continue;
    }
    if (t.left <= 0) continue;                       // every one of them was given: done
    if (it.removedAt && t.open.length === 0) continue;
    items.push({
      ...base,
      qty: t.left, bought: t.openQty, need: t.need,
      secret: Boolean(it.secret), addedBy: it.secret ? nameOf(it.addedBy) : '',
      canEdit: it.secret ? it.addedBy === me.id : keepsList(rel),
      removed: Boolean(it.removedAt),
      buys: t.open.map(b => ({
        id: b.id, buyer: nameOf(b.buyerId), mine: b.buyerId === me.id, qty: b.qty, at: b.at,
        changed: Boolean(it.editedAt && it.editedAt > b.at)
      })),
      chips: state.chips.filter(c => c.itemId === it.id)
        .map(c => ({ id: c.id, person: nameOf(c.personId), mine: c.personId === me.id, cents: c.cents }))
    });
  }

  // "My shopping": what this person bought or pledged, on any list.
  const shopping = { buys: [], chips: [] };
  for (const b of state.buys) {
    if (b.buyerId !== me.id) continue;
    const it = itemOf(b.itemId);
    if (!it) continue;
    const gAt = givenTime(b, now);
    if (gAt && now - gAt > SHOW_GIVEN_DAYS * DAY) continue;
    // A purchase stays here even if its list was later hidden from the buyer, so they can
    // still mark it given; `hidden` means the item page is not open to them any more.
    shopping.buys.push({
      id: b.id, itemId: it.id, ownerId: it.ownerId, ownerName: nameOf(it.ownerId), hidden: !sees(it.ownerId),
      title: it.title, url: it.url || '', store: it.store || '',
      image: it.image || '', priceCents: it.priceCents ?? null, qty: b.qty, at: b.at,
      given: Boolean(gAt), givenAt: gAt, manual: Boolean(b.givenAt),
      removed: Boolean(it.removedAt), changed: Boolean(it.editedAt && it.editedAt > b.at)
    });
  }
  for (const c of state.chips) {
    if (c.personId !== me.id) continue;
    const it = itemOf(c.itemId);
    if (!it) continue;
    shopping.chips.push({ id: c.id, itemId: it.id, ownerId: it.ownerId, ownerName: nameOf(it.ownerId), hidden: !sees(it.ownerId),
      title: it.title, cents: c.cents, at: c.at });
  }

  // Name draws this person is part of: as a giver, as the parent of a kid giver, or as the
  // organizer. Nobody, not the organizer and not the admin, sees who drew whom, except the giver
  // (or the giver's parents, for a kid).
  const keptKids = new Set(state.people.filter(p => !p.email && (p.managers || []).includes(me.id)).map(p => p.id));
  const draws = [];
  for (const d of state.draws || []) {
    const inIt = d.participants.includes(me.id), mine = d.organizerId === me.id;
    const kids = d.participants.filter(id => keptKids.has(id));
    if (!inIt && !mine && !kids.length && !me.admin) continue;
    const out = {
      id: d.id, name: d.name, organizer: nameOf(d.organizerId), mine, canManage: mine || Boolean(me.admin),
      participants: d.participants.map(id => ({ id, name: nameOf(id), kid: !state.people.find(p => p.id === id)?.email })),
      budget: d.budget || '', giveBy: d.giveBy || '', createdAt: d.createdAt,
      drawnAt: d.pairs ? d.drawnAt : null, redraw: Boolean(d.redraw), inIt
    };
    if (out.canManage) out.apart = d.apart || [];
    if (d.pairs) {
      if (inIt && d.pairs[me.id]) out.myMatch = { id: d.pairs[me.id], name: nameOf(d.pairs[me.id]) };
      out.kidMatches = kids.filter(k => d.pairs[k]).map(k => ({ kid: k, kidName: nameOf(k), id: d.pairs[k], name: nameOf(d.pairs[k]) }));
    }
    draws.push(out);
  }

  return {
    me: { id: me.id, name: me.name, admin: Boolean(me.admin), about: me.about || '',
      setup: me.setup || null, tour: me.tour || null },
    people, members, items, shopping, draws, now,
    // Requests to join, from the sign-in page. Only the admin sees them.
    ...(me.admin ? { requests: (state.requests || []).map(r => ({ id: r.id, name: r.name, email: r.email, note: r.note || '', at: r.at })) } : {}),
    // Family-wide settings everyone may see: the iPhone shortcut's iCloud link, once the admin
    // shares it, and the names of this wish list (empty until the admin sets them on People).
    settings: { shortcutLink: (state.settings && state.settings.shortcutLink) || '',
      title: (state.settings && state.settings.title) || '', shortTitle: (state.settings && state.settings.shortTitle) || '' },
    site: (({ title, shortTitle, adminName }) => ({ title, shortTitle, adminName }))(siteInfo(state))
  };
}

// ---------------------------------------------------------------- asking to join

// A request from the sign-in page: name, email and an optional note for the admin.
export function cleanJoinRequest(body) {
  const name = oneLine(body && body.name, LIMITS.name);
  if (!name) throw new OpError('invalid', 'Enter your name.');
  const email = normEmail(body && body.email);
  if (!email || !EMAIL_RE.test(email)) throw new OpError('invalid', 'That email address does not look right.');
  return { name, email, note: oneLine(body && body.note, 200) };
}

// ---------------------------------------------------------------- changes

const NOT_FOUND = () => new OpError('not_found', 'That item is no longer on the list. The page now shows the latest.', 409);

// Check and trim a request body before touching storage.
export function validate(body) {
  if (!body || typeof body !== 'object') throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
  const op = body.op;
  const needId = (v, what = 'item') => {
    if (!isId(v)) throw new OpError('invalid', `That ${what} could not be found. Reload and try again.`);
    return v;
  };
  const itemFields = () => {
    const url = cleanUrl(body.url);
    if (url === null) throw new OpError('invalid', 'That link does not look right. Paste the whole address, starting with https.', 400);
    const title = oneLine(body.title, LIMITS.title);
    if (!title) throw new OpError('invalid', 'Say what it is.', 400);
    return {
      url, title, store: storeOf(url), image: cleanImage(body.image), priceCents: parsePrice(body.price),
      note: multiLine(body.note, LIMITS.note), qty: qtyOf(body.qty)
    };
  };
  switch (op) {
    case 'addItem': return { op, ownerId: needId(body.ownerId, 'person'), ...itemFields() };
    case 'editItem': return { op, id: needId(body.id), ...itemFields() };
    case 'removeItem': return { op, id: needId(body.id) };
    case 'buy': return { op, itemId: needId(body.itemId), qty: qtyOf(body.qty) };
    case 'unbuy': case 'given': case 'ungiven': return { op, buyId: needId(body.buyId, 'purchase') };
    case 'chip': {
      const cents = body.amount === 0 || body.amount === '0' || body.amount === '' ? 0 : parsePrice(String(body.amount ?? ''));
      if (cents === null) throw new OpError('invalid', 'Enter an amount in dollars, like 25.');
      return { op, itemId: needId(body.itemId), cents };
    }
    case 'saveAbout': return { op, personId: needId(body.personId, 'person'), about: multiLine(body.about, LIMITS.about) };
    case 'savePerson': {
      const name = oneLine(body.name, LIMITS.name);
      if (!name) throw new OpError('invalid', 'Enter a name.');
      const email = normEmail(body.email);
      if (email && !EMAIL_RE.test(email)) throw new OpError('invalid', 'That email address does not look right.');
      const managers = Array.isArray(body.managers) ? [...new Set(body.managers.filter(isId))].slice(0, 6) : [];
      if (!email && !managers.length) throw new OpError('invalid', 'Add an email address, or pick the parents who keep this kid\'s list.');
      if (body.id !== undefined) needId(body.id, 'person');
      return { op, id: body.id, name, email, admin: Boolean(body.admin), managers, parentsSee: Boolean(body.parentsSee) };
    }
    case 'saveKid': {
      // A parent adds or changes a list for their own child: a name, the other parent, and
      // whether the parents see what was bought. Never an email, never admin.
      const name = oneLine(body.name, LIMITS.name);
      if (!name) throw new OpError('invalid', 'Enter your child\'s name.');
      const managers = Array.isArray(body.managers) ? [...new Set(body.managers.filter(isId))].slice(0, 6) : [];
      if (body.id !== undefined) needId(body.id, 'person');
      return { op, id: body.id, name, managers, parentsSee: Boolean(body.parentsSee) };
    }
    case 'removePerson': case 'removeKid': case 'signOutPerson': return { op, id: needId(body.id, 'person') };
    case 'saveAudience': {
      // Who can see a list: null for everyone, or the grown-ups chosen.
      const audience = body.audience === null ? null
        : Array.isArray(body.audience) ? [...new Set(body.audience.filter(isId))].slice(0, LIMITS.people) : undefined;
      if (audience === undefined) throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
      return { op, personId: needId(body.personId, 'person'), audience, kidsToo: Boolean(body.kidsToo) };
    }
    case 'dismissRequest': return { op, id: needId(body.id, 'request') };
    case 'saveDraw': {
      const name = oneLine(body.name, 60);
      if (!name) throw new OpError('invalid', 'Give the draw a name, like Christmas 2026.');
      const participants = Array.isArray(body.participants) ? [...new Set(body.participants.filter(isId))].slice(0, 60) : [];
      if (participants.length < 3) throw new OpError('invalid', 'Pick at least three people for the draw.');
      const apart = (Array.isArray(body.apart) ? body.apart : [])
        .filter(x => Array.isArray(x) && x.length === 2 && isId(x[0]) && isId(x[1]) && x[0] !== x[1]
          && participants.includes(x[0]) && participants.includes(x[1]))
        .slice(0, 60).map(x => [x[0], x[1]]);
      const giveBy = typeof body.giveBy === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.giveBy) ? body.giveBy : '';
      if (body.id !== undefined) needId(body.id, 'draw');
      return { op, id: body.id, name, participants, apart, budget: oneLine(body.budget, 40), giveBy };
    }
    case 'drawNames': case 'removeDraw': return { op, id: needId(body.id, 'draw') };
    case 'saveSettings': {
      // Any of: the iPhone shortcut's iCloud link (or empty, to clear it), and the names of
      // this wish list (empty goes back to the default).
      const out = { op };
      if (body.shortcutLink !== undefined) {
        const raw = typeof body.shortcutLink === 'string' ? body.shortcutLink.trim() : '';
        const link = raw ? cleanUrl(raw) : '';
        if (link === null || (link && !/^https:\/\/(www\.)?icloud\.com\/shortcuts\/[A-Za-z0-9]+\/?$/.test(link))) {
          throw new OpError('invalid', 'That is not an iCloud shortcut link. In Shortcuts, touch and hold the shortcut, tap Share, then Copy iCloud Link.');
        }
        out.shortcutLink = link;
      }
      if (body.title !== undefined) out.title = oneLine(body.title, 80);
      if (body.shortTitle !== undefined) out.shortTitle = oneLine(body.shortTitle, 40);
      if (Object.keys(out).length === 1) throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
      return out;
    }
    case 'saveSetup': {
      // First-run setup and the tour: where this person is, and whether they finished or skipped.
      const step = Number.isInteger(body.step) && body.step >= 0 && body.step <= 20 ? body.step : null;
      const setup = ['done', 'skipped'].includes(body.setup) ? body.setup : null;
      const tour = ['pending', 'done', 'skipped'].includes(body.tour) ? body.tour : null;
      if (step === null && !setup && !tour) throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
      return { op, step, setup, tour };
    }
    default: throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
  }
}

// Take a person off the family list with everything that hangs on them: their list, the
// ideas for them, what was bought from it, and what they bought or pledged elsewhere.
function dropPerson(state, id) {
  const theirs = new Set(state.items.filter(i => i.ownerId === id).map(i => i.id));
  state.people = state.people.filter(p => p.id !== id);
  // A kid left with no parent cannot be reached; the admin sees "no parent" and can fix it.
  for (const p of state.people) if (Array.isArray(p.managers)) p.managers = p.managers.filter(m => m !== id);
  state.items = state.items.filter(i => !theirs.has(i.id));
  state.buys = state.buys.filter(b => !theirs.has(b.itemId) && b.buyerId !== id);
  state.chips = state.chips.filter(c => !theirs.has(c.itemId) && c.personId !== id);
  // Out of any name draw; a draw that was already drawn has to be drawn again.
  for (const d of state.draws || []) {
    if (!d.participants.includes(id)) continue;
    d.participants = d.participants.filter(x => x !== id);
    d.apart = (d.apart || []).filter(([a, b]) => a !== id && b !== id);
    if (d.pairs) { d.pairs = null; d.drawnAt = null; d.redraw = true; }
  }
}

// ---------------------------------------------------------------- name draws

const shuffled = list => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Who may draw whom: never yourself, never a pair kept apart, never a parent and their own
// kid, never two parents of the same kid (most likely partners), and only someone whose list
// the giver can see (for a kid, the kid's parents shop, so they must be able to see it).
// Then one random match each, so everyone gives once and gets once.
export function drawPairs(state, d) {
  const person = id => state.people.find(p => p.id === id);
  const keepers = id => person(id)?.managers || [];
  const partners = (a, b) => state.people.some(k => !k.email && (k.managers || []).includes(a) && (k.managers || []).includes(b));
  const apart = new Set((d.apart || []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const shoppers = id => { const p = person(id); return p.email ? [p] : keepers(id).map(person).filter(Boolean); };
  const allowed = (g, r) => g !== r && !apart.has(`${g}|${r}`) && !keepers(g).includes(r) && !keepers(r).includes(g)
    && !partners(g, r) && shoppers(g).some(v => canSee(state, v, r, new Set()));
  const ids = d.participants.filter(id => person(id));
  if (ids.length < 3) throw new OpError('invalid', 'A draw needs at least three people.');
  const options = new Map(ids.map(g => [g, ids.filter(r => allowed(g, r))]));
  const stuck = ids.find(g => !options.get(g).length);
  if (stuck) {
    throw new OpError('invalid', `${person(stuck).name} has nobody they can draw. Take out a Keep apart pair, add more people, `
      + 'or check who can see whose list.');
  }
  // Fewest choices first, then try matches in a random order, backing up when stuck.
  const order = shuffled(ids).sort((a, b) => options.get(a).length - options.get(b).length);
  const taken = new Set(), pairs = {};
  let steps = 0;
  const place = i => {
    if (i === order.length) return true;
    if (++steps > 100000) return false;
    const g = order[i];
    for (const r of shuffled(options.get(g))) {
      if (taken.has(r)) continue;
      taken.add(r); pairs[g] = r;
      if (place(i + 1)) return true;
      taken.delete(r); delete pairs[g];
    }
    return false;
  };
  if (!place(0)) throw new OpError('invalid', 'These names cannot be drawn with these rules. Take out a Keep apart pair, or add more people.');
  return pairs;
}

export function apply(state, op, me, now = Date.now()) {
  const item = id => state.items.find(i => i.id === id);
  const person = id => state.people.find(p => p.id === id);
  const boss = siteInfo(state).adminName;
  const adminOnly = () => { if (!me.admin) throw new OpError('forbidden', `Only ${boss} can change who is on the list.`, 403); };
  const drawn = drawnFor(state, me);
  const visible = ownerId => canSee(state, me, ownerId, drawn);
  const draw = id => {
    const d = (state.draws || []).find(x => x.id === id);
    if (!d) throw new OpError('not_found', 'That draw is no longer here.', 409);
    if (d.organizerId !== me.id && !me.admin) throw new OpError('forbidden', 'Only the person who started this draw can change it.', 403);
    return d;
  };
  const canChangeItem = it => (it.secret ? it.addedBy === me.id : keepsList(relation(state, me, it.ownerId)));
  const shoppable = it => {
    const rel = relation(state, me, it.ownerId);
    if (hidesPurchases(rel)) {
      throw new OpError('forbidden', rel === 'own'
        ? 'This is your own list, so purchases are kept from you.'
        : 'You keep this list, so its purchases are kept from you.', 403);
    }
  };

  switch (op.op) {
    case 'addItem': {
      const owner = person(op.ownerId);
      if (!owner) throw new OpError('not_found', 'That person is no longer on the list.', 409);
      if (!visible(owner.id)) throw new OpError('forbidden', 'That list is not shared with you.', 403);
      const onList = state.items.filter(i => i.ownerId === owner.id && !i.removedAt).length;
      if (onList >= LIMITS.itemsPerList || state.items.length >= LIMITS.items) {
        throw new OpError('limit', 'This list is full. Remove a few things first.');
      }
      const rel = relation(state, me, owner.id);
      const id = newId();
      state.items.push({
        id, ownerId: owner.id, addedBy: me.id, secret: rel === 'shop',
        url: op.url, store: op.store, title: op.title, image: op.image, priceCents: op.priceCents,
        note: op.note, qty: op.qty, createdAt: now, editedAt: null, removedAt: null
      });
      return id;
    }
    case 'editItem': {
      const it = item(op.id);
      if (!it || it.removedAt || !visible(it.ownerId)) throw NOT_FOUND();
      if (!canChangeItem(it)) throw new OpError('forbidden', 'Only the person who added this can change it.', 403);
      Object.assign(it, { url: op.url, store: op.store, title: op.title, image: op.image,
        priceCents: op.priceCents, note: op.note, qty: op.qty, editedAt: now });
      return it.id;
    }
    case 'removeItem': {
      const it = item(op.id);
      if (!it || it.removedAt) return op.id;       // already gone: same answer either way
      if (!visible(it.ownerId) || !canChangeItem(it)) throw new OpError('forbidden', 'Only the person who added this can remove it.', 403);
      // If someone already bought it, keep it for the buyers so they find out. The
      // owner gets exactly the same answer either way, so nothing is given away.
      const open = state.buys.some(b => b.itemId === it.id && !isGiven(b, now));
      if (open) { it.removedAt = now; return it.id; }
      state.items = state.items.filter(i => i.id !== it.id);
      state.buys = state.buys.filter(b => b.itemId !== it.id);
      state.chips = state.chips.filter(c => c.itemId !== it.id);
      return op.id;
    }
    case 'buy': {
      const it = item(op.itemId);
      if (!it || !visible(it.ownerId)) throw NOT_FOUND();
      shoppable(it);
      if (it.removedAt) throw new OpError('removed', 'This was taken off the list, so it cannot be marked bought.', 409);
      const t = itemTotals(state, it, now);
      if (t.need <= 0) throw new OpError('covered', 'Someone already bought this. The page now shows the latest.', 409);
      const qty = Math.min(op.qty, t.need);
      const mine = t.open.find(b => b.buyerId === me.id);
      if (mine) { mine.qty += qty; mine.at = now; return mine.id; }
      const id = newId();
      state.buys.push({ id, itemId: it.id, buyerId: me.id, qty, at: now, givenAt: null });
      return id;
    }
    case 'unbuy': case 'given': case 'ungiven': {
      const b = state.buys.find(x => x.id === op.buyId);
      if (!b || b.buyerId !== me.id) throw new OpError('not_found', 'That purchase could not be found. Reload and try again.', 409);
      if (op.op === 'unbuy') {
        if (isGiven(b, now)) throw new OpError('given', 'That gift was already given.', 409);
        state.buys = state.buys.filter(x => x.id !== b.id);
      } else if (op.op === 'given') {
        b.givenAt = b.givenAt || now;
      } else {
        if (!b.givenAt) throw new OpError('given', 'Gifts count as given after Christmas, so this one cannot be undone.', 409);
        b.givenAt = null;
      }
      return b.id;
    }
    case 'chip': {
      const it = item(op.itemId);
      if (!it || !visible(it.ownerId)) throw NOT_FOUND();
      shoppable(it);
      const mine = state.chips.find(c => c.itemId === it.id && c.personId === me.id);
      if (op.cents === 0) { state.chips = state.chips.filter(c => c !== mine); return null; }
      if (it.removedAt) throw new OpError('removed', 'This was taken off the list.', 409);
      if (mine) { mine.cents = op.cents; mine.at = now; return mine.id; }
      const id = newId();
      state.chips.push({ id, itemId: it.id, personId: me.id, cents: op.cents, at: now });
      return id;
    }
    case 'saveAbout': {
      const p = person(op.personId);
      if (!p) throw new OpError('not_found', 'That person is no longer on the list.', 409);
      if (!keepsList(relation(state, me, p.id))) throw new OpError('forbidden', 'Only the list\'s owner can change this.', 403);
      p.about = op.about;
      return p.id;
    }
    case 'savePerson': {
      adminOnly();
      const clash = op.email && state.people.find(p => p.email === op.email && p.id !== op.id);
      if (clash) throw new OpError('invalid', `${clash.name} already uses that email address.`);
      const managers = op.email ? [] : op.managers.filter(id => id !== op.id && person(id)?.email);
      if (!op.email && !managers.length) throw new OpError('invalid', 'Pick at least one parent who has an email address.');
      if (op.id) {
        const p = person(op.id);
        if (!p) throw new OpError('not_found', 'That person is no longer on the list.', 409);
        if (p.id === me.id && (!op.admin || !op.email)) throw new OpError('invalid', 'You cannot take away your own access.');
        if (p.email !== op.email) { p.ver = (p.ver || 0) + 1; p.code = null; }
        Object.assign(p, { name: op.name, email: op.email, admin: Boolean(op.email) && op.admin, managers, parentsSee: !op.email && op.parentsSee });
        if (op.email) state.requests = (state.requests || []).filter(r => r.email !== op.email);
        return p.id;
      }
      if (state.people.length >= LIMITS.people) throw new OpError('limit', `The list holds up to ${LIMITS.people} people.`);
      const id = newId();
      state.people.push({ id, name: op.name, email: op.email, admin: Boolean(op.email) && op.admin, managers,
        parentsSee: !op.email && op.parentsSee, about: '', ver: 0, createdAt: now });
      // Adding someone who asked to join answers their request.
      if (op.email) state.requests = (state.requests || []).filter(r => r.email !== op.email);
      return id;
    }
    case 'removePerson': {
      adminOnly();
      if (op.id === me.id) throw new OpError('invalid', 'You cannot remove yourself.');
      dropPerson(state, op.id);
      return op.id;
    }
    case 'saveKid': {
      const managers = [...new Set([me.id, ...op.managers.filter(id => id !== op.id && person(id)?.email)])].slice(0, 6);
      const same = state.people.find(p => p.id !== op.id && p.name.toLowerCase() === op.name.toLowerCase());
      if (same) {
        const keepers = (same.managers || []).map(id => person(id)?.name).filter(Boolean);
        throw new OpError('invalid', same.email || !keepers.length
          ? `${same.name} is already on the list. Add a last name or initial so people can tell them apart.`
          : `There is already a list for ${same.name}, kept by ${keepers.join(' and ')}. Ask them to add you as a parent on it.`);
      }
      if (op.id) {
        const p = person(op.id);
        if (!p) throw new OpError('not_found', 'That list is no longer here.', 409);
        if (p.email) throw new OpError('forbidden', `Only ${boss} can change a grown-up's list settings.`, 403);
        if (!me.admin && !keepsList(relation(state, me, p.id))) {
          throw new OpError('forbidden', `Only the parents who keep ${p.name}'s list can change it.`, 403);
        }
        Object.assign(p, { name: op.name, managers, parentsSee: op.parentsSee });
        return p.id;
      }
      if (state.people.length >= LIMITS.people) throw new OpError('limit', `The list holds up to ${LIMITS.people} people. Ask ${boss}.`);
      const added = state.people.filter(p => !p.email && p.addedBy === me.id).length;
      if (!me.admin && added >= LIMITS.kidsPerParent) {
        throw new OpError('limit', `You can add up to ${LIMITS.kidsPerParent} children. Ask ${boss} if you need more.`);
      }
      const id = newId();
      state.people.push({ id, name: op.name, email: '', admin: false, managers, parentsSee: op.parentsSee,
        about: '', ver: 0, createdAt: now, addedBy: me.id });
      return id;
    }
    case 'removeKid': {
      const p = person(op.id);
      if (!p) throw new OpError('not_found', 'That list is no longer here.', 409);
      if (p.email) throw new OpError('forbidden', `Only ${boss} can remove a grown-up.`, 403);
      if (!me.admin && !keepsList(relation(state, me, p.id))) {
        throw new OpError('forbidden', `Only the parents who keep ${p.name}'s list can remove it.`, 403);
      }
      dropPerson(state, p.id);
      return p.id;
    }
    case 'saveAudience': {
      const p = person(op.personId);
      if (!p) throw new OpError('not_found', 'That person is no longer on the list.', 409);
      const rel = relation(state, me, p.id);
      if (!me.admin && rel !== 'own' && !(!p.email && keepsList(rel))) {
        throw new OpError('forbidden', 'Only the list\'s owner, or a kid\'s parents, can change who sees it.', 403);
      }
      // Only grown-ups who could not already see it: not the owner, and not a kid's own parents.
      const only = (list, owner) => (list === null ? null
        : list.filter(id => id !== owner.id && !(owner.managers || []).includes(id) && person(id)?.email));
      p.audience = only(op.audience, p);
      if (op.kidsToo && p.id === me.id) {
        for (const k of state.people) if (!k.email && (k.managers || []).includes(me.id)) k.audience = only(op.audience, k);
      }
      return p.id;
    }
    case 'dismissRequest': {
      adminOnly();
      state.requests = (state.requests || []).filter(r => r.id !== op.id);
      return null;
    }
    case 'saveDraw': {
      // Anyone who signs in may start a draw among the lists they can see.
      const participants = op.participants.filter(id => person(id) && visible(id));
      if (participants.length < 3) throw new OpError('invalid', 'Pick at least three people for the draw.');
      const apart = op.apart.filter(([a, b]) => participants.includes(a) && participants.includes(b));
      const fields = { name: op.name, participants, apart, budget: op.budget, giveBy: op.giveBy };
      if (op.id) {
        const d = draw(op.id);
        const same = d.participants.length === participants.length && participants.every(id => d.participants.includes(id))
          && JSON.stringify(d.apart || []) === JSON.stringify(apart);
        Object.assign(d, fields);
        // A different group means the names already drawn no longer fit: draw again.
        if (d.pairs && !same) { d.pairs = null; d.drawnAt = null; d.redraw = true; }
        return d.id;
      }
      state.draws = state.draws || [];
      if (state.draws.length >= LIMITS.draws) throw new OpError('limit', 'There are too many draws. Remove an old one first.');
      const id = newId();
      state.draws.push({ id, organizerId: me.id, ...fields, createdAt: now, drawnAt: null, pairs: null, redraw: false });
      return id;
    }
    case 'drawNames': {
      const d = draw(op.id);
      d.pairs = drawPairs(state, d);
      d.drawnAt = now;
      d.redraw = false;
      return d.id;
    }
    case 'removeDraw': {
      draw(op.id);
      state.draws = state.draws.filter(d => d.id !== op.id);
      return null;
    }
    case 'saveSettings': {
      adminOnly();
      const { op: _, ...changes } = op;
      state.settings = { ...(state.settings || {}), ...changes };
      return null;
    }
    case 'saveSetup': {
      const p = person(me.id);
      const setup = { ...(p.setup || {}) };
      if (op.step !== null) setup.step = op.step;
      if (op.setup === 'done') setup.doneAt = now;
      if (op.setup === 'skipped') setup.skippedAt = now;
      p.setup = setup;
      if (op.tour) p.tour = { state: op.tour, at: now };
      return p.id;
    }
    case 'signOutPerson': {
      if (!me.admin && op.id !== me.id) throw new OpError('forbidden', `Only ${boss} can sign other people out.`, 403);
      const p = person(op.id);
      if (!p) throw new OpError('not_found', 'That person is no longer on the list.', 409);
      p.ver = (p.ver || 0) + 1;
      p.code = null;
      return p.id;
    }
  }
  throw new OpError('bad_request', 'Something went wrong. Reload the page and try again.');
}

// Drop finished things after a while so the file stays small: items every copy of which
// was given, items removed after their buyers gave them, and old given purchases.
export function tidy(state, now = Date.now()) {
  // Name draws go 120 days after their give-by date (or 400 days after they were made).
  if (Array.isArray(state.draws)) {
    state.draws = state.draws.filter(d => {
      const by = d.giveBy ? Date.parse(d.giveBy + 'T12:00:00Z') : NaN;
      return Number.isFinite(by) ? now - by < KEEP_DONE_DAYS * DAY : now - (d.createdAt || now) < 400 * DAY;
    });
  }
  const cutoff = now - KEEP_DONE_DAYS * DAY;
  const drop = new Set();
  for (const it of state.items) {
    const buys = state.buys.filter(b => b.itemId === it.id);
    if (buys.some(b => !isGiven(b, now))) continue;
    const given = buys.reduce((n, b) => n + b.qty, 0);
    const last = buys.reduce((t, b) => Math.max(t, givenTime(b, now) || 0), it.removedAt || 0);
    if ((it.removedAt || given >= it.qty) && last && last < cutoff) drop.add(it.id);
  }
  if (drop.size) {
    state.items = state.items.filter(i => !drop.has(i.id));
    state.buys = state.buys.filter(b => !drop.has(b.itemId));
    state.chips = state.chips.filter(c => !drop.has(c.itemId));
  }
}
