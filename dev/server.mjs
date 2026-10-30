// Local test server for the wish list. Not deployed.
//
//   npm run dev                        # http://localhost:4380/lists, data in .data/
//   node dev/server.mjs <port> <data folder>
//
// Serves site/ as static files and runs the /api/lists/* functions the way Vercel does
// (Web Request in, Response out). Everything is kept in plain files in the data folder,
// never in the real Blob store, and sign-in codes show on the page instead of by email.
// The first email to sign in (john@example.com unless LISTS_ADMIN_EMAIL says otherwise)
// becomes the admin.
//
// Styles, two ways:
//   lite  the app's own head and SDC lite (site/lists/sdc-lite.css): what anyone who clones
//         the repo gets, and what the public version runs on.
//   sdc   the full SDC stylesheet and shared head from a private-sites folder, the way the
//         author's family site serves it (FAMILY_SITES, default ../private-sites).
// Default: sdc when that folder exists, else lite. WL_STYLES=lite forces the public version.
import http from 'node:http';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const SITES = path.resolve(process.env.FAMILY_SITES || path.join(ROOT, '../private-sites'));
const CHROME = path.join(SITES, 'family/site');          // sdc.css, /_site/, icons
const HEAD = path.join(SITES, 'shared/head.html');        // the SDC page head
const PORT = Number(process.argv[2] || process.env.PORT || 4380);
const DATA = path.resolve(process.argv[3] || path.join(ROOT, '.data'));

Object.assign(process.env, {
  LISTS_LOCAL_DIR: DATA,
  LISTS_DEV_LINKS: '1',
  LISTS_SECRET: process.env.LISTS_SECRET || randomBytes(32).toString('hex'),
  LISTS_ADMIN_EMAIL: process.env.LISTS_ADMIN_EMAIL || 'john@example.com',
  LISTS_ADMIN_NAME: process.env.LISTS_ADMIN_NAME || 'John',
  LISTS_ORIGIN: `http://localhost:${PORT}`
});
delete process.env.VERCEL;

const MODE = process.env.WL_STYLES === 'lite' || !existsSync(CHROME) ? 'lite' : 'sdc';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

async function api(req, res, name) {
  if (!/^[a-z]+$/.test(name)) { res.writeHead(404).end(); return; }
  let mod;
  // One function serves every route, as on Vercel (site/api/lists/[route].js).
  try { mod = await import(pathToFileURL(path.join(SITE, 'api/lists', '[route].js')).href); }
  catch { res.writeHead(404).end('no such route'); return; }
  const handler = mod[req.method];
  if (!handler) { res.writeHead(405).end(); return; }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers: req.headers,
    body: req.method === 'GET' || req.method === 'HEAD' || !chunks.length ? undefined : Buffer.concat(chunks)
  });
  const response = await handler(request);
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}

// The page's <!--SDC:HEAD--> marker, filled the way the family site build fills it.
async function fillHead(html) {
  let head = '';
  try { head = (await fs.readFile(HEAD, 'utf8')).trim().replaceAll('__ORIGIN__', `http://localhost:${PORT}`); } catch {}
  return html.replace(/<!--SDC:HEAD-->[\s\S]*?<!--\/SDC:HEAD-->/, `<!--SDC:HEAD-->\n${head}\n<!--/SDC:HEAD-->`);
}

async function findFile(urlPath) {
  for (const base of MODE === 'sdc' ? [SITE, CHROME] : [SITE]) {
    let file = path.join(base, urlPath);
    if (!file.startsWith(base)) return null;
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
      await fs.access(file);
      return file;
    } catch {}
  }
  return null;
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const m = url.pathname.match(/^\/api\/lists\/([a-z]+)$/);
    if (m) return await api(req, res, m[1]);
    const p = decodeURIComponent(url.pathname === '/' ? '/lists' : url.pathname);
    if (/^\/(lib|api|node_modules)\//.test(p)) { res.writeHead(404).end(); return; }
    const file = await findFile(p);
    if (!file) { res.writeHead(404).end('Not found'); return; }
    let body = await fs.readFile(file);
    if (MODE === 'sdc' && file === path.join(SITE, 'lists/index.html')) body = Buffer.from(await fillHead(body.toString('utf8')));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end('Error');
  }
}).listen(PORT, () => console.log(`Wish list dev server: http://localhost:${PORT}/lists  (${MODE} styles, data in ${DATA})`));
