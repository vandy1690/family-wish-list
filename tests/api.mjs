// End-to-end API test for the wish list, run against the local dev server.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const BASE = process.argv[2] || 'http://localhost:4350';
import { SITE } from './paths.mjs';
let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

class User {
  constructor(email) { this.email = email; this.cookie = ''; }
  async call(path, body, { method } = {}) {
    const init = { method: method || (body === undefined ? 'GET' : 'POST'), headers: { Accept: 'application/json' }, redirect: 'manual' };
    if (this.cookie) init.headers.Cookie = this.cookie;
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(BASE + path, init);
    for (const c of res.headers.getSetCookie()) if (c.startsWith('wl_session=')) this.cookie = c.split(';')[0];
    let data = null;
    const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
  async signIn() {
    const r = await this.call('/api/lists/login', { email: this.email });
    assert.equal(r.status, 200, `login ${this.email}: ${JSON.stringify(r.data)}`);
    assert.ok(r.data.dev, `no dev code for ${this.email}`);
    const c = await this.call('/api/lists/login', { email: this.email, code: r.data.dev.code });
    assert.equal(c.status, 200, `code ${this.email}: ${JSON.stringify(c.data)}`);
    return r.data.dev;
  }
  data() { return this.call('/api/lists/data'); }
  op(body) { return this.call('/api/lists/data', body); }
}

const health = await (await fetch(BASE + '/api/lists/health')).json();
ok(health.app === 'ok' && health.secret && health.storage && health.mail, 'health ' + JSON.stringify(health));

// Unknown address gets the same answer as a known one, and no email.
const stranger = new User('nobody@example.com');
const s1 = await stranger.call('/api/lists/login', { email: 'nobody@example.com' });
ok(s1.status === 200 && !s1.data.dev, 'stranger gets generic answer, no link');

// John bootstraps as admin.
const john = new User('john@example.com');
await john.signIn();
let r = await john.data();
ok(r.status === 200 && r.data.me.admin && r.data.me.name === 'John', 'john is admin');

// Roster
const ids = {};
for (const [name, email] of [['Jane', 'jane@example.com'], ['Sam', 'sam@example.com'], ['Grandma', 'grandma@example.com']]) {
  r = await john.op({ op: 'savePerson', name, email });
  ok(r.status === 200, `add ${name}: ${JSON.stringify(r.data)}`);
  ids[name] = r.data.id;
}
r = await john.op({ op: 'savePerson', name: 'Ella', email: '', managers: [ids.Jane], parentsSee: false });
ok(r.status === 200, 'add kid Ella'); ids.Ella = r.data.id;
r = await john.op({ op: 'savePerson', name: 'Max', email: '', managers: [ids.Jane], parentsSee: true });
ok(r.status === 200, 'add kid Max'); ids.Max = r.data.id;
r = await john.op({ op: 'savePerson', name: 'Dup', email: 'jane@example.com' });
ok(r.status === 400, 'duplicate email refused');
r = await john.op({ op: 'savePerson', name: 'Orphan', email: '' });
ok(r.status === 400, 'kid without parent refused');

const jane = new User('jane@example.com'), sam = new User('sam@example.com'), grandma = new User('grandma@example.com');
await jane.signIn(); await grandma.signIn();
// Sam signs in with the emailed LINK instead of the code.
{
  const l = await sam.call('/api/lists/login', { email: sam.email });
  const link = new URL(l.data.dev.link);
  const v = await sam.call(link.pathname + link.search);
  const to = v.headers.get('location') || '';
  ok(v.status === 303 && to.startsWith('/lists#t=') && !sam.cookie,
    'opening the link only hands it to the page, so a mail scanner cannot use it up: ' + to.slice(0, 20));
  const t = decodeURIComponent(to.slice('/lists#t='.length));
  const p = await sam.call('/api/lists/verify', { t });
  ok(p.status === 200 && sam.cookie, 'the page finishes signing in with the link');
  const again = await new User('again').call('/api/lists/verify', { t });
  ok(again.status === 401 && again.data.error === 'expired', 'a link works only once');
  const reopened = await new User('again').call(link.pathname + link.search);
  ok(reopened.headers.get('location') === '/lists?signin=expired', 'a used link says so when opened again');
  const bad = await new User('x').call('/api/lists/verify?t=garbage');
  ok(bad.status === 303 && bad.headers.get('location') === '/lists?signin=expired', 'bad link refused');
  // Signing in with the code makes the emailed link stop working.
  const g = new User('grandma@example.com');
  const sentAgain = await g.call('/api/lists/login', { email: g.email });
  const gl = new URL(sentAgain.data.dev.link);
  await g.call('/api/lists/login', { email: g.email, code: sentAgain.data.dev.code });
  const gv = await new User('x').call(gl.pathname + gl.search);
  ok(gv.headers.get('location') === '/lists?signin=expired', 'once the code is used, the link from the same email is not');
}

// Small route checks: HEAD for uptime monitors, sign-out only from this site, photos need sign-in first.
{
  const h = await fetch(BASE + '/api/lists/health', { method: 'HEAD' });
  ok(h.status === 200, 'HEAD on health answers 200');
  const lo = await fetch(BASE + '/api/lists/logout', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  ok(lo.status === 400 && !lo.headers.get('set-cookie'), 'a form post from another site cannot sign anyone out');
  const lo2 = await fetch(BASE + '/api/lists/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
  ok(lo2.status === 400, 'nor can a script on another site');
  const ph = await new User('x').call('/api/lists/photo', { data: 'not a photo' });
  ok(ph.status === 401, 'a photo upload checks sign-in before reading the upload');
  const hp = await new User('x').call('/api/lists/request', { name: 'Bot', email: 'bot@example.com', website: 'spam.example' });
  ok(hp.status === 200 && /John will see your request/.test(hp.data.message), 'the hidden bot field gets the same answer as a person: ' + hp.data.message);
}

// Non-admin cannot change the roster.
r = await jane.op({ op: 'savePerson', name: 'Sneaky', email: 'sneaky@example.com' });
ok(r.status === 403, 'jane cannot add people');

// Sam's list
r = await sam.op({ op: 'addItem', ownerId: ids.Sam, url: 'https://www.lego.com/en-us/product/batmobile-tumbler-42239', title: 'LEGO Batmobile Tumbler', price: '$189.95', image: 'https://example.com/a.jpg', qty: 1 });
ok(r.status === 200, 'sam adds lego'); const lego = r.data.id;
r = await sam.op({ op: 'addItem', ownerId: ids.Sam, url: '', title: "Aunt Jane's cookies", note: 'No nuts, please', qty: 1 });
ok(r.status === 200 && r.data.items.find(i => i.id === r.data.id).store === '', 'write-in with no link'); const cookies = r.data.id;
r = await sam.op({ op: 'addItem', ownerId: ids.Sam, url: 'rei.com/product/1', title: 'Wool socks', price: '18', qty: 3 });
ok(r.status === 200 && r.data.items.find(i => i.id === r.data.id).url === 'https://rei.com/product/1', 'url without scheme gets https'); const socks = r.data.id;
r = await sam.op({ op: 'addItem', ownerId: ids.Sam, url: 'javascript:alert(1)', title: 'bad' });
ok(r.status === 400, 'javascript: link refused');
r = await sam.op({ op: 'addItem', ownerId: ids.Sam, url: '', title: '   ' });
ok(r.status === 400, 'empty title refused');
r = await sam.op({ op: 'saveAbout', personId: ids.Sam, about: 'Shirt M\nShoe 10.5\nLoves hiking' });
ok(r.status === 200, 'sam saves about');
r = await jane.op({ op: 'saveAbout', personId: ids.Sam, about: 'hack' });
ok(r.status === 403, 'jane cannot edit sam about');

// Others shop.
r = await jane.op({ op: 'addItem', ownerId: ids.Sam, url: '', title: 'Knitted dog from Charlie', qty: 1 });
ok(r.status === 200 && r.data.items.find(i => i.id === r.data.id).secret === true, 'jane adds secret idea'); const idea = r.data.id;
r = await john.op({ op: 'buy', itemId: lego, qty: 1 });
ok(r.status === 200, 'john buys lego');
r = await grandma.op({ op: 'buy', itemId: lego, qty: 1 });
ok(r.status === 409, 'lego cannot be bought twice');
r = await grandma.op({ op: 'buy', itemId: socks, qty: 2 });
ok(r.status === 200, 'grandma buys 2 socks');
r = await john.op({ op: 'buy', itemId: socks, qty: 5 });
ok(r.status === 200 && r.data.items.find(i => i.id === socks).need === 0, 'john buy clamps to the 1 needed');
r = await jane.op({ op: 'chip', itemId: cookies, amount: '50' });
ok(r.status === 200, 'jane chips in');
r = await grandma.op({ op: 'buy', itemId: idea, qty: 1 });
ok(r.status === 200, 'grandma buys the secret idea');
r = await sam.op({ op: 'buy', itemId: lego, qty: 1 });
ok(r.status === 403, 'sam cannot buy from own list');
r = await sam.op({ op: 'chip', itemId: cookies, amount: '5' });
ok(r.status === 403, 'sam cannot chip in on own list');

// THE PROMISE: Sam's view carries nothing about purchases, chip-ins or secret ideas.
r = await sam.data();
{
  const mine = r.data.items.filter(i => i.ownerId === ids.Sam);
  ok(mine.length === 3, `sam sees his 3 items, got ${mine.length}`);
  ok(!mine.some(i => i.id === idea), 'sam does not see the secret idea');
  for (const i of mine) {
    for (const k of ['buys', 'chips', 'bought', 'need', 'secret', 'addedBy', 'removed']) ok(!(k in i), `owner item has no ${k}`);
  }
  ok(mine.find(i => i.id === socks).qty === 3, 'owner still sees qty 3 for socks (bought hidden)');
  const text = JSON.stringify(r.data);
  ok(!text.includes('Knitted dog'), 'secret idea title absent from owner payload');
  ok(!/"cents"|"buyer"/.test(text), 'no chip/buyer fields anywhere in owner payload');
  ok(r.data.people.find(p => p.id === ids.Sam).about.includes('hiking'), 'about visible');
  ok(!('email' in r.data.people[0]), 'non-admin does not see emails');
}
// John (a shopper) sees it all.
r = await john.data();
{
  const l = r.data.items.find(i => i.id === lego);
  ok(l.buys.length === 1 && l.buys[0].mine && l.need === 0, 'john sees his own lego buy');
  const s = r.data.items.find(i => i.id === socks);
  ok(s.buys.length === 2 && s.bought === 3, 'john sees both sock buys');
  const c = r.data.items.find(i => i.id === cookies);
  ok(c.chips.length === 1 && c.chips[0].person === 'Jane' && c.chips[0].cents === 5000, 'john sees jane chip');
  const d = r.data.items.find(i => i.id === idea);
  ok(d && d.secret && d.addedBy === 'Jane' && d.buys[0].buyer === 'Grandma', 'john sees secret idea and its buyer');
  ok(r.data.shopping.buys.length === 2, 'john shopping lists his 2 buys');
  ok(typeof r.data.people.find(p => p.id === ids.Jane).email === 'string', 'admin sees emails');
}

// Owner edits after a buy: buyer is told.
r = await sam.op({ op: 'editItem', id: lego, url: 'https://www.lego.com/x', title: 'LEGO Batmobile Tumbler (black)', price: '189.95', qty: 1 });
ok(r.status === 200, 'sam edits lego');
r = await john.data();
ok(r.data.items.find(i => i.id === lego).buys[0].changed === true, 'john sees changed-after-buy');
r = await john.op({ op: 'editItem', id: lego, title: 'hack', qty: 1 });
ok(r.status === 403, 'john cannot edit sam item');

// Owner removes a bought item: gone for him, kept (flagged) for the buyer, same answer.
const removeBought = await sam.op({ op: 'removeItem', id: lego });
const tmp = await sam.op({ op: 'addItem', ownerId: ids.Sam, title: 'temp' });
const removeFree = await sam.op({ op: 'removeItem', id: tmp.data.id });
ok(removeBought.status === 200 && removeFree.status === 200, 'both removes succeed');
ok(Object.keys(removeBought.data).join() === Object.keys(removeFree.data).join(), 'remove answers have the same shape');
ok(!removeBought.data.items.some(i => i.id === lego), 'lego gone from sam view');
r = await john.data();
ok(r.data.items.find(i => i.id === lego)?.removed === true, 'john still sees removed lego');
r = await john.data();
ok(!r.data.items.some(i => i.id === tmp.data.id), 'unbought removed item is gone for everyone');

// Given: grandma gave 2 socks; sam now sees 1 wanted.
r = await grandma.data();
const gBuy = r.data.items.find(i => i.id === socks).buys.find(b => b.mine);
r = await grandma.op({ op: 'given', buyId: gBuy.id });
ok(r.status === 200, 'grandma marks given');
r = await sam.data();
ok(r.data.items.find(i => i.id === socks).qty === 1, 'sam now sees 1 sock wanted after 2 given');
// Sam changes the socks while 2 are given. His form shows 1 wanted; saving it keeps 1 wanted.
{
  const before = (await sam.data()).data.items.find(i => i.id === socks);
  r = await sam.op({ op: 'editItem', id: socks, title: before.title, url: before.url,
    price: before.priceCents === null ? '' : String(before.priceCents / 100), note: before.note, qty: before.qty });
  ok(r.status === 200 && r.data.items.find(i => i.id === socks).qty === 1, 'saving the form keeps 1 wanted, not 1 minus the 2 given');
  ok((await john.data()).data.items.find(i => i.id === socks).qty === 1, 'shoppers still see 1 wanted');
}
r = await grandma.op({ op: 'unbuy', buyId: gBuy.id });
ok(r.status === 409, 'cannot unbuy a given gift');
r = await grandma.op({ op: 'ungiven', buyId: gBuy.id });
ok(r.status === 200, 'grandma can undo given');
r = await john.op({ op: 'unbuy', buyId: gBuy.id });
ok(r.status === 409, 'john cannot unbuy grandma buy');

// Kids: Ella hidden from parents, Max visible.
r = await jane.op({ op: 'addItem', ownerId: ids.Ella, title: 'Paint set', price: '20' });
ok(r.status === 200 && !r.data.items.find(i => i.id === r.data.id).secret, 'jane adds to Ella list (not secret)'); const paint = r.data.id;
r = await jane.op({ op: 'addItem', ownerId: ids.Max, title: 'Dino book', price: '12' });
ok(r.status === 200, 'jane adds to Max list'); const dino = r.data.id;
await grandma.op({ op: 'buy', itemId: paint, qty: 1 });
await grandma.op({ op: 'buy', itemId: dino, qty: 1 });
r = await jane.data();
{
  const p = r.data.items.find(i => i.id === paint);
  ok(p && !('buys' in p) && p.rel === 'manage', 'jane cannot see Ella purchases');
  const d = r.data.items.find(i => i.id === dino);
  ok(d && d.buys.length === 1 && d.rel === 'parent' && d.canEdit, 'jane sees Max purchases and can edit');
}
r = await jane.op({ op: 'buy', itemId: paint, qty: 1 });
ok(r.status === 403, 'jane cannot buy on hidden kid list');
r = await sam.op({ op: 'addItem', ownerId: ids.Ella, title: 'Idea for Ella' });
ok(r.data.items.find(i => i.id === r.data.id).secret === true, 'sam idea on Ella list is secret');
const ellaIdea = r.data.id;
r = await jane.data();
ok(!r.data.items.some(i => i.id === ellaIdea), 'jane (hidden parent) does not see idea for Ella');
const kidLogin = await new User('').call('/api/lists/login', { email: '' });
ok(kidLogin.status === 400, 'empty email refused');

// Codes: five wrong tries burn the code.
{
  const g2 = new User('grandma@example.com');
  await new Promise(res => setTimeout(res, 10));
  // grandma's last send was moments ago, so wait out the 45s resend rule by using Jane's fresh account instead
}
{
  // Force a fresh code for a new person.
  r = await john.op({ op: 'savePerson', name: 'Uncle Bob', email: 'bob@example.com' });
  const bob = new User('bob@example.com');
  const sent = await bob.call('/api/lists/login', { email: bob.email });
  const good = sent.data.dev.code;
  const wrong = good === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const w = await bob.call('/api/lists/login', { email: bob.email, code: wrong });
    ok(w.status === 401, 'wrong code refused');
  }
  const late = await bob.call('/api/lists/login', { email: bob.email, code: good });
  ok(late.status === 401, 'right code refused after 5 wrong tries');
  const again = await bob.call('/api/lists/login', { email: bob.email });
  ok(again.status === 200 && !again.data.dev, 'resend inside 45s sends nothing');
}

// Sign out everywhere.
r = await john.op({ op: 'signOutPerson', id: ids.Sam });
ok(r.status === 200, 'john signs sam out everywhere');
r = await sam.data();
ok(r.status === 401, 'sam cookie no longer works');

// Photos
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await jane.call('/api/lists/photo', { data: png });
  ok(up.status === 200 && /^photo:[a-f0-9]+$/.test(up.data.image), 'photo upload');
  const id = up.data.image.slice(6);
  const res = await fetch(`${BASE}/api/lists/photo?id=${id}`, { headers: { Cookie: jane.cookie } });
  ok(res.status === 200 && res.headers.get('content-type') === 'image/png', 'photo served to signed-in person');
  const anon = await fetch(`${BASE}/api/lists/photo?id=${id}`);
  ok(anon.status === 401, 'photo refused when signed out');
  const notPhoto = await jane.call('/api/lists/photo', { data: 'data:image/png;base64,' + Buffer.from('hello').toString('base64') });
  ok(notPhoto.status === 400, 'non-image refused');
}

// Lookup safety
{
  const loc = await jane.call('/api/lists/lookup', { url: 'http://127.0.0.1:4350/lists' });
  ok(loc.data.blocked === 'port' || loc.data.blocked === 'private', 'lookup refuses local address: ' + JSON.stringify(loc.data));
  const loc3 = await jane.call('/api/lists/lookup', { url: 'http://127.0.0.1:4350/p/fleece-throw-blanket/-/A-1' });
  ok(loc3.data.blocked && loc3.data.guess && loc3.data.guess.title === 'Fleece Throw Blanket' && /filled in from the link/.test(loc3.data.message),
    'a refused lookup still offers the name from the link: ' + JSON.stringify(loc3.data));
  const loc2 = await jane.call('/api/lists/lookup', { url: 'http://localhost/' });
  ok(loc2.status === 400 || loc2.data.blocked, 'lookup refuses localhost');
  const anon = await new User('').call('/api/lists/lookup', { url: 'https://example.com' });
  ok(anon.status === 401, 'lookup needs sign in');
}

// The iPhone shortcut link: John only, iCloud shortcut links only, everyone sees it.
{
  const good = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
  let r2 = await jane.op({ op: 'saveSettings', shortcutLink: good });
  ok(r2.status === 403, 'jane cannot set the shortcut link');
  r2 = await john.op({ op: 'saveSettings', shortcutLink: 'https://evil.example.com/shortcuts/abc' });
  ok(r2.status === 400, 'non-iCloud link refused');
  r2 = await john.op({ op: 'saveSettings', shortcutLink: 'javascript:alert(1)' });
  ok(r2.status === 400, 'javascript link refused');
  r2 = await john.op({ op: 'saveSettings', shortcutLink: good });
  ok(r2.status === 200 && r2.data.settings.shortcutLink === good, 'john saves the iCloud link');
  r2 = await grandma.data();
  ok(r2.data.settings.shortcutLink === good, 'everyone sees the shortcut link');
  r2 = await john.op({ op: 'saveSettings', shortcutLink: '' });
  ok(r2.status === 200 && r2.data.settings.shortcutLink === '', 'link can be cleared');
}

// Parents add lists for their own children. A child never gets an email or admin, the
// parent always stays a keeper, and only keepers (or John) change or remove the list.
{
  const kid = (who, body) => who.op({ op: 'saveKid', managers: [], parentsSee: true, ...body });
  let k = await kid(jane, { name: 'Rosie' });
  ok(k.status === 200 && k.data.id, 'jane adds a list for Rosie: ' + JSON.stringify(k.data).slice(0, 160));
  const rosie = k.data.id;
  let rp = k.data.people.find(p => p.id === rosie);
  ok(rp.kid && rp.rel === 'parent' && rp.managers.includes(ids.Jane) && rp.parentsSee === true, 'Rosie is a child Jane keeps, purchases shown');
  ok(!('email' in rp) && !('admin' in rp), 'a parent is not sent email or admin fields');
  let g = await grandma.data();
  const gr = g.data.people.find(p => p.id === rosie);
  ok(gr && gr.rel === 'shop' && !('managers' in gr) && gr.keptBy.includes('Jane'), 'grandma shops for Rosie and does not get the settings');
  let s = await john.data();
  ok(s.data.people.find(p => p.id === rosie).addedBy === 'Jane', 'john sees that Jane added Rosie');

  await jane.op({ op: 'saveKid', id: rosie, name: 'Rosie', email: 'rosie@example.com', admin: true, managers: [], parentsSee: true });
  s = await john.data();
  const sr = s.data.people.find(p => p.id === rosie);
  ok(sr.email === '' && sr.admin === false, 'saveKid never sets an email or admin, so no one new can sign in');
  const rosieLogin = await new User('rosie@example.com').call('/api/lists/login', { email: 'rosie@example.com' });
  ok(rosieLogin.status === 200 && !rosieLogin.data.dev, 'no sign-in for an email a parent tried to add');

  k = await kid(jane, { id: rosie, name: 'Rosie', managers: [ids.Grandma, ids.Ella], parentsSee: false });
  rp = k.data.people.find(p => p.id === rosie);
  ok(rp.managers.includes(ids.Jane) && rp.managers.includes(ids.Grandma) && !rp.managers.includes(ids.Ella) && rp.rel === 'manage',
    'grandma added as the other parent, jane stays, a child cannot keep a list, purchases now hidden');
  g = await grandma.data();
  ok(g.data.people.find(p => p.id === rosie).rel === 'manage', 'grandma now keeps Rosie\'s list too');
  k = await kid(grandma, { id: rosie, name: 'Rosie', managers: [], parentsSee: false });
  ok(k.status === 200 && k.data.people.find(p => p.id === rosie).managers.includes(ids.Jane),
    'grandma, a second parent, cannot take Jane (who made the list) off it');
  k = await john.op({ op: 'saveKid', id: rosie, name: 'Rosie', managers: [ids.Jane, ids.Grandma], parentsSee: false });
  ok(k.status === 200 && !k.data.people.find(p => p.id === rosie).managers.includes(k.data.me.id),
    'john changes Rosie\'s list without becoming one of her parents');
  k = await kid(jane, { id: rosie, name: 'Rosie', managers: [] });
  ok(k.data.people.find(p => p.id === rosie).managers.join() === ids.Jane, 'jane takes grandma off; she cannot take herself off');

  k = await kid(grandma, { name: 'rosie' });
  ok(k.status === 400 && /kept by Jane/.test(k.data.message), 'a second list for the same child is refused and says who keeps it');
  k = await kid(grandma, { name: 'Jane' });
  ok(k.status === 400 && /already on the list/.test(k.data.message), 'a child cannot take a grown-up\'s name');
  k = await kid(grandma, { id: rosie, name: 'Rosie G' });
  ok(k.status === 403, 'grandma, no longer a keeper, cannot change Rosie\'s list');
  k = await grandma.op({ op: 'removeKid', id: rosie });
  ok(k.status === 403, 'grandma cannot remove Rosie\'s list');
  k = await kid(jane, { id: ids.Grandma, name: 'Grandma' });
  ok(k.status === 403, 'saveKid refuses a grown-up');
  k = await jane.op({ op: 'removeKid', id: ids.Grandma });
  ok(k.status === 403, 'removeKid refuses a grown-up');
  k = await kid(jane, { id: ids.Max, name: 'Max' });
  ok(k.status === 200, 'jane keeps Max (John set that up), so she can change his list');

  k = await jane.op({ op: 'addItem', ownerId: rosie, title: 'Doll house' });
  const doll = k.data.id;
  k = await grandma.op({ op: 'buy', itemId: doll, qty: 1 });
  ok(k.status === 200, 'grandma buys the doll house for Rosie');
  k = await jane.data();
  ok(k.data.items.find(i => i.id === doll).bought === 1, 'with purchases shown, jane sees it was bought');
  k = await kid(jane, { id: rosie, name: 'Rosie', parentsSee: false });
  const hid = k.data.items.find(i => i.id === doll);
  ok(hid && hid.buys === undefined && hid.bought === undefined, 'with purchases hidden, jane sees no sign of it');

  k = await jane.op({ op: 'removeKid', id: rosie });
  ok(k.status === 200 && !k.data.people.some(p => p.id === rosie) && !k.data.items.some(i => i.id === doll), 'jane removes Rosie\'s list and its items');
  g = await grandma.data();
  ok(!g.data.shopping.buys.some(b => b.itemId === doll), 'grandma\'s purchase for Rosie goes with it');

  for (let i = 1; i <= 12; i++) k = await kid(jane, { name: `Child ${i}` });
  ok(k.status === 200, 'twelve children allowed');
  k = await kid(jane, { name: 'Child 13' });
  ok(k.status === 400 && /up to 12/.test(k.data.message), 'a thirteenth is refused');
  k = await jane.data();
  for (const p of k.data.people.filter(x => /^Child \d+$/.test(x.name))) await jane.op({ op: 'removeKid', id: p.id });
  k = await jane.data();
  ok(!k.data.people.some(x => /^Child \d+$/.test(x.name)), 'cleaned up');
}

// Who can see a list. Carlos Garcia keeps his family's lists from Mary; John still sees all.
const mary = new User('mary@example.com'), carlos = new User('carlos@example.com');
{
  for (const [name, email] of [['Mary', 'mary@example.com'], ['Carlos Garcia', 'carlos@example.com']]) {
    r = await john.op({ op: 'savePerson', name, email }); ids[name] = r.data.id;
  }
  await mary.signIn(); await carlos.signIn();
  r = await carlos.op({ op: 'saveKid', name: 'Lucy Garcia', managers: [], parentsSee: true }); ids.Lucy = r.data.id;
  r = await carlos.op({ op: 'addItem', ownerId: ids['Carlos Garcia'], title: 'Fishing reel' }); const reel = r.data.id;
  r = await carlos.op({ op: 'addItem', ownerId: ids.Lucy, title: 'Paint set' }); const lucyPaint = r.data.id;
  r = await mary.op({ op: 'buy', itemId: reel, qty: 1 });
  ok(r.status === 200, 'mary buys the reel while she can still see Carlos\'s list');

  r = await carlos.op({ op: 'saveAudience', personId: ids['Carlos Garcia'], audience: [ids.Jane, ids.Grandma, ids.Lucy, ids['Carlos Garcia']], kidsToo: true });
  ok(r.status === 200, 'carlos shares his list with Jane and Grandma only, his kids\' lists too');
  const dp = r.data.people.find(p => p.id === ids['Carlos Garcia']);
  ok(dp.audience.join() === [ids.Jane, ids.Grandma].join(), 'kids and himself are dropped from the audience: ' + JSON.stringify(dp.audience));
  ok(r.data.people.find(p => p.id === ids.Lucy).audience.join() === [ids.Jane, ids.Grandma].join(), 'Lucy\'s list follows');

  let t = await mary.data();
  ok(!t.data.people.some(p => p.id === ids['Carlos Garcia'] || p.id === ids.Lucy), 'mary does not see Carlos or Lucy in the names');
  ok(!t.data.items.some(i => i.id === reel || i.id === lucyPaint), 'nor any of their things');
  ok(t.data.members.some(m => m.name === 'Carlos Garcia') && !t.data.members.some(m => m.name === 'Lucy Garcia'), 'members (for choosing) are grown-ups by name');
  const mine = t.data.shopping.buys.find(b => b.itemId === reel);
  ok(mine && mine.hidden === true && mine.ownerName === 'Carlos Garcia', 'her purchase stays in My shopping, marked hidden');
  r = await mary.op({ op: 'given', buyId: mine.id });
  ok(r.status === 200, 'and she can still mark it given');
  r = await mary.op({ op: 'addItem', ownerId: ids.Lucy, title: 'Sneaky idea' });
  ok(r.status === 403, 'mary cannot add an idea to a list she cannot see');
  r = await mary.op({ op: 'saveKid', name: 'lucy garcia', managers: [], parentsSee: true });
  ok(r.status === 400 && !/Carlos|kept by|list for/.test(r.data.message), 'a name clash with a hidden list gives nothing away: ' + r.data.message);
  r = await mary.op({ op: 'buy', itemId: lucyPaint, qty: 1 });
  ok(r.status === 409 && !r.data.items.some(i => i.id === lucyPaint), 'nor buy from it; the answer gives nothing away');
  r = await mary.op({ op: 'chip', itemId: lucyPaint, amount: '5' });
  ok(r.status === 409, 'nor chip in');
  r = await mary.op({ op: 'saveAudience', personId: ids['Carlos Garcia'], audience: null });
  ok(r.status === 403, 'mary cannot change who sees Carlos\'s list');
  r = await grandma.op({ op: 'saveAudience', personId: ids.Lucy, audience: null });
  ok(r.status === 403, 'grandma, who is not Lucy\'s parent, cannot either');
  let g2 = await grandma.data();
  ok(g2.data.people.some(p => p.id === ids.Lucy) && g2.data.items.some(i => i.id === lucyPaint), 'grandma, in the audience, sees Lucy\'s list');
  ok(!('audience' in g2.data.people.find(p => p.id === ids.Lucy)), 'but not who it is shared with');
  let s2 = await john.data();
  ok(s2.data.people.some(p => p.id === ids.Lucy) && Array.isArray(s2.data.people.find(p => p.id === ids.Lucy).audience), 'john sees every list, and its sharing');
}

// One gift for only some people. The rest never receive it at all.
{
  const giftFor = async (u, body) => (await u.op({ op: 'addItem', qty: 1, ...body })).data;
  let d = await giftFor(jane, { ownerId: ids.Jane, title: 'Surprise party supplies', audience: [ids.Grandma, ids.Jane, ids.Mary] });
  const party = d.id;
  const mine = d.items.find(i => i.id === party);
  ok(mine.limited && mine.audience.join() === [ids.Grandma, ids.Mary].join(), 'jane limits a gift to Grandma and Mary (not herself): ' + JSON.stringify(mine.audience));
  let g = await grandma.data();
  const gi = g.data.items.find(i => i.id === party);
  ok(gi && gi.limited && !('audience' in gi), 'grandma sees it, told it is limited, without the names');
  let c = await carlos.data();
  ok(!c.data.items.some(i => i.id === party), 'carlos, not picked, never receives it');
  r = await carlos.op({ op: 'buy', itemId: party, qty: 1 });
  ok(r.status === 409 && !r.data.items.some(i => i.id === party), 'nor can he buy it, and the answer gives nothing away');
  r = await carlos.op({ op: 'chip', itemId: party, amount: '5' });
  ok(r.status === 409, 'nor chip in');
  r = await carlos.op({ op: 'editItem', id: party, title: 'Hacked', qty: 1 });
  ok(r.status === 409, 'nor change it');
  ok((await john.data()).data.items.some(i => i.id === party), 'the admin sees every gift');
  r = await grandma.op({ op: 'buy', itemId: party, qty: 1 });
  ok(r.status === 200, 'grandma buys it');
  d = (await jane.op({ op: 'editItem', id: party, title: 'Surprise party supplies', qty: 1, audience: [ids.Mary] })).data;
  ok(d.items.find(i => i.id === party).audience.join() === ids.Mary, 'jane narrows it to Mary');
  g = await grandma.data();
  ok(g.data.items.some(i => i.id === party), 'grandma, who bought it, still sees it');
  d = (await jane.op({ op: 'editItem', id: party, title: 'Surprise party supplies', qty: 1, audience: null })).data;
  ok(!d.items.find(i => i.id === party).limited, 'no audience means everyone who can see the list');
  c = await carlos.data();
  ok(c.data.items.some(i => i.id === party), 'carlos sees it now');

  d = await giftFor(grandma, { ownerId: ids.Jane, title: 'Spa day', audience: [ids.Mary, ids.Jane] });
  const spa = d.id;
  ok(d.items.find(i => i.id === spa).secret && d.items.find(i => i.id === spa).audience.join() === ids.Mary,
    'a secret idea can be limited too; the person it is for is dropped');
  ok(!(await jane.data()).data.items.some(i => i.id === spa), 'jane never sees the idea for her');
  ok((await mary.data()).data.items.find(i => i.id === spa)?.secret === true, 'mary, picked, sees the secret idea');
  ok(!(await carlos.data()).data.items.some(i => i.id === spa), 'carlos does not');
  r = await mary.op({ op: 'editItem', id: spa, title: 'Spa day', qty: 1, audience: null });
  ok(r.status === 403, 'only whoever added an idea can change who sees it');

  d = await giftFor(carlos, { ownerId: ids.Lucy, title: 'Bike helmet', audience: [ids.Jane] });
  const helmet = d.id;
  ok(d.items.some(i => i.id === helmet), 'a parent sees a limited gift on the kid\'s list');
  ok((await jane.data()).data.items.some(i => i.id === helmet), 'jane, picked, sees it');
  ok(!(await grandma.data()).data.items.some(i => i.id === helmet), 'grandma, who can see Lucy\'s list but was not picked, does not');
  await jane.op({ op: 'removeItem', id: party }); await grandma.op({ op: 'removeItem', id: spa }); await carlos.op({ op: 'removeItem', id: helmet });
}

// A secret idea left behind by someone who was removed is not stuck: John can change it.
{
  r = await john.op({ op: 'savePerson', name: 'Cousin Pat', email: 'pat@example.com' });
  const patId = r.data.id;
  const pat = new User('pat@example.com'); await pat.signIn();
  r = await pat.op({ op: 'addItem', ownerId: ids.Jane, title: 'Idea from Pat', qty: 1 });
  const orphan = r.data.id;
  ok(r.data.items.find(i => i.id === orphan).addedByMe === true, 'the page is told which ideas are mine, by id rather than by name');
  ok((await grandma.data()).data.items.find(i => i.id === orphan).addedByMe === false, 'and which are not');
  await john.op({ op: 'removePerson', id: patId });
  ok((await john.data()).data.items.find(i => i.id === orphan).canEdit === true, 'john can change an idea whose author is gone');
  ok((await grandma.data()).data.items.find(i => i.id === orphan).canEdit === false, 'nobody else can');
  r = await john.op({ op: 'removeItem', id: orphan });
  ok(r.status === 200 && !r.data.items.some(i => i.id === orphan), 'and john can remove it');
}

// Asking to join, from the sign-in page. John stays the gatekeeper.
{
  const anon = new User('');
  const ask = body => anon.call('/api/lists/request', body);
  r = await ask({ name: 'Cousin Pat', email: 'pat@example.com', note: 'Jane\'s cousin' });
  ok(r.status === 200 && /will see your request/.test(r.data.message), 'a stranger can ask to join');
  r = await ask({ name: 'Cousin Patty', email: 'PAT@example.com', note: 'second try' });
  let s3 = await john.data();
  const pats = s3.data.requests.filter(x => x.email === 'pat@example.com');
  ok(pats.length === 1 && pats[0].name === 'Cousin Patty', 'asking again updates the request, no duplicates');
  const same = await ask({ name: 'Jane', email: 'jane@example.com' });
  ok(same.status === 200 && same.data.message === r.data.message, 'an address already on the list gets the same answer');
  s3 = await john.data();
  ok(!s3.data.requests.some(x => x.email === 'jane@example.com'), 'and makes no request');
  r = await ask({ name: 'Bot', email: 'bot@example.com', website: 'http://spam.example' });
  s3 = await john.data();
  ok(r.status === 200 && !s3.data.requests.some(x => x.email === 'bot@example.com'), 'the hidden field quietly drops bots');
  r = await ask({ name: 'No Email', email: 'not-an-email' });
  ok(r.status === 400, 'a bad email is refused');
  r = await anon.call('/api/lists/request', undefined);
  ok(r.status === 405 || r.status === 400, 'GET is not allowed');
  let a3 = await jane.data();
  ok(!('requests' in a3.data), 'only john sees requests');
  r = await jane.op({ op: 'dismissRequest', id: pats[0].id });
  ok(r.status === 403, 'only john can decline');
  const loginPat = await new User('pat@example.com').call('/api/lists/login', { email: 'pat@example.com' });
  ok(loginPat.status === 200 && !loginPat.data.dev, 'a request does not let anyone sign in');
  r = await john.op({ op: 'savePerson', name: 'Cousin Pat', email: 'pat@example.com' });
  ok(r.status === 200 && !r.data.requests.some(x => x.email === 'pat@example.com'), 'adding the person answers the request');
  await ask({ name: 'Unknown', email: 'unknown@example.com' });
  s3 = await john.data();
  const unk = s3.data.requests.find(x => x.email === 'unknown@example.com');
  r = await john.op({ op: 'dismissRequest', id: unk.id });
  ok(r.status === 200 && !r.data.requests.some(x => x.id === unk.id), 'john declines a request');
  for (let i = 0; i < 30; i++) await ask({ name: `Flood ${i}`, email: `flood${i}@example.com` });
  s3 = await john.data();
  ok(s3.data.requests.length <= 25, 'no more than 25 requests wait at once: ' + s3.data.requests.length);
  for (const x of s3.data.requests) await john.op({ op: 'dismissRequest', id: x.id });
}

// Drawing names. Nobody sees who drew whom except the giver (or a kid giver's parents).
{
  const people = { [ids.John || (await john.data()).data.me.id]: john };
  const meId = (await john.data()).data.me.id;
  const users = { [meId]: john, [ids.Jane]: jane, [ids.Grandma]: grandma, [ids.Mary]: mary, [ids['Carlos Garcia']]: carlos };
  const who = Object.keys(users).concat([ids.Lucy]);
  // Carlos's family is still hidden from Mary, and John and Jane are kept apart.
  r = await john.op({ op: 'saveDraw', name: 'Christmas 2026', participants: who, apart: [[meId, ids.Jane]], budget: '$30', giveBy: '2026-12-24' });
  ok(r.status === 200 && r.data.id, 'john starts a draw of six, one a kid');
  const drawId = r.data.id;
  let d = r.data.draws.find(x => x.id === drawId);
  ok(d && d.canManage && !d.drawnAt && d.participants.length === 6 && d.apart.length === 1, 'not drawn yet');
  r = await mary.op({ op: 'drawNames', id: drawId });
  ok(r.status === 403, 'only the organizer (or John) draws');
  let t = await mary.data();
  const td = t.data.draws.find(x => x.id === drawId);
  ok(td && !td.canManage && !('apart' in td), 'mary sees the draw but not its settings');
  ok(td.apartCount === 1, 'but she does see how many pairs are kept apart');

  const collect = async () => {
    const match = {};
    for (const [id, u] of Object.entries(users)) {
      const v = (await u.data()).data.draws.find(x => x.id === drawId);
      if (v.myMatch) match[id] = v.myMatch.id;
      for (const k of v.kidMatches || []) match[k.kid] = k.id;
      const json = JSON.stringify(v);
      const others = Object.keys(users).filter(x => x !== id);
      ok(!others.some(o => (v.kidMatches || []).some(k => k.kid === o)), `${id} sees no one else's match`);
      ok(!/"pairs"/.test(json), 'the full list of matches is never sent');
    }
    return match;
  };
  for (let round = 0; round < 12; round++) {
    r = await john.op({ op: 'drawNames', id: drawId });
    ok(r.status === 200, 'draw ' + JSON.stringify(r.data.message || ''));
    const m = await collect();
    const givers = Object.keys(m), receivers = Object.values(m);
    ok(givers.length === 6 && new Set(receivers).size === 6 && who.every(id => receivers.includes(id)), 'everyone gives once and gets once');
    ok(givers.every(g => m[g] !== g), 'nobody draws themselves');
    ok(m[meId] !== ids.Jane && m[ids.Jane] !== meId, 'John and Jane are kept apart');
    ok(m[ids.Lucy] !== ids['Carlos Garcia'] && m[ids['Carlos Garcia']] !== ids.Lucy, 'a kid and her parent never draw each other');
    ok(m[ids.Mary] !== ids['Carlos Garcia'] && m[ids.Mary] !== ids.Lucy, 'mary never draws a list hidden from her');
  }
  // Drawing someone opens their list to you, even if they hide it later.
  const gm = (await grandma.data()).data.draws.find(x => x.id === drawId).myMatch.id;
  const ownerOf = id => (id === ids.Lucy ? carlos : users[id]);
  await ownerOf(gm).op({ op: 'saveAudience', personId: gm, audience: [] });
  let g4 = await grandma.data();
  ok(g4.data.people.some(p => p.id === gm), 'grandma still sees the list of the person she drew');
  const bobView = await new User('bob@example.com');
  await ownerOf(gm).op({ op: 'saveAudience', personId: gm, audience: null });

  r = await john.op({ op: 'saveDraw', id: drawId, name: 'Christmas 2026', participants: who.filter(x => x !== ids.Grandma), apart: [[meId, ids.Jane]], budget: '$30', giveBy: '2026-12-24' });
  d = r.data.draws.find(x => x.id === drawId);
  ok(d.redraw && !d.drawnAt && !d.myMatch, 'changing who is in it clears the matches and asks for a new draw');
  r = await john.op({ op: 'saveDraw', name: 'Impossible', participants: [meId, ids.Jane, ids.Grandma], apart: [[meId, ids.Jane], [meId, ids.Grandma]] });
  const imp = r.data.id;
  r = await john.op({ op: 'drawNames', id: imp });
  ok(r.status === 400 && /John has nobody they can draw/.test(r.data.message), 'an impossible draw says who is stuck: ' + r.data.message);
  r = await john.op({ op: 'saveDraw', name: 'Too small', participants: [meId, ids.Jane] });
  ok(r.status === 400, 'a draw needs three people');
  // The organizer cannot use Keep apart pairs to force a match.
  r = await john.op({ op: 'saveDraw', name: 'Rigged', participants: [meId, ids.Jane, ids.Grandma, ids.Mary], apart: [[meId, ids.Jane], [meId, ids.Grandma]] });
  const rig = r.data.id;
  r = await john.op({ op: 'drawNames', id: rig });
  ok(r.status === 400 && /John could only draw one person/.test(r.data.message), 'pairs that force a match are refused: ' + r.data.message);
  await john.op({ op: 'removeDraw', id: rig });
  // Changing a draw keeps people whose list is now hidden from the organizer.
  await carlos.op({ op: 'saveAudience', personId: ids['Carlos Garcia'], audience: null });
  r = await mary.op({ op: 'saveDraw', name: 'Cousins', participants: [ids.Mary, ids.Jane, ids.Grandma, ids['Carlos Garcia']] });
  const cousins = r.data.id;
  ok(r.data.draws.find(x => x.id === cousins).participants.length === 4, 'mary starts a draw of four while she can see Carlos');
  await carlos.op({ op: 'saveAudience', personId: ids['Carlos Garcia'], audience: [ids.Jane, ids.Grandma] });   // hidden from Mary again
  r = await mary.op({ op: 'saveDraw', id: cousins, name: 'Cousins 2026', participants: [ids.Mary, ids.Jane, ids.Grandma, ids['Carlos Garcia']] });
  ok(r.status === 200 && r.data.draws.find(x => x.id === cousins).participants.length === 4, 'renaming it keeps Carlos, though his list is now hidden from her');
  await mary.op({ op: 'removeDraw', id: cousins });
  r = await mary.op({ op: 'saveDraw', name: 'Mary\'s', participants: [ids.Mary, ids.Jane, ids.Grandma, ids['Carlos Garcia']] });
  ok(r.status === 200 && r.data.draws.find(x => x.id === r.data.id).participants.length === 3, 'anyone can start a draw, among the lists they can see');
  r = await mary.op({ op: 'removeDraw', id: r.data.id });
  ok(r.status === 200, 'and remove their own');
  r = await mary.op({ op: 'removeDraw', id: drawId });
  ok(r.status === 403, 'but not someone else\'s');
  // Taking someone off the family list takes them out of the draw too.
  r = await john.op({ op: 'drawNames', id: drawId });
  r = await john.op({ op: 'removePerson', id: ids.Mary });
  d = r.data.draws.find(x => x.id === drawId);
  ok(!d.participants.some(p => p.id === ids.Mary) && d.redraw, 'removing Mary takes her out and asks for a new draw');
  await john.op({ op: 'removeDraw', id: drawId });
  await john.op({ op: 'removeDraw', id: imp });
  void people; void bobView;
}

// The names of this wish list: defaults until the admin sets them, shown before sign-in.
{
  const anon = new User('');
  let c = await anon.call('/api/lists/config');
  ok(c.status === 200 && c.data.title === 'Family Wish List' && c.data.shortTitle === 'Wish List' && c.data.adminName === 'John',
    'config before any names are set: ' + JSON.stringify(c.data));
  ok(Buffer.from(c.data.contactHex, 'hex').toString() === 'john@example.com' && !JSON.stringify(c.data).includes('@'), 'the contact address is sent as hex');
  r = await jane.op({ op: 'saveSettings', title: 'Jane Family List' });
  ok(r.status === 403, 'only the admin names the wish list');
  r = await john.op({ op: 'saveSettings', title: 'Smith Family and Friends Wish List', shortTitle: 'Smith Wish List' });
  ok(r.status === 200 && r.data.site.title === 'Smith Family and Friends Wish List' && r.data.settings.shortTitle === 'Smith Wish List', 'john names it');
  c = await anon.call('/api/lists/config');
  ok(c.data.title === 'Smith Family and Friends Wish List' && c.data.shortTitle === 'Smith Wish List', 'the sign-in page gets the new names');
  r = await john.op({ op: 'saveSettings', shortcutLink: '' });
  ok(r.data.settings.title === 'Smith Family and Friends Wish List', 'saving the shortcut link leaves the names alone');
  const msg = await anon.call('/api/lists/login', { email: 'nobody-here@example.com' });
  ok(/ask John to add this address/.test(msg.data.message), 'sign-in names the admin: ' + msg.data.message);
  r = await john.op({ op: 'saveSettings', title: '', shortTitle: '' });
  c = await anon.call('/api/lists/config');
  ok(c.data.title === 'Family Wish List' && c.data.shortTitle === 'Wish List', 'empty names go back to the defaults');
}

// Unit checks on rules and robots
{
  const rules = await import(pathToFileURL(SITE + '/lib/lists/rules.js').href);
  const meta = await import(pathToFileURL(SITE + '/lib/lists/meta.js').href);
  const t = Date.UTC(2026, 10, 20, 15);                 // Nov 20 2026
  ok(rules.autoGivenAt(t) === Date.UTC(2026, 11, 26, 6), 'Nov buy auto-given Dec 26 midnight Central');
  const late = Date.UTC(2026, 11, 26, 7);              // Dec 26 1am Central
  ok(rules.autoGivenAt(late) === Date.UTC(2027, 11, 26, 6), 'Dec 26 buy carries to next Christmas');
  const eve = Date.UTC(2026, 11, 26, 5, 59);           // Dec 25 11:59pm Central
  ok(rules.autoGivenAt(eve) === Date.UTC(2026, 11, 26, 6), 'Christmas night buy given at midnight');
  ok(rules.parsePrice('$1,299.99') === 129999 && rules.parsePrice('USD 45') === 4500 && rules.parsePrice('free') === null, 'price parsing');
  const robots = 'User-agent: *\nDisallow: /gp/\nAllow: /gp/ok\nDisallow: /*?q=\n\nUser-agent: FamilyWishList\nDisallow: /secret$\n';
  ok(meta.robotsAllows(robots, '/dp/123') === true, 'robots: own group used, /dp allowed');
  ok(meta.robotsAllows(robots, '/secret') === false && meta.robotsAllows(robots, '/secret/x') === true, 'robots: $ anchor');
  const star = 'User-agent: *\nDisallow: /gp/\nAllow: /gp/ok\nDisallow: /*?q=\n';
  ok(meta.robotsAllows(star, '/gp/x') === false && meta.robotsAllows(star, '/gp/ok') === true && meta.robotsAllows(star, '/s?q=1') === false, 'robots: * group rules');
  ok(meta.robotsAllows('User-agent: *\nDisallow: /\n', '/anything') === false, 'robots: disallow all');
  const html = '<html><head><meta property="og:title" content="Big &amp; Bold"><meta property="og:image" content="/img/a.jpg"><script type="application/ld+json">{"@type":"Product","name":"X","offers":{"price":"19.99"}}</script></head></html>';
  const p = meta.parseProduct(html, 'https://shop.example.com/p/1');
  ok(p.title === 'Big & Bold' && p.image === 'https://shop.example.com/img/a.jpg' && p.price === '19.99', 'parseProduct ' + JSON.stringify(p));
  // Names from the link alone, when a store will not let the app read its page.
  const guesses = [
    ['https://www.amazon.com/LEGO-Technic-Batmobile-Tumbler-42239/dp/B0EXAMPLE3/ref=sr_1_1', 'LEGO Technic Batmobile Tumbler 42239'],
    ['https://www.target.com/p/threshold-fleece-throw-blanket/-/A-81234567', 'Threshold Fleece Throw Blanket'],
    ['https://www.walmart.com/ip/Ozark-Trail-4-Person-Dome-Tent/123456789', 'Ozark Trail 4 Person Dome Tent'],
    ['https://www.bestbuy.com/site/apple-airpods-pro-2nd-generation/6447382.p?skuId=6447382', 'Apple Airpods Pro 2nd Generation'],
    ['https://www.lego.com/en-us/product/millennium-falcon-75192', 'Millennium Falcon 75192'],
    ['https://www.rei.com/product/168177/big-agnes-torchlight-20-sleeping-bag', 'Big Agnes Torchlight 20 Sleeping Bag'],
    ['https://www.etsy.com/listing/1234567890/personalized-leather-dog-collar', 'Personalized Leather Dog Collar'],
    ['https://shop.example.com/fan-gear/mens-knit-beanie/p-12345', 'Mens Knit Beanie']
  ];
  for (const [u, want] of guesses) ok(meta.guessFromUrl(u)?.title === want, `name from link: ${u} -> ${JSON.stringify(meta.guessFromUrl(u))}`);
  ok(meta.guessFromUrl('https://www.amazon.com/dp/B0EXAMPLE3') === null && meta.guessFromUrl('https://a.co/d/abc123') === null, 'no name in the link: no guess');
  const tidy = [
    ['Amazon.com: LEGO Technic Batmobile : Toys & Games', 'https://www.amazon.com/x', 'LEGO Technic Batmobile'],
    ['Fleece Throw Blanket : Target', 'https://www.target.com/x', 'Fleece Throw Blanket'],
    ['Big Agnes Torchlight 20 | REI Co-op', 'https://www.rei.com/x', 'Big Agnes Torchlight 20'],
    ['Millennium Falcon 75192 | LEGO® Star Wars™ | Buy online at the Official LEGO® Shop US', 'https://www.lego.com/x', 'Millennium Falcon 75192'],
    ["Levi's 505 | Kohl's", 'https://www.kohls.com/x', "Levi's 505"],
    ['Team Beanie - Green', 'https://shop.example.com/x', 'Team Beanie - Green']
  ];
  for (const [t, u, want] of tidy) ok(meta.tidyTitle(t, u) === want, `tidy: ${t} -> ${meta.tidyTitle(t, u)}`);

  // Store lookups never reach a private address, whichever way it is written.
  const addrs = [['127.0.0.1', true], ['10.1.2.3', true], ['169.254.169.254', true], ['100.64.0.1', true], ['::1', true],
    ['::ffff:127.0.0.1', true], ['::ffff:7f00:1', true], ['::7f00:1', true], ['64:ff9b::a00:1', true], ['2002:a00:1::', true],
    ['fe80::1', true], ['fec0::1', true], ['fd00::1', true], ['8.8.8.8', false], ['2606:4700:4700::1111', false]];
  for (const [ip, want] of addrs) ok(meta.privateIp(ip) === want, `private address check: ${ip}`);
  // A robots.txt rule full of * cannot stall the lookup.
  const t0 = Date.now();
  meta.robotsAllows('User-agent: *\nDisallow: /' + '*a'.repeat(250) + 'b\n', '/' + 'a'.repeat(2000));
  ok(Date.now() - t0 < 200, `a hostile robots.txt rule is checked quickly (${Date.now() - t0} ms)`);
  ok(meta.robotsMatch('/*.pdf$', '/a/b.pdf') && !meta.robotsMatch('/*.pdf$', '/a/b.pdfx') && meta.robotsMatch('/a*c', '/abbbc/d'),
    'robots wildcard rules');

  // Name draws, checked against every possible way to match the names.
  const mk = n => Array.from({ length: n }, (_, i) => ({ id: 'person' + i, name: 'P' + i, email: `p${i}@example.com`, managers: [] }));
  let compared = 0;
  for (let round = 0; round < 300; round++) {
    const n = 3 + (round % 4);
    const people = mk(n), ids2 = people.map(p => p.id);
    const apart = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (Math.random() < 0.3) apart.push([ids2[a], ids2[b]]);
    const kept = new Set(apart.flatMap(([a, b]) => [a + b, b + a]));
    const all = [];
    const go = (i, used, cur) => {
      if (i === n) { all.push({ ...cur }); return; }
      for (const r2 of ids2) if (r2 !== ids2[i] && !used.has(r2) && !kept.has(ids2[i] + r2)) {
        used.add(r2); cur[ids2[i]] = r2; go(i + 1, used, cur); used.delete(r2); delete cur[ids2[i]];
      }
    };
    go(0, new Set(), {});
    const state = { people, items: [], buys: [], chips: [], draws: [] };
    let out = null, err = null;
    try { out = rules.drawPairs(state, { participants: ids2, apart }); } catch (e) { err = e.message; }
    const forced = all.length && ids2.some(g => new Set(all.map(m => m[g])).size < 2);
    if (!all.length) ok(err && /cannot be drawn|nobody they can draw/.test(err), 'no way to match: refused');
    else if (forced) ok(err && /could only draw one person/.test(err), 'a forced match is refused: ' + err);
    else if (n > 3 && all.length === 2) ok(err && /only be matched two ways/.test(err), 'two ways only is refused: ' + err);
    else ok(out && ids2.every(g => out[g] && out[g] !== g && !kept.has(g + out[g])) && new Set(Object.values(out)).size === n, 'a fair draw goes ahead');
    compared++;
  }
  ok(compared === 300, 'draw rules compared on 300 groups');

  // A kid's draw: every parent who keeps the kid's list must already see the person drawn.
  {
    const people = mk(5);
    const kidP = { id: 'kidperson', name: 'Kid', email: '', managers: [people[0].id, people[1].id] };
    people[2].audience = [people[0].id, people[3].id, people[4].id];   // hidden only from the kid's second parent
    const state = { people: [...people, kidP], items: [], buys: [], chips: [], draws: [] };
    const who = [kidP.id, people[2].id, people[3].id, people[4].id];
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      try { const out = rules.drawPairs(state, { participants: who, apart: [] }); if (out[kidP.id] === people[2].id) seen++; }
      catch (e) { ok(false, 'this kid draw should go ahead: ' + e.message); }
    }
    ok(seen === 0, 'a kid never draws someone hidden from one of the kid\'s parents');
  }

