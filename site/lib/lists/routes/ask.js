// GET ?item=<id>  who the signed-in person could ask to go in on a gift: grown-ups who can see it
// and shop that list (never the person it is for), with whether each is already going in, was
// asked today, or turned these emails off. Names only; nobody's email address leaves the server.
import { json } from '../http.js';
import { personForRequest } from '../auth.js';
import { readState } from '../store.js';
import { canChipIn, seesItem, relation, hidesPurchases } from '../rules.js';

const DAY = 864e5;

export async function GET(request) {
  const id = new URL(request.url).searchParams.get('item') || '';
  try {
    const { state } = await readState();
    const me = personForRequest(request, state);
    if (!me) return json({ error: 'signed_out', message: 'Sign in again first.' }, 401);
    const it = state.items.find(i => i.id === id);
    if (!it || !seesItem(state, me, it) || hidesPurchases(relation(state, me, it.ownerId))) {
      return json({ error: 'not_found', message: 'That gift is no longer on the list.' }, 404);
    }
    const now = Date.now();
    const people = state.people
      .filter(p => p.id !== me.id && canChipIn(state, p, it))
      .map(p => ({
        id: p.id, name: p.name,
        going: state.chips.some(c => c.itemId === it.id && c.personId === p.id),
        asked: (state.notes || []).some(n => n.to === p.id && n.itemId === it.id && n.kind === 'ask' && now - n.at < DAY),
        off: p.chipMail === false
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({ people });
  } catch (e) {
    console.error('ask list failed', e);
    return json({ error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
}
