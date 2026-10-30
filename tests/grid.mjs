// Every form: fields side by side line up (label tops, input tops, input heights).
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { OUT, PHOTOS } from './paths.mjs';
const BASE = process.argv[2];
const GRID = `${OUT}/grid`;
await (await import('node:fs/promises')).mkdir(GRID, { recursive: true });
const mk = () => { let cookie = ''; return { get c() { return cookie; }, call: async (path, body) => { const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  for (const c of r.headers.getSetCookie()) if (c.startsWith('wl_session=')) cookie = c.split(';')[0]; return r.json(); } }; };
const st = mk(); const r = await st.call('/api/lists/login', { email: 'john@example.com' }); await st.call('/api/lists/login', { email: 'john@example.com', code: r.dev.code });
const me = (await st.call('/api/lists/data')).me.id;
const item = await st.call('/api/lists/data', { op: 'addItem', ownerId: me, title: 'Poles', price: '120' });
const b = await chromium.launch();
let checked = 0, problems = [];
async function check(page, name) {
  const res = await page.evaluate(() => [...document.querySelectorAll('.wl-fields')].filter(g => g.offsetParent).map(g => {
    const kids = [...g.children].filter(k => k.offsetParent).map(k => {
      const f = k.matches('.sdc-field') ? k : k.querySelector('.sdc-field');
      const lab = f && f.querySelector('.sdc-field__label'), inp = f && f.querySelector('input:not([type=file]), select, textarea');
      const kb = k.getBoundingClientRect(), lb = lab && lab.getBoundingClientRect(), ib = inp && inp.getBoundingClientRect();
      return { top: Math.round(kb.top), label: lb && Math.round(lb.top), input: ib && Math.round(ib.top), h: ib && Math.round(ib.height), multi: inp && inp.tagName === 'TEXTAREA', id: inp && inp.id };
    });
    const rows = {};
    for (const k of kids) (rows[k.top] ||= []).push(k);
    return Object.values(rows).filter(r => r.length > 1);
  }));
  for (const grid of res) for (const row of grid) {
    checked++;
    const single = row.filter(k => !k.multi);
    const bad = new Set(row.map(k => k.label)).size > 1 || new Set(row.map(k => k.input)).size > 1 || new Set(single.map(k => k.h)).size > 1;
    if (bad) problems.push(`${name}: ${JSON.stringify(row)}`);
  }
  await page.screenshot({ path: `${GRID}/${name}.png`, fullPage: false });
}
for (const w of [1280, 390]) {
  const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
  const [k, v] = st.c.split('='); await ctx.addCookies([{ name: k, value: v, url: BASE, httpOnly: true, secure: true, sameSite: 'Lax' }]);
  const p = await ctx.newPage();
  await st.call('/api/lists/data', { op: 'saveSetup', step: 1 });
  await p.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await check(p, `setup-sizes-${w}`);
  for (const step of [4, 6]) {
    await st.call('/api/lists/data', { op: 'saveSetup', step });
    await p.goto(BASE + '/lists', { waitUntil: 'networkidle' });
    await check(p, `setup-step${step + 1}-${w}`);
  }
  await st.call('/api/lists/data', { op: 'saveSetup', setup: 'done' });
  await p.goto(BASE + '/lists', { waitUntil: 'networkidle' });
  await p.waitForTimeout(300);
  if (await p.locator('.wl-tour[open]').count()) await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Add an item' }).click();
  await p.locator('details.wl-more').evaluate(d => { d.open = true; });
  await check(p, `add-form-${w}`);
  await p.goto(BASE + `/lists?item=${item.id}`, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Edit' }).click();
  await check(p, `edit-form-${w}`);
  await p.goto(BASE + '/lists?view=people', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: 'Add a person' }).click();
  await check(p, `person-form-${w}`);
  await ctx.close();
}
await b.close();
console.log(`rows checked: ${checked}`);
if (problems.length) { console.log('MISALIGNED:\n' + problems.join('\n')); process.exit(1); }
console.log('GRID: every side-by-side row lines up');
