// Asking to join, who can see a list, name draws, and names from store links, driven in the
// browser the way people use them. People are seeded through the API; the steps under test
// are all clicks and typing.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE = process.argv[2];
const errors = []; let n = 0;
const step = m => console.log(`  ok ${++n}. ${m}`);

class User {
  constructor(email) { this.email = email; this.cookie = ''; }
  async call(path, body) {
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json' }, redirect: 'manual' };
    if (this.cookie) init.headers.Cookie = this.cookie;
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(BASE + path, init);
    for (const c of res.headers.getSetCookie()) if (c.startsWith('wl_session=')) this.cookie = c.split(';')[0];
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(d)}`);
    return d;
  }
  async signIn() {
    const r = await this.call('/api/lists/login', { email: this.email });
    await this.call('/api/lists/login', { email: this.email, code: r.dev.code });
    await this.call('/api/lists/data', { op: 'saveSetup', setup: 'done', tour: 'done' });
  }
  op(b) { return this.call('/api/lists/data', b); }
}

// ------------------------------------------------------------ seed
const john = new User('john@example.com');
await john.signIn();
const id = { John: (await john.call('/api/lists/data')).me.id };
for (const [name, email] of [['Jane', 'jane@example.com'], ['Mary', 'mary@example.com'], ['Carlos Garcia', 'carlos@example.com'], ['Maria Garcia', 'maria@example.com']]) {
  id[name] = (await john.op({ op: 'savePerson', name, email })).id;
}
const U = { Jane: new User('jane@example.com'), Mary: new User('mary@example.com'), Carlos: new User('carlos@example.com'), Maria: new User('maria@example.com') };
for (const u of Object.values(U)) await u.signIn();
id.Lucy = (await U.Carlos.op({ op: 'saveKid', name: 'Lucy', managers: [id['Maria Garcia']], parentsSee: true })).id;
const reel = (await U.Carlos.op({ op: 'addItem', ownerId: id['Carlos Garcia'], title: 'Fishing reel', price: '40' })).id;
await U.Carlos.op({ op: 'addItem', ownerId: id.Lucy, title: 'Paint set' });
await U.Mary.op({ op: 'buy', itemId: reel, qty: 1 });

const browser = await chromium.launch();
async function pageFor(user, { width = 1280, height = 900 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  if (user) {
    const [k, v] = user.cookie.split('=');
    await ctx.addCookies([{ name: k, value: v, url: BASE, httpOnly: true, secure: true, sameSite: 'Lax' }]);
  }
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return page;
}
const toast = (p, text) => p.locator('#toastText', { hasText: text }).waitFor();
const h1 = (p, name) => p.getByRole('heading', { level: 1, name }).waitFor();

// ------------------------------------------------------------ asking to join
{
  const p = await pageFor(null, { width: 390, height: 800 });
  await p.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Not on the list yet? Ask to join' }).click();
  assert.equal(await p.evaluate(() => document.activeElement.id), 'rq-name', 'focus on the name');
  await p.getByRole('button', { name: 'Send my request' }).click();
  assert.equal(await p.locator('#rq-name-err').innerText(), 'Enter your name.');
  await p.getByLabel('Your name').fill('Cousin Pat');
  await p.getByLabel('Your email', { exact: true }).fill('pat@example.com');
  await p.getByLabel('How do you know the family? (optional)').fill('Jane\'s cousin');
  await p.getByRole('button', { name: 'Send my request' }).click();
  await p.locator('#signinStatus', { hasText: 'John will see your request' }).waitFor();
  assert.ok(await p.locator('#emailForm').isVisible(), 'back on the sign-in step');
  step('A relative asks to join from the sign-in page (name required), and is told John will see it');

  const s = await pageFor(john);
  await s.goto(BASE + '/lists?view=people', { waitUntil: 'networkidle' });
  await s.getByRole('heading', { name: 'Asking to join (1)' }).waitFor();
  assert.ok((await s.locator('.wl-group', { hasText: 'Asking to join' }).innerText()).includes('"Jane\'s cousin"'));
  await s.getByRole('button', { name: 'Add Cousin Pat' }).click();
  assert.equal(await s.locator('#pf-name').inputValue(), 'Cousin Pat');
  assert.equal(await s.locator('#pf-email').inputValue(), 'pat@example.com');
  await s.getByRole('button', { name: 'Add person' }).click();
  await toast(s, 'Cousin Pat was added.');
  assert.equal(await s.getByRole('heading', { name: /Asking to join/ }).count(), 0, 'the request is answered');
  step('John sees the request on People; Add fills the form with their name and email, and adding answers it');

  await p.getByRole('button', { name: 'Not on the list yet? Ask to join' }).click();
  await p.getByLabel('Your name').fill('Someone');
  await p.getByLabel('Your email', { exact: true }).fill('someone@example.com');
  await p.getByRole('button', { name: 'Send my request' }).click();
  await p.locator('#signinStatus', { hasText: 'will see your request' }).waitFor();
  await s.reload({ waitUntil: 'networkidle' });
  await s.getByRole('button', { name: 'Decline' }).click();
  await toast(s, 'Declined. Nothing is sent to Someone.');
  assert.equal(await s.getByRole('heading', { name: /Asking to join/ }).count(), 0);
  step('Decline clears a request from someone John does not know');
}

// ------------------------------------------------------------ who can see a list
{
  const d = await pageFor(U.Carlos, { width: 390, height: 800 });
  await d.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  assert.ok((await d.locator('.wl-listhead').innerText()).includes('Everyone on the wish list can see your list.'));
  await d.getByRole('button', { name: 'Change who can see it' }).click();
  await d.getByLabel('Only the people I pick').check();
  for (const name of ['Jane', 'Cousin Pat']) await d.getByLabel(name, { exact: true }).check();
  assert.equal(await d.getByLabel('Mary', { exact: true }).isChecked(), false);
  assert.equal(await d.getByLabel('Maria Garcia', { exact: true }).count(), 1, 'every grown-up can be picked');
  await d.getByLabel("Use the same for Lucy's list").check();
  await d.getByRole('button', { name: 'Save' }).click();
  await toast(d, 'Saved. Only Jane and Cousin Pat can see your list.');
  assert.ok((await d.locator('.wl-listhead').innerText()).includes('Only Jane and Cousin Pat can see your list.'));
  step('Carlos shares his list with only Jane and Cousin Pat, and uses the same for Lucy\'s list');

  const t = await pageFor(U.Mary);
  await t.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  const names = await t.locator('.wl-side').innerText();
  assert.ok(!names.includes('Carlos Garcia') && !names.includes('Lucy'), 'no Garcias in Mary\'s names: ' + names);
  assert.ok(names.includes('Maria Garcia'), 'Maria did not hide her list');
  await t.goto(BASE + `/lists?list=${id.Lucy}`, { waitUntil: 'networkidle' });
  await h1(t, 'My list');
  step('Mary does not see Carlos or Lucy at all, even by typing the address; Maria still shows');

  await t.goto(BASE + '/lists?view=shopping', { waitUntil: 'networkidle' });
  const row = t.locator('.wl-row', { hasText: 'Fishing reel' });
  assert.ok((await row.innerText()).includes('Carlos Garcia no longer shares this list with you'));
  assert.equal(await row.locator('a').count(), 0, 'no link to a page she cannot open');
  await row.getByRole('button', { name: 'It has been given' }).click();
  await toast(t, 'Marked given.');
  step('Mary\'s earlier purchase stays in My shopping, without a link, and she can still mark it given');

  await d.goto(BASE + `/lists?list=${id.Lucy}`, { waitUntil: 'networkidle' });
  assert.ok((await d.locator('.wl-listhead').innerText()).includes("Only Jane and Cousin Pat can see Lucy's list, besides Lucy's parents."));
  await d.getByRole('button', { name: 'Who can see it' }).click();
  await d.getByLabel('Everyone on the wish list').check();
  await d.getByRole('button', { name: 'Save' }).click();
  await toast(d, "Everyone on the wish list can see Lucy's list.");
  await t.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  assert.ok((await t.locator('.wl-side').innerText()).includes('Lucy'), 'Lucy shows for Mary again');
  step('On Lucy\'s list, Who can see it switches her back to everyone, and Mary sees her again');

  const s = await pageFor(john);
  await s.goto(BASE + '/lists?view=people', { waitUntil: 'networkidle' });
  assert.ok((await s.locator('.wl-row', { hasText: 'carlos@example.com' }).innerText()).includes('Shared with 2 people'));
  step('People shows John who limited their list');
}

// ------------------------------------------------------------ drawing names
{
  const s = await pageFor(john, { width: 390, height: 800 });
  await s.goto(BASE + '/lists?view=draws', { waitUntil: 'networkidle' });
  await h1(s, 'Draw names');
  assert.ok(await s.getByText('No name draws yet.').isVisible());
  await s.getByRole('button', { name: 'Start a name draw' }).click();
  await s.getByRole('button', { name: 'Save the draw' }).click();
  assert.equal(await s.locator('#df-name-err').innerText(), 'Give the draw a name, like Christmas 2026.');
  await s.getByLabel('Name of the draw').fill('Christmas 2026');
  await s.getByLabel('Spending limit (optional)').fill('$30');
  await s.getByLabel('Give gifts by (optional)').fill('2026-12-24');
  for (const name of ['Jane', 'Mary', 'Carlos Garcia', 'Maria Garcia', 'Lucy (kid)']) await s.getByLabel(name, { exact: true }).check();
  await s.locator('#df-a').selectOption({ label: 'John' });
  await s.locator('#df-b').selectOption({ label: 'Jane' });
  await s.getByRole('button', { name: 'Keep apart', exact: true }).click();
  assert.ok((await s.locator('.wl-apart').innerText()).includes('John and Jane'));
  await s.getByRole('button', { name: 'Save the draw' }).click();
  await toast(s, 'Christmas 2026 is ready. Tap Draw names when everyone is in.');
  const card = s.locator('.wl-draw', { hasText: 'Christmas 2026' });
  assert.ok((await card.innerText()).includes('Spending limit $30') && (await card.innerText()).includes('Give by December 24'));
  assert.ok((await card.innerText()).includes('Names have not been drawn yet.'));
  step('John starts a draw: name required, six people with a kid, a $30 limit, a date, and John and Jane kept apart');

  await card.getByRole('button', { name: 'Draw names' }).click();
  await toast(s, 'Names are drawn.');
  const mine = await card.locator('.wl-match').innerText();
  assert.ok(/^You are giving to (Mary|Carlos Garcia|Maria Garcia|Lucy)\.$/.test(mine), 'John sees only his own match: ' + mine);
  assert.equal(await card.locator('.wl-match').count(), 1, 'one line for John, nobody else\'s');
  step(`Draw names shows John one line, his own: "${mine}"`);

  const dp = await pageFor(U.Carlos, { width: 390, height: 800 });
  await dp.goto(BASE + '/lists?view=draws', { waitUntil: 'networkidle' });
  const lines = await dp.locator('.wl-match').allInnerTexts();
  assert.equal(lines.length, 2, 'Carlos sees his own match and Lucy\'s: ' + lines.join(' | '));
  assert.ok(lines[1].startsWith('Lucy is giving to') && !/Carlos Garcia|Maria Garcia/.test(lines[1]), 'Lucy never draws her parents');
  assert.ok(!/Lucy\.$|Maria Garcia\.$/.test(lines[0]), 'Carlos draws neither his kid nor Maria, who shares a kid with him');
  const to = await dp.locator('.wl-match a').first().innerText();
  await dp.locator('.wl-match a').first().click();
  await h1(dp, to === 'John' ? "John's list" : `${to}'s list`);
  step(`Carlos sees his match and Lucy's (${lines.join('; ')}), and the name opens that list`);

