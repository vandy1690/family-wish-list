// Seeds a fresh dev server with sample family data, then screenshots each screen and runs
// axe (WCAG 2.2 AA) on it in light and dark.
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { OUT, PHOTOS } from './paths.mjs';
const AXE = await readFile(new URL('../node_modules/axe-core/axe.min.js', import.meta.url), 'utf8');

const BASE = process.argv[2] || 'http://localhost:4352';
const SHOTS = `${OUT}/screens`;
await mkdir(SHOTS, { recursive: true });

class User {
  constructor(email) { this.email = email; this.cookie = ''; }
  async call(path, body) {
    const init = { method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json' }, redirect: 'manual' };
    if (this.cookie) init.headers.Cookie = this.cookie;
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    const res = await fetch(BASE + path, init);
    for (const c of res.headers.getSetCookie()) if (c.startsWith('wl_session=')) this.cookie = c.split(';')[0];
    const d = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${path} ${res.status} ${JSON.stringify(d)} ${JSON.stringify(body)}`);
    return d;
  }
  async signIn(setupDone = true) {
    const r = await this.call('/api/lists/login', { email: this.email });
    await this.call('/api/lists/login', { email: this.email, code: r.dev.code });
    if (setupDone) await this.call('/api/lists/data', { op: 'saveSetup', setup: 'done' });
  }
  op(b) { return this.call('/api/lists/data', b); }
  async photo(name) {
    const b64 = (await readFile(`${PHOTOS}/${name}.png`)).toString('base64');
    return (await this.call('/api/lists/photo', { data: 'data:image/png;base64,' + b64 })).image;
  }
}

// ------------------------------------------------------------ seed
const john = new User('john@example.com');
await john.signIn();
const id = {};
for (const [name, email] of [['Jane', 'jane@example.com'], ['Sam', 'sam@example.com'], ['Ben', 'ben@example.com'],
  ['Grandma', 'grandma@example.com'], ['Aunt Suzy', 'suzy@example.com']]) {
  id[name] = (await john.op({ op: 'savePerson', name, email })).id;
}
id.Ella = (await john.op({ op: 'savePerson', name: 'Ella', email: '', managers: [id['Aunt Suzy']], parentsSee: false })).id;
id.John = (await john.call('/api/lists/data')).me.id;
const U = { Jane: new User('jane@example.com'), Sam: new User('sam@example.com'), Ben: new User('ben@example.com'),
  Grandma: new User('grandma@example.com'), Suzy: new User('suzy@example.com') };
for (const [k, u] of Object.entries(U)) await u.signIn(k !== 'Grandma');   // Grandma has not done setup yet

const add = async (u, ownerId, f) => (await u.op({ op: 'addItem', ownerId, qty: 1, ...f })).id;
await john.op({ op: 'saveAbout', personId: id.John, about: 'No nuts, please.\nShirt L, pants 34x32, shoe 11.\nBaseball, board games and puzzles. Camping gear always welcome.' });
await U.Sam.op({ op: 'saveAbout', personId: id.Sam, about: 'Shirt M, shoe 10.5. Loves hiking. Moving into a dorm, so nothing too big.' });

// John's list
await add(john, id.John, { url: 'https://www.amazon.com/dp/B0EXAMPLE1', title: 'VCK 18x24 Frame Set of 3, Black Wood, for Concert Posters', price: '69.99', image: await john.photo('frames'), note: 'Black, 18x24' });
await add(john, id.John, { url: 'https://www.amazon.com/dp/B0EXAMPLE2', title: "LEGO Ideas Peanuts: Snoopy's Doghouse 21368", price: '89.96', image: await john.photo('snoopy') });
const falcon = await add(john, id.John, { url: 'https://www.lego.com/en-us/product/millennium-falcon-75192', title: 'LEGO Millennium Falcon', price: '849.99', image: await john.photo('falcon'), note: 'Dream gift. Happy to go in together on this one.' });
await add(john, id.John, { url: 'https://www.lego.com/en-us/product/jabbas-sail-barge-75397', title: "Jabba's Sail Barge", price: '499.99', image: await john.photo('sailbarge') });
await add(john, id.John, { title: 'A knitted dog from Charlie', note: 'Any color. Charlie knows the one.' });
await U.Jane.op({ op: 'buy', itemId: falcon, qty: 1 });
await add(U.Ben, id.John, { title: 'Shadow box frame', price: '35' });

// Sam's list
const bat = await add(U.Sam, id.Sam, { url: 'https://www.amazon.com/dp/B0EXAMPLE3', title: 'LEGO Technic Batmobile Tumbler 42239', price: '189.95', image: await U.Sam.photo('batmobile') });
const bag = await add(U.Sam, id.Sam, { url: 'https://www.rei.com/product/168177/big-agnes-torchlight-20', title: 'Big Agnes Torchlight 20 Sleeping Bag, Men\'s', price: '279.95', image: await U.Sam.photo('sleepingbag'), note: 'Regular, left zip' });
const socks = await add(U.Sam, id.Sam, { url: 'https://www.rei.com/product/1/darn-tough-hiker', title: 'Darn Tough Hiker Micro Crew Socks', price: '27', qty: 3, note: 'Size L, any color' });
const cookies = await add(U.Sam, id.Sam, { title: "Aunt Jane's cookies", note: 'No nuts, please. The ones with the chocolate.' });
await U.Jane.op({ op: 'buy', itemId: bat, qty: 1 });
await U.Grandma.op({ op: 'buy', itemId: socks, qty: 2 });
await add(U.Jane, id.Sam, { title: 'Knit beanie', price: '25', url: 'https://shop.example.com/knit-beanie' });
await U.Ben.op({ op: 'chip', itemId: bag, amount: '50' });
await john.op({ op: 'chip', itemId: bag, amount: '100' });

// Ben
const shelby = await add(U.Ben, id.Ben, { url: 'https://www.lego.com/en-us/product/shelby-cobra-427-s-c-10357', title: 'Shelby Cobra 427 S/C', price: '159.99', image: await U.Ben.photo('shelby') });
await add(U.Ben, id.Ben, { url: 'https://www.lego.com/en-us/product/nasa-artemis-space-launch-system-10341', title: 'NASA Artemis Space Launch System', price: '259.99', image: await U.Ben.photo('artemis') });
await john.op({ op: 'buy', itemId: shelby, qty: 1 });

// Ella, kept by Aunt Suzy
const paint = await add(U.Suzy, id.Ella, { title: 'Watercolor paint set', price: '22' });
await john.op({ op: 'buy', itemId: paint, qty: 1 });

// Someone asking to join, and a name draw that has been drawn
await new User('').call('/api/lists/request', { name: 'Cousin Pat', email: 'pat@example.com', note: 'A cousin on the Garcia side' });
const draw = (await john.op({ op: 'saveDraw', name: 'Christmas 2026', budget: '$30', giveBy: '2026-12-24',
  participants: [id.John, id.Jane, id.Sam, id.Ben, id.Grandma, id['Aunt Suzy'], id.Ella], apart: [[id.John, id.Jane]] })).id;
await john.op({ op: 'drawNames', id: draw });
await john.op({ op: 'saveDraw', name: 'Garcia cousins', participants: [id.Sam, id.Ben, id.Ella, id['Aunt Suzy']] });

// Full made-up names and a name for the wish list, so the screenshots read like a family.
await john.op({ op: 'saveSettings', title: 'Smith Family and Friends Wish List', shortTitle: 'Smith Wish List' });
for (const [key, full] of [['John', 'John Smith'], ['Jane', 'Jane Smith'], ['Sam', 'Sam Smith'], ['Ben', 'Ben Smith']]) {
  await john.op({ op: 'savePerson', id: id[key], name: full, email: `${key.toLowerCase()}@example.com`, admin: key === 'John' });
}

// ------------------------------------------------------------ screenshots + axe
// DOCS=1 also saves the screens the README shows, at twice the size, into docs/screens/.
const DOCS = process.env.DOCS ? new URL('../docs/screens/', import.meta.url).pathname : null;
if (DOCS) await mkdir(DOCS, { recursive: true });
const browser = await chromium.launch();
const results = [];
async function shot(user, name, path, { width = 1280, height = 900, theme = 'light', act, full = true, doc } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: DOCS && doc ? 2 : 1 });
  if (user) {
    const [k, v] = user.cookie.split('=');
    await ctx.addCookies([{ name: k, value: v, url: BASE, httpOnly: true, secure: true, sameSite: 'Lax' }]);
  }
  await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); } catch (e) {} }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  if (act) { await act(page); await page.waitForTimeout(400); }
  await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${width}.png`, fullPage: full });
  if (DOCS && doc) await page.screenshot({ path: `${DOCS}${doc}.png` });
  await page.addScriptTag({ content: AXE });
  const axe = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes.slice(0, 3).map(x => x.target.join(' ') + ' :: ' + (x.failureSummary || '').split('\n')[1]) }));
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  results.push({ name: `${name}-${theme}-${width}`, axe, errors, overflow });
  await ctx.close();
}

