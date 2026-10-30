// Click-through test: drives the real page like a person would.
import assert from 'node:assert/strict';
import http from 'node:http';
import { chromium } from 'playwright';
import { OUT, PHOTOS } from './paths.mjs';
const BASE = process.argv[2];
const PHOTO = `${PHOTOS}/snoopy.png`;
// A stand-in store on this computer, so the test never depends on a real one.
const store = http.createServer((req, res) => {
  if (req.url === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('User-agent: *\nAllow: /\n'); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><head><title>Team Home Jersey | Team Store</title>' +
    '<meta property="og:title" content="Team Home Jersey"><meta property="og:image" content="https://shop.example.com/jersey.jpg">' +
    '<meta property="product:price:amount" content="129.99"></head><body>Jersey</body></html>');
});
await new Promise(r => store.listen(0, '127.0.0.1', r));
const STORE = `http://127.0.0.1:${store.address().port}/p/team-home-jersey`;
const browser = await chromium.launch();
const errors = [];
let n = 0;
const step = msg => console.log(`  ok ${++n}. ${msg}`);

async function newPage(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  return { ctx, page };
}
async function signInUI(page, email) {
  await page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await page.getByLabel('Your email address').fill(email);
  await page.getByRole('button', { name: 'Send me a sign-in code' }).click();
  await page.waitForSelector('#codeForm:not([hidden])');
  const status = await page.locator('#signinStatus').innerText();
  const code = (status.match(/Dev code: (\d{6})/) || [])[1];
  assert.ok(code, 'dev code shown: ' + status);
  await page.getByLabel('Type the six digit code from the email').fill(code);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForSelector('#view:not([hidden])');
  // First sign-in opens setup; these flows skip it (wl-onboard.mjs tests setup itself).
  const skip = page.getByRole('button', { name: 'Skip setup for now' });
  if (await skip.count()) { await skip.click(); await page.getByRole('heading', { level: 1 }).filter({ hasNotText: 'Welcome' }).first().waitFor(); }
}
const heading = (page, name) => page.getByRole('heading', { level: 1, name });
async function openItem(page, title) {
  await page.getByRole('link', { name: title, exact: true }).click();
  await heading(page, title).waitFor();
}
async function openList(page, label) {
  const side = page.locator('.wl-side');
  if (await side.isVisible()) { await side.getByRole('link', { name: new RegExp('^' + label) }).click(); return; }
  const texts = await page.getByRole('combobox', { name: 'Whose list' }).locator('option').allInnerTexts();
  await page.getByRole('combobox', { name: 'Whose list' }).selectOption({ label: texts.find(t => t.startsWith(label)) });
  await page.getByRole('button', { name: 'Show list' }).click();
}

// Signed out: sign-in box top right on a computer.
const S = await newPage();
await S.page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
{
  const box = await S.page.locator('.wl-welcome__signin').boundingBox();
  const h1 = await S.page.locator('#welcomeH').boundingBox();
  assert.ok(box.x > h1.x + 200 && box.y < h1.y + h1.height, `sign-in box sits top right (${JSON.stringify(box)} vs ${JSON.stringify(h1)})`);
  assert.equal(await S.page.locator('.sdc-nav, .sdc-site-header').count(), 0, 'no portfolio navigation');
  step('Signed out: the sign-in box is top right, and no portfolio navigation');
}
await signInUI(S.page, 'john@example.com');
assert.equal(await S.page.locator('#whoName').innerText(), 'John');
{
  const who = await S.page.locator('#who').boundingBox();
  assert.ok(who.x > 600 && who.y < 80, 'signed-in name and Sign out sit top right ' + JSON.stringify(who));
  assert.ok(await S.page.locator('#who').getByRole('button', { name: 'Sign out' }).isVisible());
}
step('John signs in with the code; "Signed in as John" and the Sign out button sit top right');