  // Limits: the owner's own count never includes secret ideas, so it cannot reveal them.
  {
    const owner = { id: 'ownerperson', name: 'Owner', email: 'o@example.com', managers: [] };
    const shopper = { id: 'shopperperson', name: 'Shopper', email: 's@example.com', managers: [] };
    const state = { people: [owner, shopper], items: [], buys: [], chips: [], draws: [] };
    for (let i = 0; i < rules.LIMITS.itemsPerList - 1; i++) state.items.push({ id: 'own' + i, ownerId: owner.id, addedBy: owner.id, secret: false, qty: 1 });
    for (let i = 0; i < rules.LIMITS.ideasPerList; i++) state.items.push({ id: 'idea' + i, ownerId: owner.id, addedBy: shopper.id, secret: true, qty: 1 });
    const add = (me) => rules.apply(state, rules.validate({ op: 'addItem', ownerId: owner.id, title: 'One more', qty: 1 }), me);
    ok(typeof add(owner) === 'string', 'the owner can fill their list to the limit with 100 secret ideas on it');
    let msg = '';
    try { add(owner); } catch (e) { msg = e.message; }
    ok(/This list is full/.test(msg), 'and the limit is the same as with none: ' + msg);
    msg = '';
    try { add(shopper); } catch (e) { msg = e.message; }
    ok(/already 100 secret ideas/.test(msg), 'secret ideas have their own limit: ' + msg);
  }
}

