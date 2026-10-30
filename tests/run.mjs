// Runs the test suites, each against its own fresh dev server and empty data folder.
//
//   npm test                 api, flow, onboard, grid
//   npm run test:screens     screenshots of every screen, plus axe (WCAG 2.2 AA) in light and dark
//   node tests/run.mjs flow  one suite
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { ROOT } from './paths.mjs';
import { makePhotos } from './photos.mjs';

const ALL = ['api', 'flow', 'onboard', 'family', 'grid'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ALL;

const freePort = () => new Promise(resolve => {
  const s = net.createServer().listen(0, () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

// The click-through suite reads a stand-in store on this computer instead of a real one.
const SUITE_ENV = { flow: { LISTS_LOOKUP_ALLOW_LOCAL: '1' } };

async function startServer(name) {
  const port = await freePort();
  const data = await mkdtemp(path.join(tmpdir(), 'wish-list-test-'));
  const child = spawn(process.execPath, [path.join(ROOT, 'dev/server.mjs'), String(port), data],
    { stdio: 'ignore', env: { ...process.env, ...(SUITE_ENV[name] || {}) } });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(base + '/api/lists/health')).ok) break; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  return { base, stop: async () => { child.kill(); await rm(data, { recursive: true, force: true }); } };
}

function runSuite(name, base) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tests', `${name}.mjs`), base], { stdio: 'inherit' });
    child.on('exit', code => resolve(code === 0));
  });
}

await makePhotos();
let failed = [];
for (const name of wanted) {
  console.log(`\n=== ${name}`);
  const server = await startServer(name);
  const ok = await runSuite(name, server.base);
  await server.stop();
  if (!ok) failed.push(name);
}
console.log(failed.length ? `\nFAILED: ${failed.join(', ')}` : `\nAll passed: ${wanted.join(', ')}`);
process.exit(failed.length ? 1 : 0);