await S.page.getByRole('link', { name: 'People' }).click();
await heading(S.page, 'People').waitFor();
await S.page.getByRole('button', { name: 'Add a person' }).click();
await S.page.getByRole('textbox', { name: 'Name', exact: true }).fill('Jane');
await S.page.getByLabel('Email', { exact: true }).fill('jane@example.com');
await S.page.getByRole('button', { name: 'Add person' }).click();
await S.page.getByText('jane@example.com').waitFor();
step('John adds Jane on the People page');

// A write-in with a photo.
await S.page.getByRole('link', { name: 'Lists' }).click();
await heading(S.page, 'My list').waitFor();
await S.page.getByRole('button', { name: 'Add an item' }).click();
await S.page.getByLabel('What is it?').fill("Aunt Suzy's cinnamon rolls");
await S.page.getByLabel('Price (optional)').fill('15');
await S.page.locator('#f-file').setInputFiles(PHOTO);
await S.page.locator('#toastText', { hasText: 'Photo added.' }).waitFor();
await S.page.getByRole('button', { name: 'Add to the list' }).click();
await S.page.locator('#toastText', { hasText: 'Added to your list.' }).waitFor();
const rollsCard = S.page.locator('.wl-card', { hasText: "Aunt Suzy's cinnamon rolls" });
assert.equal(await rollsCard.locator('.wl-card__store').count(), 0, 'no store line without a link');
assert.ok((await rollsCard.locator('img').getAttribute('src')).startsWith('/api/lists/photo?id='));
step('Write-in with an uploaded photo is added');
await S.page.getByRole('button', { name: 'Add an item' }).click();
await S.page.getByLabel('What is it?').fill('Hiking poles');
await S.page.getByLabel('Price (optional)').fill('$120');
await S.page.locator('details.wl-more').evaluate(d => { d.open = true; });
await S.page.getByLabel('How many').selectOption('2');
await S.page.getByRole('button', { name: 'Add to the list' }).click();
await S.page.locator('#toastText', { hasText: 'Added to your list.' }).waitFor();
assert.equal(await S.page.locator('.wl-card button').count(), 0, 'cards carry no buttons');
assert.equal(await S.page.locator('.wl-card a').count(), await S.page.locator('.wl-card').count(), 'one link per card');
step('Cards carry no buttons, one link each');

await openItem(S.page, 'Hiking poles');
await S.page.getByRole('button', { name: 'Edit' }).click();
await S.page.getByLabel('What is it?').fill('Trekking poles');
await S.page.getByRole('button', { name: 'Save changes' }).click();
await heading(S.page, 'Trekking poles').waitFor();
step('Tapping a card opens its page; Edit is a button there');
await S.page.goBack();
await heading(S.page, 'My list').waitFor();
step('The browser Back button returns to the list');

await S.page.getByLabel('Sort').selectOption({ label: '$100 and up' });
assert.equal(await S.page.locator('.wl-card').count(), 1);
await S.page.getByLabel('Sort').selectOption({ label: 'Newest first' });
assert.equal(await S.page.locator('.wl-card').count(), 2);
assert.equal(await S.page.locator('.sdc-choice').count(), 0, 'no chip rows on the list page');
step('Price lives in the Sort menu: $100 and up narrows the list, Newest first shows all');