// Store links are checked for safety. The suite runs the instant checks only (no network).
{
  const lc = await import(pathToFileURL(SITE + '/lib/lists/linkcheck.js').href);
  const cases = [
    ['https://www.amazon.com/dp/B0EXAMPLE', 'ok', null],
    ['https://www.rei.com/product/1', 'ok', null],
    ['https://targetpractice.com/range', 'ok', null],
    ['https://mind-the-gap.co.uk/shop', 'ok', null],
    ['https://shop.example.co.uk/x', 'ok', null],
    ['http://shop.example.com/x', 'caution', /not secure/],
    ['https://amazon-deals.shop/x', 'caution', /Amazon in its name, but it goes to amazon-deals\.shop/],
    ['https://bit.ly/abc', 'caution', /short link/],
    ['https://cheap-gifts.top/x', 'caution', /end in \.top/],
    ['https://amazom.com/x', 'danger', /almost the same as amazon\.com/],
    ['https://wallmart.com/x', 'danger', /almost the same as walmart\.com/],
    ['https://arnazon.com/x', 'danger', /almost the same as amazon\.com/],
    ['https://www.amazon.com.account-verify.io/x', 'danger', /starts like amazon\.com, but it really goes to account-verify\.io/],
    ['https://xn--mazon-3ve.com/', 'danger', /another alphabet/],
    ['https://93.184.216.34/x', 'danger', /number instead of a website name/]
  ];
  for (const [u, level, says] of cases) {
    const c = lc.localCheck(u);
    ok(c.level === level && (!says || c.notes.some(n => says.test(n))), `link check ${u}: ${c.level} ${JSON.stringify(c.notes)}`);
  }
  ok(lc.siteOf('www.shop.example.co.uk') === 'example.co.uk' && lc.siteOf('www.amazon.com') === 'amazon.com', 'website names, country endings too');
  ok(lc.localCheck('https://www.lego.com/x').store === 'LEGO', 'a big store is named when the link really goes there');

  // Saved with the gift, and shown to everyone who sees it, the owner too.
  r = await jane.op({ op: 'addItem', ownerId: ids.Jane, title: 'Cheap boots', url: 'https://amazom.com/boots', qty: 1 });
  const boots = r.data.id;
  const mine = r.data.items.find(i => i.id === boots);
  ok(mine.linkCheck && mine.linkCheck.level === 'danger' && mine.linkCheck.site === 'amazom.com', 'the owner sees the warning on her own gift');
  const theirs = (await grandma.data()).data.items.find(i => i.id === boots);
  ok(theirs.linkCheck.level === 'danger' && theirs.linkCheck.notes.length === 1, 'so does a shopper, who is the one who would click it');
  r = await jane.op({ op: 'editItem', id: boots, title: 'Boots', url: 'https://www.amazon.com/dp/B0BOOTS', qty: 1 });
  ok(r.data.items.find(i => i.id === boots).linkCheck.level === 'ok', 'fixing the link clears the warning');
  r = await jane.op({ op: 'editItem', id: boots, title: 'Boots', url: '', qty: 1 });
  ok(r.data.items.find(i => i.id === boots).linkCheck === null, 'no link, no check');
  await jane.op({ op: 'removeItem', id: boots });
  // The lookup answers with the check too, whatever the store said.
  const lk = await jane.call('/api/lists/lookup', { url: 'http://amazon-gift-deals.example.com/p/1' });
  ok(lk.data.check && lk.data.check.level === 'caution' && lk.data.check.notes.length === 2, 'the lookup sends the check: ' + JSON.stringify(lk.data.check));
}

// A damaged data file stops every save instead of starting over from an empty list.
{
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const dir = await mkdtemp(path.join(tmpdir(), 'wl-damaged-'));
  await writeFile(path.join(dir, 'state.json'), '{"people":[{"id":"abc"');
  process.env.LISTS_LOCAL_DIR = dir;
  delete process.env.VERCEL;
  globalThis.WL_DEV = true;
  const store = await import(pathToFileURL(SITE + '/lib/lists/store.js').href);
  let failed = false;
  try { await store.readState(); } catch { failed = true; }
  ok(failed, 'reading a damaged file fails');
  failed = false;
  try { await store.updateState(st => { st.people.push({ id: 'new' }); }); } catch { failed = true; }
  ok(failed && (await readFile(path.join(dir, 'state.json'), 'utf8')) === '{"people":[{"id":"abc"', 'and a save leaves the file as it was');
  globalThis.WL_DEV = false;
  const fresh = await import(pathToFileURL(SITE + '/lib/lists/store.js').href + '?nodev');
  ok(fresh.storageConfigured() === Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
    'outside the dev server, LISTS_LOCAL_DIR alone does nothing');
  await rm(dir, { recursive: true, force: true });
}

console.log(`\nALL ${passed} CHECKS PASSED`);
