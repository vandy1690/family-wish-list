// Where the wish lists live: one private JSON file in the family's Vercel Blob store
// (the same store Family Shifts uses, under its own name), plus uploaded photos.
// Every change reads the latest file and writes it back only if nobody else changed it
// in between (ETag check). On a clash it reads again and retries.
//
// For local testing only: LISTS_LOCAL_DIR=<folder> keeps everything in plain files in
// that folder instead. It is ignored on Vercel, so it can never point production at disk.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const STATE = 'family-lists/state.json';
const PHOTOS = 'family-lists/photos/';

const localDir = () => (!process.env.VERCEL && process.env.LISTS_LOCAL_DIR) || null;
let blobModule = null;
const blob = async () => (blobModule ||= await import('@vercel/blob'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// get() hands back the ETag as a weak validator, W/"abc"; ifMatch wants the strong one.
// Left on, every save fails while reads work. Same fix as Family Shifts (2026-10-23).
const strongEtag = e => (typeof e === 'string' ? e.replace(/^W\//, '') : e);

export const emptyState = () => ({ rev: 0, people: [], items: [], buys: [], chips: [], requests: [], draws: [], settings: {} });

function normalize(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const list = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
  return {
    rev: Number.isInteger(s.rev) && s.rev >= 0 ? s.rev : 0,
    people: list(s.people), items: list(s.items), buys: list(s.buys), chips: list(s.chips),
    requests: list(s.requests), draws: list(s.draws).filter(d => Array.isArray(d.participants)),
    settings: s.settings && typeof s.settings === 'object' && !Array.isArray(s.settings) ? s.settings : {}
  };
}

export function storageConfigured() {
  return Boolean(localDir() || process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

// ---------------------------------------------------------------- state

export async function readState() {
  const dir = localDir();
  if (dir) {
    let text = null;
    try { text = await fs.readFile(path.join(dir, 'state.json'), 'utf8'); } catch { text = null; }
    if (text === null) return { state: emptyState(), etag: null };
    return { state: normalize(JSON.parse(text)), etag: createHash('sha1').update(text).digest('hex') };
  }
  const { get, BlobNotFoundError } = await blob();
  let result;
  try {
    result = await get(STATE, { access: 'private', useCache: false });
  } catch (e) {
    if (e instanceof BlobNotFoundError) return { state: emptyState(), etag: null };
    throw e;
  }
  if (!result || result.statusCode !== 200 || !result.stream) return { state: emptyState(), etag: null };
  const text = await new Response(result.stream).text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  return { state: normalize(parsed), etag: strongEtag(result.blob.etag) };
}

class Clash extends Error {}

async function writeState(state, etag) {
  const text = JSON.stringify(state);
  const dir = localDir();
  if (dir) {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, 'state.json');
    let current = null;
    try { current = await fs.readFile(file, 'utf8'); } catch { current = null; }
    const now = current === null ? null : createHash('sha1').update(current).digest('hex');
    if (now !== etag) throw new Clash();
    await fs.writeFile(file, text);
    return;
  }
  const { put, BlobPreconditionFailedError } = await blob();
  try {
    await put(STATE, text, {
      access: 'private', contentType: 'application/json', addRandomSuffix: false, cacheControlMaxAge: 60,
      ...(etag ? { allowOverwrite: true, ifMatch: etag } : { allowOverwrite: false })
    });
  } catch (e) {
    if (e instanceof BlobPreconditionFailedError || !etag) throw new Clash();
    throw e;
  }
}

// change(state) edits the state in place and may return a value. Errors it throws
// (like OpError) pass straight through without saving anything.
export async function updateState(change, tidy) {
  let last = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, etag } = await readState();
    const extra = change(state);
    if (tidy) tidy(state);
    state.rev += 1;
    state.updatedAt = Date.now();
    try {
      await writeState(state, etag);
      return { state, extra };
    } catch (e) {
      last = e;
      if (e instanceof Clash) { await sleep(80 + Math.random() * 220 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw last || new Error('Could not save after several tries');
}

// ---------------------------------------------------------------- photos

const PHOTO_RE = /^[a-f0-9]{16,40}$/;

export async function putPhoto(id, bytes, type) {
  if (!PHOTO_RE.test(id)) throw new Error('bad photo id');
  const dir = localDir();
  if (dir) {
    await fs.mkdir(path.join(dir, 'photos'), { recursive: true });
    await fs.writeFile(path.join(dir, 'photos', id), bytes);
    await fs.writeFile(path.join(dir, 'photos', id + '.type'), type);
    return;
  }
  const { put } = await blob();
  await put(PHOTOS + id, bytes, { access: 'private', contentType: type, addRandomSuffix: false, allowOverwrite: false });
}

// Returns { body, type } or null.
export async function getPhoto(id) {
  if (!PHOTO_RE.test(id)) return null;
  const dir = localDir();
  if (dir) {
    try {
      return {
        body: await fs.readFile(path.join(dir, 'photos', id)),
        type: await fs.readFile(path.join(dir, 'photos', id + '.type'), 'utf8')
      };
    } catch { return null; }
  }
  const { get, BlobNotFoundError } = await blob();
  try {
    const r = await get(PHOTOS + id, { access: 'private' });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return { body: r.stream, type: r.blob.contentType || 'image/jpeg' };
  } catch (e) {
    if (e instanceof BlobNotFoundError) return null;
    throw e;
  }
}