// Jane shops John's list on a phone.
const A = await newPage(390);
await signInUI(A.page, 'jane@example.com');
assert.equal(await A.page.getByRole('link', { name: 'People' }).count(), 0, 'Jane has no People link');
await A.page.goto(BASE + '/lists?view=people', { waitUntil: 'networkidle' });
assert.equal(await heading(A.page, 'People').count(), 0, 'Jane cannot open People by address');
step('Only John sees People, even by typing the address');
await openList(A.page, 'John');
await heading(A.page, "John's list").waitFor();
await openItem(A.page, "Aunt Suzy's cinnamon rolls");
await A.page.getByRole('button', { name: 'I bought this' }).click();
await A.page.locator('#toastText', { hasText: 'John will not see this.' }).waitFor();
assert.ok((await A.page.locator('.wl-detail').innerText()).includes('You bought this'));
step('Jane opens the rolls on her phone and taps I bought this');
await A.page.goBack();
await openItem(A.page, 'Trekking poles');
await A.page.getByRole('button', { name: 'Go in together' }).click();
// A typo keeps what was typed and shows the problem under the field.
await A.page.getByLabel('How much will you put in? (dollars)').fill('twenty');
await A.page.getByRole('button', { name: 'Save my amount' }).click();
assert.equal(await A.page.getByLabel('How much will you put in? (dollars)').inputValue(), 'twenty', 'typed amount kept');
assert.equal(await A.page.getByLabel('How much will you put in? (dollars)').getAttribute('aria-invalid'), 'true');
assert.ok(await A.page.getByText('Type an amount in dollars, like 25.').isVisible());
await A.page.getByLabel('How much will you put in? (dollars)').fill('40');
await A.page.getByRole('button', { name: 'Save my amount' }).click();
await A.page.locator('.wl-chipin').waitFor();
step('Jane chips in $40 on the poles');
await A.page.getByRole('button', { name: 'I bought this' }).click();
await A.page.getByLabel(/How many did you buy/).selectOption('1');
assert.equal(await A.page.getByRole('button', { name: 'I bought this' }).count(), 0, 'one choice on screen while picking');
await A.page.getByRole('button', { name: 'Save, I bought them' }).click();
await A.page.locator('#toastText', { hasText: 'John will not see this.' }).waitFor();
{
  await A.page.waitForTimeout(300);
  const box = await A.page.locator('#toast').boundingBox();
  const vh = await A.page.evaluate(() => window.innerHeight);
  assert.ok(box.y >= 0 && box.y + box.height <= vh, `message is on screen on a phone: ${JSON.stringify(box)} in ${vh}`);
}
step('Jane buys 1 of 2 poles with the quantity picker');

// John's own view stays clean.
await S.page.reload({ waitUntil: 'networkidle' });
const sText = await S.page.locator('#view').innerText();
assert.ok(!/bought|chip|together/i.test(sText), 'owner view mentions no purchases: ' + sText);
assert.ok(sText.includes('Wants 2'), 'owner still sees Wants 2');
await openItem(S.page, 'Trekking poles');
assert.ok(!/bought|together/i.test(await S.page.locator('#view').innerText()), 'owner item page mentions no purchases');
step('John sees no sign of either purchase or the chip-in, on the list or the item page');
await S.page.goBack();

// My shopping, then Given.
await A.page.getByRole('link', { name: 'My shopping' }).click();
await A.page.getByRole('heading', { name: 'For John' }).waitFor();
await A.page.getByRole('link', { name: "Aunt Suzy's cinnamon rolls" }).click();
await A.page.getByRole('button', { name: 'It has been given' }).click();
await A.page.getByText('Has John opened it?').waitFor();
await A.page.getByRole('button', { name: 'Not yet' }).click();
assert.ok(await A.page.getByRole('button', { name: 'It has been given' }).isVisible(), 'Not yet keeps it');
await A.page.getByRole('button', { name: 'It has been given' }).click();
await A.page.getByRole('button', { name: 'Yes, it has been given' }).click();
await A.page.locator('#toastText', { hasText: 'Marked given.' }).waitFor();
await A.page.getByRole('link', { name: 'My shopping' }).click();
await A.page.getByRole('heading', { name: 'Given', exact: true }).waitFor();
step('My shopping links to each gift; It has been given asks first, then moves the rolls to Given');
await S.page.reload({ waitUntil: 'networkidle' });
assert.equal(await S.page.locator('.wl-card', { hasText: 'cinnamon rolls' }).count(), 0);
step('Once given, the rolls leave John\'s list');

