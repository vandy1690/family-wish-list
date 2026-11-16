// GET   what the signed-in person may see (lib/lists/rules.js view())
// POST  one change { op, ... }, answered with the fresh view
import { json, isSameSiteJson, readJson, BAD } from '../http.js';
import { personForRequest } from '../auth.js';
import { readState, updateState } from '../store.js';
import { validate, apply, view, tidy, OpError } from '../rules.js';
import { sendGiftNotes } from '../mail.js';
import { siteInfo } from '../site.js';
import { checkLink } from '../linkcheck.js';

const SIGNED_OUT = { error: 'signed_out', message: 'You are signed out. Sign in again to see the lists.' };
const money = c => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

// Each email about going in together, written from the saved state: who, which gift, for whom,
// and how much is pledged now. The person a gift is for is never among the recipients (rules.js).
function composeNotes(state, outbox, request) {
  const site = siteInfo(state);
  const origin = process.env.LISTS_ORIGIN || new URL(request.url).origin;
  const person = id => state.people.find(p => p.id === id);
  return outbox.map(n => {
    const to = person(n.to), from = person(n.from), it = state.items.find(i => i.id === n.itemId);
    if (!to || !to.email || !from || !it) return null;
    const owner = person(it.ownerId);
    const forWhom = owner ? owner.name : 'someone';
    const total = state.chips.filter(c => c.itemId === it.id).reduce((t, c) => t + c.cents, 0);
    const so = it.priceCents ? `${money(total)} of ${money(it.priceCents)} is pledged so far.` : `${money(total)} is pledged so far.`;
    const gift = `the ${it.title} for ${forWhom}`;
    const lines = n.kind === 'ask'
      ? [`${from.name} is going in together on ${gift}, and asked if you would like to go in too.`, so]
      : n.change === 'joined' ? [`${from.name} is going in too, with ${money(n.cents)}, on ${gift}.`, so]
      : n.change === 'changed' ? [`${from.name} changed their amount to ${money(n.cents)} on ${gift}.`, so]
      : [`${from.name} is no longer going in on ${gift}.`, so];
    return {
      to: to.email, name: to.name, site,
      subject: n.kind === 'ask' ? `${from.name} asked you to go in on a gift for ${forWhom}` : `Going in together: ${it.title}`,
      lines: [...lines, `${forWhom} never sees any of this.`],
      button: 'Open the gift', link: `${origin}/lists?item=${encodeURIComponent(it.id)}`,
      footer: 'To stop these emails, open My shopping and turn off emails about going in together.'
    };
  }).filter(Boolean);
}

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
    // A new or changed store link is checked before saving (a few seconds at most), so everyone
    // who later opens the gift is warned if it looks unsafe. Never blocks the save.
    if ((op.op === 'addItem' || op.op === 'editItem') && op.url) op.linkCheck = await checkLink(op.url).catch(() => null);
    let outbox = [];
    const { state, extra } = await updateState(s => {
      outbox = [];                                    // a retried save starts the emails over
      const me = personForRequest(request, s);
      if (!me) throw new OpError('signed_out', SIGNED_OUT.message, 401);
      return apply(s, op, me, Date.now(), outbox);
    }, s => tidy(s));
    const me = personForRequest(request, state);
    if (!me) return json(SIGNED_OUT, 401);           // e.g. they signed themselves out everywhere
    // Emails about going in together, sent once the change is saved. A failed email never
    // undoes the change; the people asked still see it on the gift.
    if (outbox.length) {
      try { await sendGiftNotes(composeNotes(state, outbox, request)); }
      catch (e) { console.error('gift notes failed', e && e.message); }
    }
    const out = extra && typeof extra === 'object' ? extra : { id: extra ?? null };
    return json({ ...view(state, me), id: out.id ?? null,
      ...(out.notified ? { notified: out.notified } : {}), ...(out.skipped ? { skipped: out.skipped } : {}) });
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
