// GET   what the signed-in person may see (lib/lists/rules.js view())
// POST  one change { op, ... }, answered with the fresh view
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { personForRequest } from '../auth.js';
import { readState, updateState } from '../store.js';
import { validate, apply, view, tidy, OpError } from '../rules.js';

const SIGNED_OUT = { error: 'signed_out', message: 'You are signed out. Sign in again to see the lists.' };

export async function GET(request) {
  try {
    const { state } = await readState();
    const me = personForRequest(request, state);
    if (!me) return json(SIGNED_OUT, 401);
    return json(view(state, me));
  } catch (e) {
    console.error('read failed', e);
    return json({ error: 'server_error', message: 'Could not load the lists. Try again in a moment.' }, 500);
  }
}

export async function POST(request) {
  if (!isSameSiteJson(request)) return json(BAD, 400);
  const body = await readJson(request);
  try {
    const op = validate(body);
    const { state, extra } = await updateState(s => {
      const me = personForRequest(request, s);
      if (!me) throw new OpError('signed_out', SIGNED_OUT.message, 401);
      return apply(s, op, me);
    }, s => tidy(s));
    const me = personForRequest(request, state);
    if (!me) return json(SIGNED_OUT, 401);           // e.g. they signed themselves out everywhere
    return json({ ...view(state, me), id: extra ?? null });
  } catch (e) {
    if (e instanceof OpError) {
      if (e.status === 409) {
        // Send the latest lists along so the page can catch up.
        try {
          const { state } = await readState();
          const me = personForRequest(request, state);
          if (me) return json({ error: e.code, message: e.message, ...view(state, me) }, 409);
        } catch {}
      }
      return json({ error: e.code, message: e.message }, e.status);
    }
    console.error('save failed', e);
    return json({ error: 'server_error', message: 'Could not save. Try again in a moment.' }, 500);
  }
}