await openItem(S.page, 'Trekking poles');
await S.page.getByRole('button', { name: 'Remove from my list' }).click();
await S.page.getByRole('button', { name: 'Yes, remove it' }).click();
await S.page.locator('#toastText', { hasText: 'Removed.' }).waitFor();
await heading(S.page, 'My list').waitFor();
step('John removes the poles after a Yes; he lands back on his list');
await A.page.getByRole('link', { name: 'Lists' }).click();
await openList(A.page, 'John');
await heading(A.page, "John's list").waitFor();
assert.ok((await A.page.locator('.wl-card', { hasText: 'Trekking poles' }).innerText()).includes('took this off the list'));
step('Jane, who bought one, is told John took the poles off');

// The computer Add button on a store page.
const P = await newPage();
await P.page.route('https://shop.example.com/**', r => r.fulfill({ contentType: 'text/html', body:
  `<html><head><title>Shop</title><meta property="og:title" content="Team Knit Beanie"><meta property="og:image" content="https://shop.example.com/beanie.jpg">
   <link rel="canonical" href="/p/beanie"><script type="application/ld+json">{"@type":"Product","name":"Beanie","offers":{"price":"24.99"}}</script></head><body>hi</body></html>` }));
await P.page.goto('https://shop.example.com/p/beanie?utm=x');
await S.page.locator('summary', { hasText: 'On a computer' }).click();
const bm = await S.page.locator('.wl-bookmarklet').getAttribute('href');
const opened = await P.page.evaluate(code => { let u = null; window.open = x => { u = x; return {}; }; (0, eval)(code); return u; }, decodeURIComponent(bm.slice(11)));
const q = new URL(opened).searchParams;
assert.equal(q.get('u'), 'https://shop.example.com/p/beanie');
assert.equal(q.get('t'), 'Team Knit Beanie');
assert.equal(q.get('i'), 'https://shop.example.com/beanie.jpg');
assert.equal(q.get('p'), '24.99');
step('Add button reads name, photo, price and clean link from a store page');
await A.page.goto(opened, { waitUntil: 'networkidle' });
assert.equal(await A.page.getByLabel('What is it?').inputValue(), 'Team Knit Beanie');
await A.page.getByLabel('Add to').selectOption({ label: 'Secret idea for John' });
await A.page.getByRole('button', { name: 'Add the secret idea' }).click();
await A.page.locator('#toastText', { hasText: 'Added as a secret idea for John.' }).waitFor();
await S.page.reload({ waitUntil: 'networkidle' });
assert.equal(await S.page.getByText('Team Knit Beanie').count(), 0);
step('Jane files it as a secret idea for John; John cannot see it');

