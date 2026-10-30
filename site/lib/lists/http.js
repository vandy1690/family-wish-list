// Small request and response helpers shared by the wish list API routes.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

export function redirect(location, headers = {}) {
  return new Response(null, { status: 303, headers: { Location: location, 'Cache-Control': 'no-store', ...headers } });
}

// Writes must be JSON from this same site. A browser cannot send a cross-site JSON
// POST without a CORS preflight, and this app never approves one.
export function isSameSiteJson(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (!type.startsWith('application/json')) return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  if (!host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

// Reads a JSON body, refusing anything larger than `max` bytes.
export async function readJson(request, max = 64 * 1024) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > max) return null;
  let text;
  try { text = await request.text(); } catch { return null; }
  if (text.length > max) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export const BAD = { error: 'bad_request', message: 'Something went wrong. Reload the page and try again.' };