  await card.getByRole('button', { name: 'Draw again' }).click();
  await s.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await card.locator('.wl-match').innerText(), mine, 'Cancel keeps the names');
  await card.getByRole('button', { name: 'Draw again' }).click();
  await s.getByRole('button', { name: 'Yes, draw again' }).click();
  await toast(s, 'Names are drawn again.');
  step('Draw again asks first; Cancel keeps everyone\'s names');

  await card.getByRole('button', { name: 'Edit' }).click();
  assert.ok(await s.getByText('Names are already drawn.').isVisible());
  await s.getByLabel('Mary', { exact: true }).uncheck();
  await s.getByRole('button', { name: 'Save' }).click();
  await toast(s, 'Saved.');
  assert.ok((await s.locator('.wl-draw').innerText()).includes('names need to be drawn again'));
  step('Taking Mary out after the draw warns first, then asks for a new draw');

  const t = await pageFor(U.Mary);
  await t.goto(BASE + '/lists?view=draws', { waitUntil: 'networkidle' });
  assert.ok(await t.getByText('No name draws yet.').isVisible(), 'Mary is no longer in it');
  await s.locator('.wl-draw').getByRole('button', { name: 'Remove this draw' }).click();
  await s.getByRole('button', { name: 'Yes, remove it' }).click();
  await toast(s, 'Christmas 2026 was removed.');
  assert.ok(await s.getByText('No name draws yet.').isVisible());
  step('Remove this draw asks first, then it is gone');
}

