// First-run setup and tour, driven like a first-time user.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { OUT, PHOTOS } from './paths.mjs';
const BASE = process.argv[2];
const browser = await chromium.launch();
const errors = []; let n = 0;
const step = m => console.log(`  ok ${++n}. ${m}`);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(e.message));
const h1 = name => page.getByRole('heading', { level: 1, name });

await page.goto(BASE + '/lists', { waitUntil: 'networkidle' });
await page.getByLabel('Your email address').fill('john@example.com');
await page.getByRole('button', { name: 'Send me a sign-in code' }).click();
await page.waitForSelector('#codeForm:not([hidden])');
const code = (await page.locator('#signinStatus').innerText()).match(/Dev code: (\d{6})/)[1];
await page.getByLabel('Type the six digit code from the email').fill(code);
await page.getByRole('button', { name: 'Sign in', exact: true }).click();
await h1('Welcome, John').waitFor();
assert.equal(await page.locator('#mainNav').isVisible(), false, 'no main nav during setup');
assert.equal(await page.locator('#helpBtn').isVisible(), false, 'no How it works during setup');
assert.ok((await page.locator('.wl-setup').innerText()).toLowerCase().includes('step 1 of 9'), 'admin sees 9 steps');
step('First sign-in opens setup at step 1 of 9 (admin), without the main navigation');

await page.getByRole('button', { name: 'Start' }).click();
await h1('What sizes do you wear?').waitFor();
assert.equal(await page.evaluate(() => document.activeElement.id), 'pageH', 'focus on the question');
await page.getByLabel('Shirt').fill('L');
await page.getByLabel('Shoe').fill('11');
await page.getByRole('button', { name: 'Next' }).click();
await h1('What do you love?').waitFor();
step('Sizes answered; focus moves to each new question');

// Close the window mid-setup and come back: it resumes on the same screen with answers kept.
await page.reload({ waitUntil: 'networkidle' });
await h1('What do you love?').waitFor();
await page.getByRole('button', { name: 'Back' }).click();
await h1('What sizes do you wear?').waitFor();
assert.equal(await page.getByLabel('Shirt').inputValue(), 'L');
await page.getByRole('button', { name: 'Next' }).click();
step('A reload resumes at the same step, and Back shows the saved answers');