const samList = `/lists?list=${id.Sam}`;
for (const theme of ['light', 'dark']) {
  await shot(null, '01-signin', '/lists', { theme, doc: theme === 'light' && 'sign-in' });
  await shot(U.Sam, '02-owner', '/lists', { theme });
  await shot(john, '03-shopper', samList, { theme, doc: theme === 'light' ? 'shopping-a-list' : 'dark-mode' });
  await shot(john, '04-shopping', '/lists?view=shopping', { theme });
  await shot(john, '05-people', '/lists?view=people', { theme, doc: theme === 'light' && 'people' });
  await shot(john, '12-item-shopper', `/lists?item=${bag}`, { theme });
}
await shot(null, '01-signin', '/lists', { width: 390 });
await shot(john, '03-shopper', samList, { width: 390 });
await shot(U.Sam, '02-owner', '/lists', { width: 390, height: 844, doc: 'my-list-phone' });
await shot(john, '06-add-arrival', '/lists?add=1&u=' + encodeURIComponent('https://www.lego.com/en-us/product/batmobile') +
  '&t=' + encodeURIComponent('LEGO Batman Batmobile') + '&p=' + encodeURIComponent('$59.99'), { width: 390 });
await shot(john, '07-chip-panel', `/lists?item=${bag}`, { width: 390, act: async p => {
  await p.getByRole('button', { name: 'Change my amount' }).click();
} });
await shot(john, '08-price-filter', samList, { act: async p => { await p.getByLabel('Sort').selectOption({ label: '$100 and up' }); } });
await shot(U.Suzy, '09-kid-hidden', `/lists?list=${id.Ella}`);
await shot(john, '10-person-form', '/lists?view=people', { act: async p => { await p.getByRole('button', { name: 'Add a person' }).click(); } });
await shot(U.Sam, '11-help-open', '/lists', { act: async p => { for (const s of await p.locator('summary').all()) await s.click(); } });
await shot(john, '12-item-shopper', `/lists?item=${bag}`, { width: 390, height: 844, doc: 'i-bought-this-phone' });
await shot(U.Sam, '13-item-owner', `/lists?item=${bat}`);
await shot(U.Sam, '13-item-owner', `/lists?item=${cookies}`, { width: 390 });
await shot(U.Grandma, '14-setup-welcome', '/lists', { width: 390, height: 844, doc: 'setup-phone' });
await shot(U.Grandma, '14-setup-sizes', '/lists', { width: 390, act: async p => { await p.getByRole('button', { name: 'Start' }).click(); await p.getByRole('heading', { name: 'What sizes do you wear?' }).waitFor(); } });
// Setup remembers where Grandma stopped, so tap Next until the wanted step shows.
async function toStep(p, title) {
  for (let i = 0; i < 10; i++) {
    if ((await p.locator('#pageH').innerText()) === title) return;
    await p.locator('#setupNext').click();
    await p.waitForTimeout(250);
  }
  throw new Error('setup never reached ' + title);
}
await shot(U.Grandma, '14-setup-kids', '/lists', { width: 390, act: async p => {
  await toStep(p, 'Lists for your kids');
} });
await shot(U.Grandma, '14-setup-device', '/lists', { act: async p => {
  await toStep(p, 'Add things straight from a store');
} });
// Lists for kids: Aunt Suzy keeps Ella's list.
await shot(U.Suzy, '16-kids-panel', '/lists', { width: 390 });
await shot(U.Suzy, '16-kids-panel', '/lists');
for (const theme of ['light', 'dark']) {
  await shot(U.Suzy, '17-kid-form', '/lists', { width: 390, theme, act: async p => { await p.getByRole('button', { name: 'Add a list for your child' }).click(); } });
}
await shot(U.Suzy, '18-kid-edit', `/lists?list=${id.Ella}`, { width: 390, act: async p => { await p.getByRole('button', { name: 'Edit details' }).click(); } });
await shot(null, '19-request-form', '/lists', { width: 390, act: async p => { await p.getByRole('button', { name: 'Not on the list yet? Ask to join' }).click(); } });
for (const width of [390, 1280]) {
  await shot(U.Sam, '20-share-form', '/lists', { width, height: width === 390 ? 844 : 900, doc: width === 390 && 'who-can-see-phone', act: async p => {
    await p.getByRole('button', { name: 'Change who can see it' }).click();
    await p.getByLabel('Only the people I pick').check();
    await p.getByLabel('Grandma', { exact: true }).check();
  } });
}
await shot(U.Sam, '21-draws', '/lists?view=draws', { width: 390, height: 844, doc: 'draw-names-phone' });
await shot(U.Suzy, '21-draws-parent', '/lists?view=draws');
await shot(U.Sam, '21-draws', '/lists?view=draws', { theme: 'dark' });
await shot(john, '22-draw-form', '/lists?view=draws', { width: 390, act: async p => { await p.getByRole('button', { name: 'Start a name draw' }).click(); } });
await shot(U.Suzy, '18-kid-remove', `/lists?list=${id.Ella}`, { width: 390, act: async p => { await p.getByRole('button', { name: 'Remove this list' }).click(); } });
await shot(U.Sam, '15-tour', '/lists', { full: false, doc: 'tour-desktop', act: async p => { await p.getByRole('button', { name: 'How it works' }).click(); await p.locator('.wl-tour[open]').waitFor(); } });
// On a computer each tip sits beside what it is about: a few more of them, and a short window
// where there is no room below, so the tip goes above or beside.
const tourTo = async (p, title) => {
  await p.getByRole('button', { name: 'How it works' }).click();
  for (let i = 0; i < 12 && (await p.locator('#tourH').innerText()) !== title; i++) await p.locator('#tourNext').click();
};
for (const [file, title] of [['15-tour-about', 'About me'], ['15-tour-side', 'Everyone else'], ['15-tour-buy', 'I bought this']]) {
  await shot(U.Sam, file, '/lists', { full: false, act: p => tourTo(p, title) });
}
await shot(U.Sam, '15-tour-short', '/lists', { height: 560, full: false, act: async p => {
  await tourTo(p, 'Change something');
  // Put the outlined card at the bottom of the window: no room below, so the tip goes above or beside it.
  await p.evaluate(() => { const r = document.querySelector('.wl-tour-target').getBoundingClientRect(); window.scrollBy(0, r.bottom - innerHeight + 16); });
  await p.waitForTimeout(150);
  const side = await p.locator('.wl-tour').getAttribute('data-side');
  if (!['above', 'right', 'left'].includes(side)) throw new Error('short window: tip should sit above or beside the card, got ' + side);
} });
await shot(U.Sam, '15-tour-dark', '/lists', { theme: 'dark', full: false, act: p => tourTo(p, 'About me') });
await shot(U.Sam, '15-tour', '/lists', { width: 390, act: async p => { await p.getByRole('button', { name: 'How it works' }).click(); await p.getByRole('button', { name: 'Next' }).click(); } });
await browser.close();

for (const r of results) {
  const bad = r.axe.filter(v => v.impact === 'serious' || v.impact === 'critical');
  console.log(`${r.name.padEnd(32)} axe:${r.axe.length ? r.axe.map(v => `${v.id}(${v.impact},${v.n})`).join(' ') : 'clean'}${r.errors.length ? '  ERRORS: ' + r.errors.join(' | ') : ''}${r.overflow ? '  H-OVERFLOW' : ''}`);
  for (const v of r.axe) for (const s of v.sample) console.log('      ', v.id, s);
}
console.log('ids', JSON.stringify(id));
const bad = results.filter(r => r.axe.length || r.overflow || r.errors.some(e => !/status of 401/.test(e)));
console.log(bad.length ? `SCREENS: ${bad.length} screen(s) with problems` : `SCREENS: ${results.length} screens, axe clean, no sideways scroll, no page errors`);
if (bad.length) process.exit(1);
