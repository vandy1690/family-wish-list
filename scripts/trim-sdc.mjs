// Builds site/lists/sdc-lite.css: the parts of the SDC design system (Steven Design Co.)
// that the wish list uses, so the app runs on its own without the full site stylesheet.
//
//   node scripts/trim-sdc.mjs <path to the full sdc.css> [<folder holding its Inter .woff2 files>]
//
// Kept: every design token (light and dark), base element styles, the Inter @font-face
// rules (with the font files copied next to the output), and only the SDC components the
// app's markup uses (ALLOW below). Everything else in the full site stylesheet, such as the
// portfolio's header, case study and modal styles, is left out.
//
// Run it again whenever the SDC changes, then run `npm run check:styles`, which compares
// every element's computed style with the full stylesheet against the trimmed one.
import { readFile, writeFile, mkdir, copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'site/lists/sdc-lite.css');
const FONTS_OUT = path.join(ROOT, 'site/lists/fonts');

// SDC classes the app uses, as prefixes. A rule is kept only if every class in it is here.
const ALLOW = ['sdc-btn', 'sdc-subhead', 'sdc-field', 'sdc-fieldset', 'sdc-select', 'sdc-choice', 'sdc-u-sr-only',
  'sdc-form-status', 'sdc-form-summary', 'sdc-section', 'sdc-layout-container', 'sdc-focus-ring', 'sdc-eyebrow',
  'sdc-display', 'sdc-skip-link', 'sdc-error', 'sdc-success', 'sdc-warning'];
const allowed = cls => ALLOW.some(a => cls === a || cls.startsWith(a + '-') || cls.startsWith(a + '_'));

// ---------------------------------------------------------------- a small CSS reader

function stripComments(css) {
  let out = '', i = 0, q = null;
  while (i < css.length) {
    const c = css[i];
    if (q) { out += c; if (c === '\\') { out += css[i + 1] || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; continue; }
    out += c; i++;
  }
  return out;
}

// Splits text into top-level pieces: { head, body } for blocks, { text } for statements.
function parse(css) {
  const nodes = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    let j = i, q = null, paren = 0;
    while (j < css.length) {
      const c = css[j];
      if (q) { if (c === '\\') { j += 2; continue; } if (c === q) q = null; j++; continue; }
      if (c === '"' || c === "'") { q = c; j++; continue; }
      if (c === '(') paren++; else if (c === ')') paren--;
      else if (!paren && (c === '{' || c === ';')) break;
      j++;
    }
    const head = css.slice(i, j).trim();
    if (css[j] === ';' || j >= css.length) { if (head) nodes.push({ text: head }); i = j + 1; continue; }
    let depth = 1, k = j + 1; q = null;
    while (k < css.length && depth) {
      const c = css[k];
      if (q) { if (c === '\\') { k += 2; continue; } if (c === q) q = null; k++; continue; }
      if (c === '"' || c === "'") q = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      k++;
    }
    nodes.push({ head, body: css.slice(j + 1, k - 1) });
    i = k;
  }
  return nodes;
}

const splitSelectors = sel => {
  const out = []; let depth = 0, cur = '';
  for (const c of sel) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const classesIn = sel => [...sel.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map(m => m[1]);

// ---------------------------------------------------------------- trim

const usedAnimations = new Set();
const fontFiles = new Set();

function trim(nodes) {
  const out = [];
  for (const n of nodes) {
    if (n.text) { if (/^@charset/i.test(n.text)) out.push(n.text + ';'); continue; }   // drop @import
    const at = n.head.match(/^@([\w-]+)/);
    if (at) {
      const name = at[1].toLowerCase();
      if (name === 'font-face') {
        if (!/font-family\s*:\s*["']?Inter["']?\s*;/i.test(n.body + ';')) continue;
        const body = n.body.replace(/url\(\s*["']?\/_site\/fonts\/([^"')]+)["']?\s*\)/g, (_, f) => { fontFiles.add(f); return `url(fonts/${f})`; });
        out.push(`@font-face{${body.trim()}}`);
      } else if (name === 'keyframes' || name === '-webkit-keyframes') {
        out.push({ keyframes: n.head.replace(/^@[\w-]+\s+/, '').trim(), text: `${n.head}{${n.body.trim()}}` });
      } else if (['media', 'supports', 'layer', 'container'].includes(name)) {
        const inner = trim(parse(n.body));
        if (inner.length) out.push({ head: n.head, inner });
      } else if (name === 'property') {
        out.push(`${n.head}{${n.body.trim()}}`);
      }
      continue;
    }
    const keep = splitSelectors(n.head).filter(s => !/#[\w-]/.test(s.replace(/\[[^\]]*\]/g, '')) && classesIn(s).every(allowed));
    if (!keep.length) continue;
    for (const m of n.body.matchAll(/animation(?:-name)?\s*:\s*([^;]+)/g)) for (const w of m[1].split(/[\s,]+/)) usedAnimations.add(w);
    out.push(`${keep.join(',')}{${n.body.trim()}}`);
  }
  return out;
}

function print(items, seen) {
  const lines = [];
  for (const it of items) {
    let s;
    if (typeof it === 'string') s = it;
    else if (it.keyframes !== undefined) { if (!usedAnimations.has(it.keyframes)) continue; s = it.text; }
    else { const inner = print(it.inner, new Set()); if (!inner.length) continue; s = `${it.head}{\n${inner.join('\n')}\n}`; }
    if (seen.has(s)) continue;          // the full stylesheet repeats blocks from several pages
    seen.add(s);
    lines.push(s);
  }
  return lines;
}

// ---------------------------------------------------------------- run

const [src, fontsDir] = process.argv.slice(2);
if (!src) { console.error('Usage: node scripts/trim-sdc.mjs <full sdc.css> [<fonts folder>]'); process.exit(1); }
const full = await readFile(src, 'utf8');
const body = print(trim(parse(stripComments(full))), new Set());
const header = `/* SDC lite: the parts of the SDC design system (Steven Design Co., stevendesignco.com) used by
   this app. Generated by scripts/trim-sdc.mjs from the full sdc.css; do not edit by hand.
   Display type is Nickel Gothic from Adobe Fonts when a kit is loaded, otherwise Inter.
   Inter is by Rasmus Andersson, SIL Open Font License 1.1 (fonts/OFL.txt). */\n`;
await writeFile(OUT, header + body.join('\n') + '\n');

const from = fontsDir || path.join(path.dirname(src), '_site/fonts');
await mkdir(FONTS_OUT, { recursive: true });
const have = new Set(await readdir(from).catch(() => []));
let copied = 0;
for (const f of fontFiles) if (have.has(f)) { await copyFile(path.join(from, f), path.join(FONTS_OUT, f)); copied++; }
console.log(`sdc-lite.css: ${(Buffer.byteLength(header + body.join('\n')) / 1024).toFixed(1)} KB from ${(full.length / 1024).toFixed(1)} KB, ` +
  `${body.length} blocks, ${copied} of ${fontFiles.size} Inter files copied`);
