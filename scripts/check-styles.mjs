// Checks that SDC lite (the trimmed styles in site/lists/sdc-lite.css) styles the app the
// same as the full SDC stylesheet: the same screens in both, every element's computed style
// compared. Only the type face may differ (the full site loads Nickel Gothic from Adobe Fonts).
//
//   npm run check:styles        needs the full SDC next to this repo (FAMILY_SITES, default ../private-sites)
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITES = path.resolve(process.env.FAMILY_SITES || path.join(ROOT, '../private-sites'));
if (!existsSync(path.join(SITES, 'family/site/sdc.css'))) {
  console.log('No full SDC stylesheet found next to this repo, so there is nothing to compare. Skipped.');
  process.exit(0);
}

const PROPS = ['color', 'background-color', 'border-top-width', 'border-top-style', 'border-top-color', 'border-bottom-width',
  'border-left-width', 'border-right-width', 'border-top-left-radius', 'padding-top', 'padding-right', 'padding-bottom',
  'padding-left', 'margin-top', 'margin-bottom', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform',
  'text-decoration-line', 'display', 'row-gap', 'column-gap', 'box-shadow', 'outline-style', 'opacity', 'position',
  'min-height', 'list-style-type', 'cursor', 'text-align', 'white-space'];

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => r(port)); }); });
async function server(mode) {
  const port = await freePort();
  const data = await mkdtemp(path.join(tmpdir(), 'wl-styles-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'dev/server.mjs'), String(port), data],
    { stdio: 'ignore', env: { ...process.env, WL_STYLES: mode } });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/lists/health')).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  return { base, stop: async () => { child.kill(); await rm(data, { recursive: true, force: true }); } };
}

async function seed(base) {
  let cookie = '';
  const call = async (p, body) => {
    const res = await fetch(base + p, { method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie()) if (c.startsWith('wl_session=')) cookie = c.split(';')[0];
    return res.json();
  };
  const r = await call('/api/lists/login', { email: 'john@example.com' });
  await call('/api/lists/login', { email: 'john@example.com', code: r.dev.code });
  await call('/api/lists/data', { op: 'saveSetup', setup: 'done', tour: 'done' });
  const me = (await call('/api/lists/data')).me.id;
  const jane = (await call('/api/lists/data', { op: 'savePerson', name: 'Jane Smith', email: 'jane@example.com' })).id;
  const sam = (await call('/api/lists/data', { op: 'savePerson', name: 'Sam Smith', email: 'sam@example.com' })).id;
  await call('/api/lists/data', { op: 'saveKid', name: 'Ella', managers: [], parentsSee: true });
  await call('/api/lists/data', { op: 'addItem', ownerId: me, title: 'Camp chair', price: '45', note: 'Blue if they have it' });
  const idea = (await call('/api/lists/data', { op: 'addItem', ownerId: jane, title: 'Garden gloves', price: '18' })).id;
  await call('/api/lists/data', { op: 'buy', itemId: idea, qty: 1 });
  const d = (await call('/api/lists/data', { op: 'saveDraw', name: 'Christmas', participants: [me, jane, sam] })).id;
  await call('/api/lists/data', { op: 'drawNames', id: d });
  return { cookie, idea, jane };
}

const full = await server('sdc'), lite = await server('lite');
const browser = await chromium.launch();
let differences = 0, compared = 0;
try {
  const [a, b] = [await seed(full.base), await seed(lite.base)];
  const screens = [
    ['sign-in', () => '/lists', false],
    ['my list', () => '/lists', true],
    ['shopper list', s => `/lists?list=${s.jane}`, true],
    ['item page', s => `/lists?item=${s.idea}`, true],
    ['my shopping', () => '/lists?view=shopping', true],
    ['draw names', () => '/lists?view=draws', true],
    ['people', () => '/lists?view=people', true]
  ];
  for (const width of [1280, 390]) {
    for (const theme of ['light', 'dark']) {
      for (const [name, url, signedIn] of screens) {
        const styles = [];
        for (const [srv, s] of [[full, a], [lite, b]]) {
          const ctx = await browser.newContext({ viewport: { width, height: 900 } });
          await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); } catch (e) {} }, theme);
          if (signedIn) { const [k, v] = s.cookie.split('='); await ctx.addCookies([{ name: k, value: v, url: srv.base }]); }
          const page = await ctx.newPage();
          await page.goto(srv.base + url(s), { waitUntil: 'networkidle' });
          await page.waitForTimeout(300);
          styles.push(await page.evaluate(props => [...document.querySelectorAll('body *')]
            .filter(e => e.offsetParent || getComputedStyle(e).position === 'fixed')
            .map(e => {
              const cs = getComputedStyle(e);
              const key = e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).join('.') : '');
              return [key, props.map(p => cs.getPropertyValue(p))];
            }), PROPS));
          await ctx.close();
        }
        const [x, y] = styles;
        if (x.length !== y.length) { console.log(`  ${name} ${width} ${theme}: ${x.length} vs ${y.length} elements`); differences++; continue; }
        for (let i = 0; i < x.length; i++) {
          compared++;
          for (let j = 0; j < PROPS.length; j++) {
            if (x[i][1][j] !== y[i][1][j]) {
              differences++;
              if (differences <= 40) console.log(`  ${name} ${width} ${theme}: ${x[i][0]} ${PROPS[j]}: full "${x[i][1][j]}", lite "${y[i][1][j]}"`);
            }
          }
        }
      }
    }
  }
} finally {
  await browser.close();
  await full.stop(); await lite.stop();
}
console.log(differences ? `\nSTYLES: ${differences} difference(s) across ${compared} elements` : `\nSTYLES: SDC lite matches the full SDC on ${compared} elements (7 screens, 2 sizes, light and dark)`);
process.exit(differences ? 1 : 0);
