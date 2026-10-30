// The author's own deployment, which you do not need: it copies the app into a larger private
// site that hosts it next to other family pages, then that site is built and deployed.
//   site/ here  ->  ../private-sites/family/site/   (FAMILY_SITES to change it)
// To deploy your own copy, see README, Deploy your own. This repo is the source; never edit
// the copies the script makes.
import { cp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../tests/paths.mjs';

const SITES = path.resolve(process.env.FAMILY_SITES || path.join(ROOT, '../private-sites'));
const TARGET = path.join(SITES, 'family/site');
if (!existsSync(TARGET)) { console.error(`Not found: ${TARGET}. Set FAMILY_SITES.`); process.exit(1); }

// Whole folders this app owns are replaced, so a deleted file does not linger in production.
for (const dir of ['lists', 'api/lists', 'lib/lists']) {
  await rm(path.join(TARGET, dir), { recursive: true, force: true });
  await cp(path.join(ROOT, 'site', dir), path.join(TARGET, dir), { recursive: true });
}
await cp(path.join(ROOT, 'site/lists-sw.js'), path.join(TARGET, 'lists-sw.js'));
const files = (await readdir(path.join(ROOT, 'site/lists'))).length;
console.log(`Synced into ${TARGET} (lists/ ${files} files, api/lists, lib/lists, lists-sw.js).`);
console.log('Next: python3 build.py family, then deploy from family/site. See README.');