// The Add button clicked on the wish list itself.
{
  const res = await S.page.evaluate(code => {
    let alerted = '', opened = null;
    window.alert = m => { alerted = m; };
    window.open = u => { opened = u; return {}; };
    (0, eval)(code);
    return { alerted, opened };
  }, decodeURIComponent(bm.slice(11)));
  assert.ok(/store's product page/.test(res.alerted) && res.opened === null, JSON.stringify(res));
  step('The Add button refuses to read the wish list page itself');
}

// Android share: Amazon app style text with a short link.
await A.page.goto(BASE + '/lists?st=&sx=' + encodeURIComponent('LEGO Technic Batmobile Tumbler https://a.co/d/abc123') + '&su=', { waitUntil: 'networkidle' });
assert.equal(await A.page.getByLabel('Store link (optional)').inputValue(), 'https://a.co/d/abc123');
assert.equal(await A.page.getByLabel('What is it?').inputValue(), 'LEGO Technic Batmobile Tumbler');
assert.ok(!(await A.page.url()).includes('sx='), 'share params cleared from address');
step('Android share fills the link and the name from shared text');

// Junk filled in is replaced by Fill in from link; typed text is kept.
{
  await S.page.goto(BASE + '/lists?add=1&u=' + encodeURIComponent(STORE) + '&t=' + encodeURIComponent('Family Wish List') +
    '&i=' + encodeURIComponent('https://wishlist.example.com/icon.png'), { waitUntil: 'networkidle' });
  await S.page.locator('details.wl-more').evaluate(d => { d.open = true; });
  await S.page.getByLabel('Notes (optional)').fill('Size L');
  await S.page.getByRole('button', { name: 'Get details from the link' }).click();
  await S.page.locator('#toastText', { hasText: 'Filled in what the store shares' }).waitFor({ timeout: 15000 });
  assert.equal(await S.page.getByLabel('What is it?').inputValue(), 'Team Home Jersey');
  assert.ok((await S.page.locator('.wl-photo__frame img').getAttribute('src')).includes('shop.example.com/jersey.jpg'));
  assert.equal(await S.page.getByLabel('Notes (optional)').inputValue(), 'Size L');
  await S.page.getByRole('button', { name: 'Add to the list' }).click();
  await S.page.locator('#toastText', { hasText: 'Added to your list.' }).waitFor();
  step('Fill in from link replaces junk with the store\'s name and photo, keeps typed notes');
}

// Equal cards, and the name standing in for a missing photo.
{
  await S.page.getByRole('button', { name: 'Add an item' }).click();
  await S.page.getByLabel('What is it?').fill('A knitted dog from Charlie');
  await S.page.locator('details.wl-more').evaluate(d => { d.open = true; });
  await S.page.getByLabel('Notes (optional)').fill('Any color. Charlie knows the one. A long note to make this card taller than the others in the row, line after line after line.');
  await S.page.getByRole('button', { name: 'Add to the list' }).click();
  await S.page.locator('#toastText', { hasText: 'Added to your list.' }).waitFor();
  const dog = S.page.locator('.wl-card', { hasText: 'A knitted dog' });
  assert.equal(await dog.locator('.wl-art__name').innerText(), 'A knitted dog from Charlie');
  const heights = await S.page.locator('.wl-grid > .wl-card').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
  assert.ok(heights.length >= 2 && heights.every(h => h === heights[0]), 'equal heights ' + heights);
  step(`Every card is the same height (${heights[0]}px x ${heights.length}); no photo shows the name`);
}

// Signed-out arrival waits through sign-in.
const N = await newPage(390);
await N.page.goto(BASE + '/lists?add=1&u=' + encodeURIComponent('https://www.rei.com/x') + '&t=Tent&p=199', { waitUntil: 'networkidle' });
await S.page.getByRole('link', { name: 'People' }).click();
await S.page.getByRole('button', { name: 'Add a person' }).click();
await S.page.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
await S.page.getByLabel('Email', { exact: true }).fill('sam@example.com');
await S.page.getByRole('button', { name: 'Add person' }).click();
await S.page.getByText('sam@example.com').waitFor();
await signInUI(N.page, 'sam@example.com');
assert.equal(await N.page.getByLabel('What is it?').inputValue(), 'Tent');
step('An item shared while signed out waits through sign-in');

// Back closes the add form instead of leaving the page.
{
  await N.page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  // Sam arrived with something to add, so setup waited; it shows now. Skip it here.
  await N.page.getByRole('heading', { level: 1, name: 'Welcome, Sam' }).waitFor();
  await N.page.getByRole('button', { name: 'Skip setup for now' }).click();
  await N.page.getByRole('button', { name: 'Add an item' }).click();
  await N.page.getByLabel('What is it?').fill('Something');
  await N.page.goBack();
  await N.page.getByRole('button', { name: 'Add an item' }).waitFor();
  assert.equal(await N.page.getByLabel('What is it?').count(), 0, 'form closed');
  assert.equal(await N.page.getByRole('heading', { level: 1 }).innerText(), 'My list', 'still on the list');
  step('Back closes the add form and stays on the list');
}
// A link pasted as the name moves to Store link; a long name never scrolls sideways.
{
  await N.page.getByRole('button', { name: 'Add an item' }).click();
  await N.page.getByLabel('What is it?').fill('https://www.example.com/a-very-long-product-path-with-no-spaces-at-all-0123456789');
  await N.page.getByRole('button', { name: 'Add to the list' }).click();
  await N.page.getByText('That was a link, so it moved to Store link.').waitFor();
  assert.ok((await N.page.getByLabel('Store link (optional)').inputValue()).startsWith('https://www.example.com/'));
  assert.equal(await N.page.getByLabel('What is it?').inputValue(), '');
  await N.page.getByLabel('What is it?').fill('Averyveryverylongnamewithnospacesatallthatgoesonandonandonforeverandever');
  await N.page.getByRole('button', { name: 'Add to the list' }).click();
  await N.page.locator('#toastText', { hasText: 'Added to your list.' }).waitFor();
  await N.page.getByRole('link', { name: /Averyvery/ }).click();
  await N.page.getByRole('heading', { level: 1, name: /Averyvery/ }).waitFor();
  const wide = await N.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  assert.equal(wide, false, 'item page does not scroll sideways at 390 with a long name');
  step('A pasted link moves to Store link; a very long name wraps on a phone');
}
// Sign-in: shows where the code went and lets you fix the address.
{
  const X = await newPage(390);
  await X.page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await X.page.getByLabel('Your email address').fill('angei@example.com');
  await X.page.getByRole('button', { name: 'Send me a sign-in code' }).click();
  await X.page.getByText('We sent a code to angei@example.com.').waitFor();
  await X.page.getByRole('button', { name: 'Use a different email' }).click();
  assert.equal(await X.page.evaluate(() => document.activeElement.id), 'email');
  await X.page.getByLabel('Your email address').fill('not-an-email');
  await X.page.getByRole('button', { name: 'Send me a sign-in code' }).click();
  assert.equal(await X.page.getByLabel('Your email address').getAttribute('aria-invalid'), 'true');
  assert.ok(await X.page.locator('#email-err').isVisible());
  step('Sign-in says where the code went, offers Use a different email, and puts errors under the field');
}

// iPhone steps: build steps until John shares the shortcut, then a one-tap button.
{
  await N.page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await N.page.locator('summary', { hasText: 'On an iPhone or iPad' }).click();
  const help = N.page.locator('.wl-help');
  assert.ok(/Run JavaScript on Web Page/.test(await help.innerText()) && /Allow Running Scripts/.test(await help.innerText()), 'build steps shown');
  assert.equal(await help.getByRole('link', { name: /Get the iPhone shortcut/ }).count(), 0);
  await S.page.getByRole('link', { name: 'People' }).click();
  await S.page.getByLabel('iCloud link for Add to Wish List').fill('https://example.com/not-a-shortcut');
  await S.page.getByRole('button', { name: 'Save link' }).click();
  await S.page.locator('#f-shortcut[aria-invalid="true"]').waitFor();
  assert.ok(await S.page.locator('#f-shortcut-err').isVisible(), 'bad link flagged under the field');
  const link = 'https://www.icloud.com/shortcuts/0123456789abcdef0123456789abcdef';
  await S.page.getByLabel('iCloud link for Add to Wish List').fill(link);
  await S.page.getByRole('button', { name: 'Save link' }).click();
  await S.page.locator('#toastText', { hasText: 'Every iPhone now gets' }).waitFor();
  await N.page.reload({ waitUntil: 'networkidle' });
  await N.page.locator('summary', { hasText: 'On an iPhone or iPad' }).click();
  const get = N.page.locator('.wl-help').getByRole('link', { name: /Get the iPhone shortcut/ });
  assert.equal(await get.getAttribute('href'), link);
  assert.ok(!/Run JavaScript on Web Page/.test(await N.page.locator('.wl-help').innerText()), 'build steps replaced by the button');
  step('iPhone steps: build guide until John saves the iCloud link on People, then a one-tap Get the iPhone shortcut button');
}

// Sign out from the top right.
await N.page.locator('#who').getByRole('button', { name: 'Sign out' }).click();
await N.page.getByLabel('Your email address').waitFor();
step('Sign out (top right) returns to the sign-in box');

await browser.close();
store.close();
assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
console.log(`\nFLOW: all ${n} steps passed, no page errors`);