// ------------------------------------------------------------ a pasted store link the store will not let us read
{
  const a = await pageFor(U.Jane, { width: 390, height: 800 });
  await a.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await a.getByRole('button', { name: 'Add an item' }).click();
  // A local address stands in for a store that says no: the lookup is refused, and the
  // name still comes from the link.
  await a.getByLabel('Store link').fill('http://127.0.0.1:9/p/threshold-fleece-throw-blanket/-/A-81234567');
  await a.getByRole('button', { name: 'Get details from the link' }).click();
  await a.locator('#toastText', { hasText: 'The name was filled in from the link' }).waitFor();
  assert.equal(await a.getByLabel('What is it?').inputValue(), 'Threshold Fleece Throw Blanket');
  step('A store that refuses the lookup still gets its name filled in, from the link alone');
}

// ------------------------------------------------------------ the names of this wish list
{
  const s = await pageFor(john);
  await s.goto(BASE + '/lists?view=people', { waitUntil: 'networkidle' });
  assert.equal(await s.locator('.wl-bar__name').innerText(), 'Wish List', 'the default short name');
  await s.getByLabel('Full name').fill('Smith Family and Friends Wish List');
  await s.getByLabel('Short name').fill('Smith Wish List');
  await s.getByRole('button', { name: 'Save names' }).click();
  await toast(s, 'Saved. The new names show on every page and in emails.');
  assert.equal(await s.locator('.wl-bar__name').innerText(), 'Smith Wish List');
  assert.ok((await s.title()).endsWith('· Smith Wish List'));
  const out = await pageFor(null, { width: 390, height: 800 });
  await out.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await out.locator('#welcomeH', { hasText: 'Smith Family and Friends Wish List' }).waitFor();
  assert.equal(await out.locator('#email-hint').innerText(), 'The address John has for you. No password needed.');
  assert.equal(await out.locator('#mailAdmin').innerText(), 'Email John');
  assert.equal(await out.locator('#mailAdmin').getAttribute('href'), 'mailto:john@example.com');
  step('John names the wish list on People; the bar, the tab and the sign-in page use it, and the footer emails him');
}

await browser.close();
assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
console.log(`\nFAMILY: all ${n} steps passed, no page errors`);
