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
  ok(v.status === 303 && v.headers.get('location') === '/lists?signin=ok' && sam.cookie, 'link sign-in sets cookie');
  const bad = await new User('x').call('/api/lists/verify?t=garbage');
  ok(bad.status === 303 && bad.headers.get('location') === '/lists?signin=expired', 'bad link refused');
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
  await carlos.op({ op: 'saveAudience', personId: ids['Carlos Garcia'], audience: [ids.Jane, ids.Grandma] });   // hidden from Mary again
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
}

console.log(`\nALL ${passed} CHECKS PASSED`);