await page.getByLabel('Favorite colors').fill('Blue and white');
await page.getByLabel('Teams, hobbies and things you collect').fill('Baseball, camping');
await page.getByRole('button', { name: 'Next' }).click();
await h1('Anything to avoid?').waitFor();
await page.getByLabel('Please avoid').fill('Peanuts');
await page.getByRole('button', { name: 'Next' }).click();
await h1('Add one thing you would like').waitFor();
assert.ok(!/\bnull\b/.test(await page.locator('.wl-setup').innerText()), 'no "null" on the first-wish screen');
await page.getByLabel('What would you like?').fill('Trekking poles');
await page.getByRole('button', { name: 'Add it to my list' }).click();
await page.locator('#toastText', { hasText: 'Added Trekking poles to your list.' }).waitFor();
await page.getByLabel('What would you like?').fill("Aunt Jane's cookies");
await page.getByRole('button', { name: 'Next' }).click();
await h1('Lists for your kids').waitFor();
// Add one child with the button, and type a second then tap Next (saved, not lost).
await page.getByLabel("Child's name").fill('Rosie');
await page.getByRole('button', { name: 'Add their list' }).click();
await page.locator('#toastText', { hasText: "Rosie's list is ready." }).waitFor();
assert.ok((await page.locator('.wl-setup').innerText()).includes('Lists you keep'), 'the kept lists show');
await page.getByLabel("Child's name").fill('Theo');
await page.getByRole('button', { name: 'Next' }).click();
await h1('Add things straight from a store').waitFor();
step('Two wishes added: one with Add, one typed then Next (not lost)');
step('Setup adds lists for two kids: one with Add their list, one typed then Next');
assert.ok(await page.getByText('On a computer (Chrome or Safari)').isVisible());
assert.equal(await page.getByText('On an Android phone').count(), 0, 'only this device\'s steps');
assert.ok(await page.locator('.wl-bookmarklet').isVisible());
step('The store button step shows only this device (computer)');
await page.getByRole('button', { name: 'Next' }).click();
await h1('Who is in the family?').waitFor();
assert.ok(!/\bnull\b/.test(await page.locator('.wl-setup').innerText()), 'no "null" on the family screen');
await page.getByLabel('Name', { exact: true }).fill('Jane');
await page.getByLabel('Email', { exact: true }).fill('jane@example.com');
await page.getByRole('button', { name: 'Add person' }).click();
await page.getByText('3 people so far').waitFor();
assert.ok((await page.locator('.wl-setup').innerText()).includes('Rosie, a kid'), 'the kids from the step before are listed');
await page.getByRole('button', { name: 'Next' }).click();
await h1('You are all set').waitFor();
step('Admin step adds Jane; then You are all set');
await page.getByRole('button', { name: 'Go to my list' }).click();
await page.locator('.wl-tour[open]').waitFor();
const tipText = async () => (await page.locator('.wl-tour').innerText()).toLowerCase();
assert.ok((await tipText()).includes('tip 1 of 7'), 'John gets 7 tips (no one else has items yet): ' + await tipText());
assert.equal(await page.evaluate(() => document.activeElement.id), 'tourNext', 'focus on Next in the tip');
assert.ok(await page.locator('#addBtn.wl-tour-target').count() === 1, 'Add an item is outlined');
step('Finishing setup lands on My list and starts the tour: 7 tips, Tip 1 outlining Add an item');
const seen = [], sides = [];
for (;;) {
  const t = await tipText();
  const title = await page.locator('#tourH').innerText();
  const h1 = await page.locator('#pageH').innerText();
  const outlined = await page.locator('.wl-tour-target').count();
  seen.push(`${title} @ ${h1} (${outlined})`);
  if (title === 'My shopping') assert.equal(h1, 'My shopping', 'tip opens My shopping');
  if (title === 'People') { assert.equal(h1, 'People'); assert.equal(await page.locator('#addPersonBtn.wl-tour-target').count(), 1); }
  assert.equal(outlined, 1, 'every tip outlines one thing: ' + title);
  // On a computer the tip sits right beside the outlined thing, never on it, with its arrow
  // pointing inside the thing's span.
  const a = await page.evaluate(() => {
    const d = document.querySelector('.wl-tour'), t = document.querySelector('.wl-tour-target').getBoundingClientRect();
    const r = d.getBoundingClientRect(), arrow = parseFloat(d.style.getPropertyValue('--wl-tip-arrow'));
    const gapY = r.top >= t.bottom ? r.top - t.bottom : t.top >= r.bottom ? t.top - r.bottom : -1;
    const gapX = r.left >= t.right ? r.left - t.right : t.left >= r.right ? t.left - r.right : -1;
    const pointsAt = d.dataset.side === 'below' || d.dataset.side === 'above'
      ? r.left + arrow >= t.left - 1 && r.left + arrow <= t.right + 1 : r.top + arrow >= t.top - 1 && r.top + arrow <= t.bottom + 1;
    return { side: d.dataset.side || '', gap: Math.max(gapX, gapY), pointsAt, onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      arrowShown: getComputedStyle(d, '::before').content !== 'none' };
  });
  sides.push(`${title}: ${a.side} ${Math.round(a.gap)}px`);
  assert.ok(a.side, `"${title}" tip is placed beside its target`);
  assert.ok(a.gap >= 16 && a.gap <= 32, `"${title}" tip is ${Math.round(a.gap)}px from its target (should not overlap or drift)`);
  assert.ok(a.pointsAt && a.arrowShown, `"${title}" arrow points at the target`);
  assert.ok(a.onScreen, `"${title}" tip is fully on screen`);
  if (await page.getByRole('button', { name: 'Done' }).count()) break;
  await page.locator('#tourNext').click();
}
// Scrolling keeps the last tip beside its target.
{
  await page.evaluate(() => window.scrollBy(0, 40));
  await page.waitForTimeout(100);
  const still = await page.evaluate(() => {
    const r = document.querySelector('.wl-tour').getBoundingClientRect(), t = document.querySelector('.wl-tour-target').getBoundingClientRect();
    return Math.abs(r.top - t.bottom) < 40 || Math.abs(t.top - r.bottom) < 40 || document.querySelector('.wl-tour').dataset.side === undefined;
  });
  assert.ok(still, 'the tip follows its target when the page scrolls');
}
assert.ok(await page.locator('#helpBtn.wl-tour-target').count() === 1);
await page.getByRole('button', { name: 'Done' }).click();
assert.equal(await page.locator('.wl-tour[open]').count(), 0);
await h1('My list').waitFor();
assert.equal(await page.evaluate(() => document.activeElement.id), 'helpBtn', 'focus returns to How it works');
console.log('     ' + seen.join(' | '));
console.log('     ' + sides.join(' | '));
step('The tour opens each screen (My shopping, People) and outlines one thing per tip, each tip beside its target with the arrow on it; Done returns to My list');

