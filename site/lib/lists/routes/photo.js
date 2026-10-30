// GET ?id=<id>               an uploaded photo, for signed-in people only
// POST { data: "data:image/jpeg;base64,..." }  stores a photo, answers { image: "photo:<id>" }
// The page shrinks a photo to 900px before sending it, so uploads stay small.
import { randomBytes } from 'node:crypto';
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { personForRequest } from '../auth.js';
import { readState, putPhoto, getPhoto } from '../store.js';

const MAX = 1_400_000;   // bytes of base64 text

function kind(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

async function signedIn(request) {
  const { state } = await readState();
  return Boolean(personForRequest(request, state));
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('id') || '';
  try {
    if (!(await signedIn(request))) return new Response('Sign in to see this photo.', { status: 401 });
    const photo = await getPhoto(id);
    if (!photo) return new Response('Not found', { status: 404 });
    return new Response(photo.body, { headers: {
      'Content-Type': photo.type, 'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff'
    } });
  } catch (e) {
    console.error('photo read failed', e);
    return new Response('Could not load the photo.', { status: 500 });
  }
}

export async function POST(request) {
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request, MAX + 1000);
  const m = body && typeof body.data === 'string' && body.data.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return json({ error: 'invalid', message: 'That photo could not be read. Try a JPEG or PNG.' }, 400);
  const bytes = Buffer.from(m[1], 'base64');
  const type = kind(bytes);
  if (!type) return json({ error: 'invalid', message: 'That file is not a photo. Try a JPEG or PNG.' }, 400);
  try {
    if (!(await signedIn(request))) return json({ error: 'signed_out', message: 'Sign in again first.' }, 401);
    const id = randomBytes(12).toString('hex');
    await putPhoto(id, bytes, type);
    return json({ ok: true, image: `photo:${id}` });
  } catch (e) {
    console.error('photo save failed', e);
    return json({ error: 'server_error', message: 'The photo could not be saved. Try again in a moment.' }, 500);
  }
}
