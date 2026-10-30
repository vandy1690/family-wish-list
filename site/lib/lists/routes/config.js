// GET -> the names the sign-in page shows before anyone signs in: the wish list's title,
// its short name, the admin's first name, the contact address (hex, so it is not plain text
// in the page), and an Adobe Fonts kit id if one is set. Nothing private.
import { json } from '../http.js';
import { readState } from '../store.js';
import { siteInfo, adobeKit } from '../site.js';

export async function GET() {
  let state = null;
  try { ({ state } = await readState()); } catch { state = null; }
  const site = siteInfo(state);
  return json({
    title: site.title, shortTitle: site.shortTitle, adminName: site.adminName,
    contactHex: Buffer.from(site.contact || '').toString('hex'), adobeKit: adobeKit()
  });
}