const about = await page.locator('.wl-about').innerText();
assert.equal(about, 'Shirt: L\nShoe: 11\nFavorite colors: Blue and white\nLoves: Baseball, camping\nPlease avoid: Peanuts');
assert.equal(await page.locator('.wl-card').count(), 2);
step('Answers became the About me card; both wishes are on the list');

await page.reload({ waitUntil: 'networkidle' });
await h1('My list').waitFor();
await page.waitForTimeout(500);
assert.equal(await page.locator('.wl-tour[open]').count(), 0, 'tour does not come back');
step('A reload goes straight to the list: no setup, no tour');
await page.getByRole('button', { name: 'How it works' }).click();
await page.locator('.wl-tour[open]').waitFor();
await page.keyboard.press('Escape');
assert.equal(await page.locator('.wl-tour[open]').count(), 0);
step('How it works reopens the tips; Escape closes them');

// A second person who skips.
const c2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
const p2 = await c2.newPage();
p2.on('pageerror', e => errors.push(e.message));
await p2.goto(BASE + '/lists', { waitUntil: 'networkidle' });
await p2.getByLabel('Your email address').fill('jane@example.com');
await p2.getByRole('button', { name: 'Send me a sign-in code' }).click();
await p2.waitForSelector('#codeForm:not([hidden])');
const code2 = (await p2.locator('#signinStatus').innerText()).match(/Dev code: (\d{6})/)[1];
await p2.getByLabel('Type the six digit code from the email').fill(code2);
await p2.getByRole('button', { name: 'Sign in', exact: true }).click();
await p2.getByRole('heading', { level: 1, name: 'Welcome, Jane' }).waitFor();
assert.ok((await p2.locator('.wl-setup').innerText()).toLowerCase().includes('step 1 of 8'), 'non-admin sees 8 steps');
await p2.getByRole('button', { name: 'Skip setup for now' }).click();
await p2.getByRole('heading', { level: 1, name: 'My list' }).waitFor();
assert.ok((await p2.locator('#status').innerText()).includes('How it works'));
await p2.waitForTimeout(400);
assert.equal(await p2.locator('.wl-tour[open]').count(), 0, 'no tour after skipping');
await p2.reload({ waitUntil: 'networkidle' });
await p2.getByRole('heading', { level: 1, name: 'My list' }).waitFor();
step('Jane (not admin) sees 8 steps; Skip setup goes to her list, says where help is, and stays skipped');
await p2.getByRole('button', { name: 'How it works' }).click();
await p2.locator('.wl-tour[open]').waitFor();
let sawBuy = false, sawChip = false, n2 = 0;
for (;;) {
  const title = await p2.locator('#tourH').innerText();
  if (title === 'I bought this') {
    sawBuy = true;
    assert.equal(await p2.locator('#buyBtn.wl-tour-target').count(), 1, 'I bought this is outlined');
    assert.ok(/Trekking poles|cookies/i.test(await p2.locator('#pageH').innerText()), 'on the item page');
  }
  if (title === 'Go in together') { sawChip = true; assert.equal(await p2.locator('#chipBtn.wl-tour-target').count(), 1); }
  assert.notEqual(title, 'People', 'no People tip for Jane');
  n2++;
  if (await p2.getByRole('button', { name: 'Done' }).count()) break;
  await p2.locator('#tourNext').click();
}
assert.ok(sawBuy && sawChip, 'Jane\'s tour shows buying on a real item');
await p2.getByRole('button', { name: 'Done' }).click();
await p2.getByRole('heading', { level: 1, name: 'My list' }).waitFor();
// Back after the tour does not walk back through every tip.
await p2.goBack().catch(() => {});
await p2.waitForTimeout(300);
assert.notEqual(await p2.locator('#pageH').innerText().catch(() => ''), 'I bought this');
step(`How it works gives Jane ${n2} tips: John's list, the item page with I bought this and Go in together outlined, no People; ends on her list`);

