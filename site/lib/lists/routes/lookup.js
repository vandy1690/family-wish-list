// POST { url } -> { title, image, price } read from a product page, or a plain-language
// reason it could not be read. See lib/lists/meta.js for the rules it follows.
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { personForRequest } from '../auth.js';
import { readState } from '../store.js';
import { cleanUrl } from '../rules.js';
import { lookupProduct, guessFromUrl, Blocked } from '../meta.js';

const WHY = {
  robots: 'This store asks apps not to read its pages, so the details could not be filled in.',
  refused: 'This store turned the request away, so the details could not be filled in.',
  missing: 'That page could not be found. Check the link.',
  unreachable: 'That store did not answer. Check the link, or try again later.'
};
const TIP = ' Use the Add to Wish List button on the store\'s page instead, or type the details in.';
const GUESSED = ' The name was filled in from the link. Check it, and add a price or photo if you like.';

export async function POST(request) {
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request);
  const url = cleanUrl(body && body.url);
  if (!url) return json({ error: 'invalid', message: 'Paste the whole link, starting with https.' }, 400);
  try {
    const { state } = await readState();
    if (!personForRequest(request, state)) return json({ error: 'signed_out', message: 'Sign in again first.' }, 401);
  } catch (e) {
    console.error('lookup auth failed', e);
    return json({ error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
  // When the store says no, the name often still sits in the link itself (no request needed).
  const guess = guessFromUrl(url);
  const withGuess = message => (guess
    ? { message: message.replace(/, so the details could not be filled in\.$/, '.') + GUESSED, guess }
    : { message: message + TIP });
  try {
    const found = await lookupProduct(url);
    if (!found.title && !found.image) return json({ blocked: 'empty', ...withGuess('That page does not share a name or photo.') });
    return json({ ok: true, url, ...found });
  } catch (e) {
    const reason = e instanceof Blocked ? e.reason : 'unreachable';
    if (!(e instanceof Blocked)) console.error('lookup failed', url, e && e.message);
    if (reason === 'missing') return json({ blocked: reason, message: WHY.missing });
    return json({ blocked: reason, ...withGuess(WHY[reason] || WHY.unreachable) });
  }
}