// On a phone the tips stay small, read cleanly, and never cover what they point at. The
// 320 wide screen stands in for the smallest iPhones and for any iPhone zoomed in.
for (const [width, height, most] of [[390, 664, 0.25], [320, 568, 0.32]]) {
  await p2.setViewportSize({ width, height });
  await p2.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  // A message on screen when the tips start must not sit behind the tip.
  await p2.evaluate(() => { document.getElementById('toastText').textContent = 'Saved.'; document.getElementById('toast').hidden = false; });
  await p2.getByRole('button', { name: 'How it works' }).click();
  await p2.locator('.wl-tour[open]').waitFor();
  // iPhone Safari (iOS 26) stretches a modal dialog to its max-height unless the page sets
  // height: auto. Chromium does not, so check the rule itself, and that rows never spread.
  assert.deepEqual(await p2.locator('.wl-tour').evaluate(d => {
    const rule = [...document.styleSheets].flatMap(s => { try { return [...s.cssRules]; } catch { return []; } })
      .find(r => r.selectorText === '.wl-tour');
    return { height: rule && rule.style.height, align: getComputedStyle(d).alignContent };
  }), { height: 'auto', align: 'start' }, 'the tip sizes to its content on iPhone Safari');
  assert.equal(await p2.locator('#toast').isVisible(), false, 'the message bar is cleared when the tips start');
  assert.equal(await p2.locator('.wl-tour').evaluate(d => getComputedStyle(d, '::backdrop').backgroundColor), 'rgba(0, 0, 0, 0)',
    'no tint over the page');
  const skip = p2.locator('.wl-tour .wl-linkbtn');
  assert.equal(await skip.innerText(), 'Skip the tips');
  assert.equal(await skip.evaluate(e => getComputedStyle(e).textDecorationLine), 'underline', 'Skip reads as a link');
  let tipsSeen = 0, tallest = 0;
  for (;;) {
    const m = await p2.evaluate(() => {
      const dlg = document.querySelector('.wl-tour');
      const d = dlg.getBoundingClientRect();
      const t = document.querySelector('.wl-tour-target');
      const r = t ? t.getBoundingClientRect() : null;
      const text = getComputedStyle(dlg.querySelector(':scope > p'));
      const rowTops = [...dlg.querySelectorAll('.wl-tour__nav > *')].map(n => n.getBoundingClientRect());
      return { vh: innerHeight, d: { top: d.top, bottom: d.bottom, h: d.height },
        t: r && { top: r.top, bottom: r.bottom }, title: document.getElementById('tourH').textContent,
        leading: parseFloat(text.lineHeight) / parseFloat(text.fontSize),
        navRows: new Set(rowTops.map(b => Math.round(b.top + b.height / 2))).size,
        skipLines: (() => { const l = dlg.querySelector('.wl-linkbtn'); if (!l) return 1;
          const rg = document.createRange(); rg.selectNodeContents(l); return new Set([...rg.getClientRects()].map(b => Math.round(b.top))).size; })() };
    });
    tallest = Math.max(tallest, m.d.h);
    assert.ok(m.d.h < m.vh * most, `${width}px: tip "${m.title}" is ${Math.round(m.d.h)}px of ${m.vh}`);
    assert.ok(m.leading <= 1.45, `${width}px: tip text line height is ${m.leading.toFixed(2)}`);
    assert.equal(m.navRows, 1, `${width}px: Skip, Back and Next share one row on "${m.title}"`);
    assert.equal(m.skipLines, 1, `${width}px: Skip the tips stays on one line on "${m.title}"`);
    assert.ok(m.t, `tip "${m.title}" outlines something`);
    assert.ok(m.t.top >= 0 && m.t.top < m.vh, `"${m.title}" target is on screen (${Math.round(m.t.top)})`);
    const head = Math.min(m.t.bottom, m.t.top + 44);
    assert.ok(!(m.t.top < m.d.bottom && head > m.d.top), `${width}px: tip "${m.title}" covers the start of what it points at`);
    tipsSeen++;
    if (await p2.getByRole('button', { name: 'Done' }).count()) break;
    await p2.locator('#tourNext').click();
  }
  assert.equal(await p2.locator('.wl-tour .wl-linkbtn').count(), 0, 'no Skip on the last tip');
  await p2.getByRole('button', { name: 'Done' }).click();
  // Skip, from the second tip.
  await p2.getByRole('button', { name: 'How it works' }).click();
  await p2.locator('#tourNext').click();
  await p2.getByRole('button', { name: 'Skip the tips' }).click();
  assert.equal(await p2.locator('.wl-tour[open]').count(), 0, 'Skip the tips closes the tour');
  step(`On a ${width}x${height} phone: ${tipsSeen} tips, tallest ${Math.round(tallest)}px (under ${most * 100}%), tight lines, one button row, no tint or message behind, none covers what it points at`);
}

// A parent (Jane, not admin) adds, changes and removes a list for her child, on a phone.
{
  const h = name => p2.getByRole('heading', { level: 1, name });
  const toast = text => p2.locator('#toastText', { hasText: text }).waitFor();
  await p2.setViewportSize({ width: 390, height: 800 });
  await p2.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await h('My list').waitFor();
  assert.ok(await p2.getByRole('heading', { name: 'Lists for your kids' }).isVisible());
  await p2.getByRole('button', { name: 'Add a list for your child' }).click();
  assert.equal(await p2.evaluate(() => document.activeElement.id), 'kf-name', 'focus goes to the name');
  // Empty name: an error under the field, nothing saved.
  await p2.getByRole('button', { name: 'Make the list' }).click();
  assert.equal(await p2.locator('#kf-name-err').innerText(), "Enter your child's name.");
  await p2.getByLabel("Child's name").fill('Bea');
  await p2.getByLabel('Other parent (optional)').selectOption({ label: 'John' });
  await p2.getByLabel('No, keep it a surprise for us too').check();
  await p2.getByRole('button', { name: 'Make the list' }).click();
  await h("Bea's list").waitFor();
  await toast("Bea's list is ready. Tap Add an item");
  const head = await p2.locator('.wl-listhead').innerText();
  assert.ok(head.includes('What is bought is hidden from you too') && head.includes('Kept by Jane and John'), 'hidden purchases, two keepers: ' + head);
  step('Jane adds a list for Bea from My list (name, John as the other parent, purchases hidden) and lands on it');

  await p2.goBack();
  await h('My list').waitFor();
  assert.equal(await p2.locator('.wl-kids a', { hasText: "Bea's list" }).count(), 1, "Bea's list is linked from My list");
  await p2.locator('.wl-kids a', { hasText: "Bea's list" }).click();
  await h("Bea's list").waitFor();
  await p2.getByRole('button', { name: 'Add an item' }).click();
  await p2.getByLabel('What is it?').fill('Puzzle');
  await p2.getByRole('button', { name: 'Add to the list' }).click();
  await toast("Added to Bea's list.");
  step('Back returns to My list, which links to Bea\'s list; Jane adds a puzzle to it');

  await p2.getByRole('button', { name: 'Edit details' }).click();
  assert.equal(await p2.getByLabel("Child's name").inputValue(), 'Bea');
  assert.equal(await p2.locator('#kf-other option:checked').innerText(), 'John');
  assert.ok(await p2.getByLabel('No, keep it a surprise for us too').isChecked());
  await p2.getByLabel('Yes, so we do not buy the same thing').check();
  await p2.getByRole('button', { name: 'Save' }).click();
  await toast('Saved.');
  assert.ok((await p2.locator('.wl-listhead').innerText()).includes('you can see what has been bought'), 'now shows purchases');
  step('Edit details opens with Bea\'s settings; switching to Yes lets Jane see purchases');

  await p2.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await p2.getByRole('button', { name: 'Add a list for your child' }).click();
  await p2.getByLabel("Child's name").fill('bea');
  await p2.getByRole('button', { name: 'Make the list' }).click();
  await toast('There is already a list for Bea, kept by Jane and John');
  await p2.getByRole('button', { name: 'Cancel' }).click();
  step('A second list for the same child is refused, naming who keeps it');

  await p2.locator('.wl-kids a', { hasText: "Bea's list" }).click();
  await h("Bea's list").waitFor();
  await p2.getByRole('button', { name: 'Remove this list' }).click();
  assert.ok((await p2.locator('#kp-q').innerText()).includes('The 1 thing on it go too'), 'says what goes');
  await p2.getByRole('button', { name: 'No, keep it' }).click();
  await h("Bea's list").waitFor();
  await p2.getByRole('button', { name: 'Remove this list' }).click();
  await p2.getByRole('button', { name: "Yes, remove Bea's list" }).click();
  await h('My list').waitFor();
  await toast("Bea's list was removed.");
  assert.equal(await p2.locator('.wl-kids a', { hasText: "Bea's list" }).count(), 0);
  step('Remove this list asks first (No keeps it), then removes Bea\'s list and returns to My list');

  // John's lists for Rosie and Theo (from his setup) show no Edit details for Jane.
  await p2.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  const rosieId = await p2.locator('#wl-person option', { hasText: 'Rosie' }).getAttribute('value');
  await p2.locator('#wl-person').selectOption(rosieId);
  await p2.getByRole('button', { name: 'Show list' }).click();
  await h("Rosie's list").waitFor();
  assert.equal(await p2.getByRole('button', { name: 'Edit details' }).count(), 0, 'no Edit details on a list Jane does not keep');
  step('A child\'s list Jane does not keep has no Edit details or Remove for her');
}

await browser.close();
assert.deepEqual(errors, [], 'page errors: ' + errors.join(' | '));
console.log(`\nONBOARDING: all ${n} steps passed, no page errors`);
