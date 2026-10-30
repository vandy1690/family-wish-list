// Family Wish List: the page script. Plain JavaScript, no build step.
//
// The server decides what each person may see (lib/lists/rules.js). This file only
// draws it. Nothing here hides purchases from a list's owner: the owner's browser is
// never sent them in the first place.
//
// Made for people who are new to computers, so: every screen does one thing, every
// screen has its own address (the Back button works), cards are plain links to an
// item's own page, and buttons say what they do in everyday words.
(function () {
  'use strict';

  const API = '/api/lists';
  const ORIGIN = location.origin;
  let SITE = 'Wish List';           // the short name of this wish list; applySite() sets it
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  // ------------------------------------------------------------ state

  const S = {
    data: null,            // what the server sent: { me, people, items, shopping }
    view: 'lists',         // lists | item | shopping | people
    personId: null,        // whose list (Lists page)
    itemId: null,          // which item (item page)
    sort: 'new',
    form: null,            // the open item form: { kind: 'add'|'edit', id, ownerId, values, typed, looked, error }
    panel: null,           // a confirm panel on the item page: 'buy' | 'chip' | 'remove'
    about: null,           // About text being edited: { personId, value }
    personForm: null,      // People: { id?, values }
    personPanel: null,     // People: { id, kind: 'remove'|'signout' }
    kidForm: null,         // a parent's form for a child's list: { id?, original, values, nameError }
    kidPanel: null,        // confirm removing a child's list: { id }
    share: null,           // who can see a list, being changed: { personId, mode: 'all'|'some', ids, kidsToo }
    drawForm: null,        // a name draw being started or changed: { id?, values, nameError }
    drawPanel: null,       // a confirm on Draw names: { id, kind: 'redraw'|'remove' }
    email: '',
    setupIdx: 0,           // first-run setup: which screen
    answers: null,         // setup answers for About me: { shirt, pants, shoe, colors, loves, avoid, extra }
    added: [],             // setup: things added on the first-wish screen
    tourStep: null,        // the tour: which tip is showing, or null
    focus: null            // a selector to focus after the next draw
  };

  // ------------------------------------------------------------ small helpers

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else n.setAttribute(k, String(v));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }

  const STORES = {
    'amazon.com': 'Amazon', 'a.co': 'Amazon', 'lego.com': 'LEGO', 'rei.com': 'REI', 'target.com': 'Target',
    'walmart.com': 'Walmart', 'etsy.com': 'Etsy', 'bestbuy.com': 'Best Buy', 'kohls.com': 'Kohl\'s',
    'costco.com': 'Costco', 'homedepot.com': 'Home Depot', 'lowes.com': 'Lowe\'s', 'barnesandnoble.com': 'Barnes & Noble',
    'nike.com': 'Nike', 'apple.com': 'Apple', 'llbean.com': 'L.L.Bean', 'patagonia.com': 'Patagonia',
    'dickssportinggoods.com': 'Dick\'s', 'cabelas.com': 'Cabela\'s', 'basspro.com': 'Bass Pro', 'nintendo.com': 'Nintendo'
  };
  const knownStore = s => (s ? STORES[s] || STORES[s.split('.').slice(-2).join('.')] || '' : '');
  const storeName = s => (s ? knownStore(s) || s : '');
  // Trim a store's own name off a product name: "Amazon.com: Lamp : Home", "Lamp : Target",
  // "Lamp | REI Co-op". Same rules as tidyTitle in lib/lists/meta.js. Also drops a phone
  // share's lead-in, like "Check out this product on Amazon:".
  function tidyTitle(title, url) {
    let t = String(title || '').replace(/\s+/g, ' ').trim()
      .replace(/^(check (this|it) out|check out this (product|item|deal)|look what i found|i found this)( on| at)? [^:]{0,30}?[:!-]\s*/i, '')
      .replace(/^amazon\.[a-z.]+\s*:\s*/i, '');
    let host = '';
    try { host = new URL(url).hostname; } catch (e) {}
    if (/amazon\./i.test(host)) t = t.replace(/\s+:\s+[^:]{2,40}$/, '');
    const brand = knownStore(host.replace(/^www\./, ''));
    if (!brand) return t.trim();
    const plain = x => x.toLowerCase().replace(/[®™'’.]/g, '');
    const b = plain(brand);
    const parts = t.split(/(\s[|\-–—:]\s)/);
    for (let i = 2; i < parts.length; i += 2) if (plain(parts[i]).includes(b)) { t = parts.slice(0, i - 1).join(''); break; }
    return t.trim();
  }
  const shopLabel = (verb, s) => (knownStore(s) ? `${verb} at ${knownStore(s)}` : `${verb} on the store's site`);

  const money = cents => {
    if (cents === null || cents === undefined) return '';
    const whole = cents % 100 === 0;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD',
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 }).format(cents / 100);
  };
  const day = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' });
  const imgSrc = s => (!s ? '' : s.startsWith('photo:') ? `${API}/photo?id=${encodeURIComponent(s.slice(6))}`
    : /^https:\/\//.test(s) ? s : '');
  const safeHref = s => (/^https?:\/\//i.test(s || '') ? s : null);
  const possessive = name => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

  const me = () => S.data.me;
  const person = id => S.data.people.find(p => p.id === id);
  const itemById = id => S.data.items.find(i => i.id === id);
  const hides = rel => rel === 'own' || rel === 'manage';
  const keeps = rel => rel !== 'shop';
  const listName = p => (p.rel === 'own' ? 'My list' : `${possessive(p.name)} list`);

  // ------------------------------------------------------------ status line

  // Signed in, messages show in a bar fixed to the bottom of the screen, so they are seen
  // wherever the person tapped, and they stay until the next action or OK. Signed out, they
  // show inside the sign-in box, next to what they are about.
  function say(text, tone) {
    if (!S.data) {
      const s = $('signinStatus');
      s.className = 'sdc-form-status' + (tone ? ` sdc-form-status--${tone}` : '');
      s.textContent = text || '';
      return;
    }
    const t = $('toast'), s = $('status');
    s.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    s.textContent = text || '';
    $('toastText').textContent = text || '';
    t.className = 'wl-toast' + (tone ? ` wl-toast--${tone}` : '');
    t.hidden = !text;
  }

  // ------------------------------------------------------------ talking to the server

  async function api(path, body) {
    const init = body === undefined
      ? { headers: { Accept: 'application/json' } }
      : { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) };
    let res;
    try { res = await fetch(API + path, { credentials: 'same-origin', ...init }); }
    catch (e) { return { ok: false, status: 0, data: { message: 'No connection. Check your internet and try again.' } }; }
    let data = {};
    try { data = await res.json(); } catch (e) { data = {}; }
    return { ok: res.ok, status: res.status, data };
  }

  // One change. On success the fresh lists come back and are drawn.
  async function change(body, okText, after) {
    const r = await api('/data', body);
    if (r.status === 401) { S.data = null; draw(); say(r.data.message || 'You are signed out.', 'error'); return null; }
    if (r.data && Array.isArray(r.data.people)) S.data = r.data;
    if (!r.ok) { say(r.data.message || 'That did not save. Try again.', 'error'); draw(); return null; }
    if (after) after(r.data);
    draw();
    if (okText) say(okText, 'success');
    return r.data;
  }

  async function load(quiet) {
    const r = await api('/data');
    if (r.status === 401) { S.data = null; draw(); return; }
    if (!r.ok) { if (!quiet) say(r.data.message || 'The lists did not load. Try again.', 'error'); if (!S.data) drawSignedOut(); return; }
    const first = !S.data;
    S.data = r.data;
    if (first) startView();
    draw();
  }

  // Someone else's change shows up within a minute, unless a form is open.
  const busy = () => S.form || S.panel || S.about || S.personForm || S.personPanel || S.kidForm || S.kidPanel ||
    S.share || S.drawForm || S.drawPanel ||
    (document.activeElement && document.activeElement.closest && document.activeElement.closest('form'));
  setInterval(() => { if (S.data && document.visibilityState === 'visible' && !busy()) load(true); }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (S.data && document.visibilityState === 'visible' && !busy()) load(true);
  });

  // ------------------------------------------------------------ addresses (the Back button works)

  function urlFor({ view = 'lists', list, item } = {}) {
    const q = new URLSearchParams();
    if (item) q.set('item', item);
    else if (view === 'shopping' || view === 'people' || view === 'draws') q.set('view', view);
    else if (list && (!S.data || list !== me().id)) q.set('list', list);
    const s = q.toString();
    return '/lists' + (s ? '?' + s : '');
  }

  function readRoute() {
    const q = new URLSearchParams(location.search);
    S.itemId = q.get('item') || null;
    const v = q.get('view');
    S.view = S.itemId ? 'item' : v === 'shopping' || v === 'people' || v === 'draws' ? v : 'lists';
    S.personId = q.get('list') || (S.data ? me().id : null);
  }

  function closeAll() {
    S.form = null; S.panel = null; S.about = null; S.personForm = null; S.personPanel = null; S.kidForm = null; S.kidPanel = null;
    S.share = null; S.drawForm = null; S.drawPanel = null;
  }
  const layerOpen = () => Boolean(S.form || S.panel || S.about || S.personForm || S.personPanel || S.kidForm || S.kidPanel
    || S.share || S.drawForm || S.drawPanel);

  // Forms and confirm steps get their own entry in the browser history, so the Back button
  // closes them instead of leaving the page. `back` is where focus goes when they close.
  function openLayer(name, apply, back) {
    apply();
    S.returnFocus = back || null;
    const url = location.pathname + location.search + '#' + name;
    if (history.state && history.state.layer) history.replaceState({ layer: name }, '', url);
    else history.pushState({ layer: name }, '', url);
    draw();
  }
  function closeLayer() {
    if (history.state && history.state.layer) { S.closing = true; history.back(); return; }
    const f = S.returnFocus;
    closeAll();
    S.returnFocus = null;
    S.focus = f;
    draw();
  }

  // A link inside the app: change the address, draw the new page, put focus on its heading.
  function go(href, replace) {
    if (S.data) say('');
    S.pick = null;
    closeAll();
    history[replace ? 'replaceState' : 'pushState'](null, '', href);
    readRoute();
    S.focus = '#pageH';
    draw();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (S.data) load(true);
  }

  document.addEventListener('click', e => {
    const a = e.target.closest('a[data-nav]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (!S.data) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });
  window.addEventListener('popstate', () => {
    const wasLayer = S.closing || layerOpen();
    S.closing = false;
    closeAll();
    readRoute();
    S.focus = wasLayer ? (S.returnFocus || '#pageH') : '#pageH';
    S.returnFocus = null;
    if (!wasLayer && S.data) say('');
    draw();
    if (!wasLayer) window.scrollTo({ top: 0, behavior: 'instant' });
  });

  const navLink = (href, label, current, extra) =>
    el('a', { href, 'data-nav': true, 'aria-current': current ? 'page' : null, ...(extra || {}) }, label);

  // ------------------------------------------------------------ arriving with something to add

  // From the Add button (?add=1&u=&t=&i=&p=), the iPhone shortcut (the same), or the
  // Android share menu (?su=&sx=&st=). Kept in this browser until the person is signed in.
  function readArrival() {
    const q = new URLSearchParams(location.search);
    let add = null;
    if (q.has('add')) {
      add = { url: q.get('u') || '', title: tidyTitle(q.get('t'), q.get('u')), image: q.get('i') || '', price: q.get('p') || '' };
    } else if (q.has('su') || q.has('sx') || q.has('st')) {
      const text = q.get('sx') || '';
      const found = (text.match(/https?:\/\/[^\s]+/) || [])[0] || '';
      const url = q.get('su') || found;
      const title = (q.get('st') || text.replace(found, '')).replace(/\s+/g, ' ').trim();
      add = { url, title: tidyTitle(title, url).slice(0, 200), image: '', price: '', lookup: Boolean(url) };
    }
    // The Add button clicked while this page was in front reads this page, not a store.
    let own = false;
    try { own = Boolean(add && add.url) && new URL(add.url).origin === ORIGIN; } catch (e) { own = false; }
    if (own) {
      add = null;
      say('That button read the wish list itself. Open a store\'s product page, then click Add to Wish List there.', 'warning');
    }
    if (add) store.set('wl-pending-add', { ...add, at: Date.now() });
    const signin = q.get('signin');
    if (signin === 'expired') say('That sign-in link has run out or was replaced by a newer one. Type your email to get a new code.', 'error');
    if (signin === 'error' || signin === 'off') say('Sign-in is having trouble right now. Try again in a few minutes.', 'error');
    if (signin === 'ok') say('You are signed in.', 'success');
    // Keep only the parts of the address that say which page this is.
    const keep = new URLSearchParams();
    for (const k of ['item', 'view', 'list']) if (q.get(k)) keep.set(k, q.get(k));
    const s = keep.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  function startView() {
    readRoute();
    if (S.view === 'people' && !me().admin) { S.view = 'lists'; history.replaceState(null, '', urlFor()); }
    if (S.view === 'lists' && !person(S.personId)) S.personId = me().id;
    const pending = store.get('wl-pending-add');
    if (pending && Date.now() - (pending.at || 0) < 2 * 3600e3) {
      S.view = 'lists';
      S.personId = me().id;
      history.replaceState(null, '', urlFor());
      S.form = { kind: 'add', ownerId: me().id, arrived: true, values: {
        url: pending.url || '', title: pending.title || '', image: /^https:\/\//.test(pending.image || '') ? pending.image : '',
        price: pending.price || '', note: '', qty: '1' } };
      S.focus = '#f-title';
      if (pending.lookup) setTimeout(() => lookup(true), 50);
    } else if (needsSetup()) {
      S.view = 'setup';
      S.setupIdx = Math.min((me().setup && me().setup.step) || 0, setupSteps().length - 1);
    }
    store.set('wl-pending-add', null);
  }

  // ------------------------------------------------------------ drawing

  // Where focus is now, as a selector that still matches after a redraw, so a keyboard
  // user keeps their place when the page refreshes under them.
  function focusKey() {
    const a = document.activeElement;
    if (!a || a === document.body || !$('view').contains(a)) return null;
    if (a.id) return '#' + CSS.escape(a.id);
    if (a.name && (a.type === 'radio' || a.type === 'checkbox')) {
      return `input[name=${JSON.stringify(a.name)}][value=${JSON.stringify(a.value)}]`;
    }
    return null;
  }

  function draw() {
    if (!S.data) { drawSignedOut(); return; }
    const asked = S.focus;
    const kept = asked ? null : focusKey();
    S.focus = null;
    $('signin').hidden = true;
    $('view').hidden = false;
    $('who').hidden = false;
    $('whoName').textContent = me().name;
    applySite(S.data.site);
    drawMainNav();
    $('helpBtn').hidden = S.view === 'setup';
    const root = $('view');
    root.replaceChildren();
    let title;
    if (S.view === 'setup') title = drawSetup(root);
    else if (S.view === 'item') title = drawItem(root);
    else if (S.view === 'shopping') title = drawShopping(root);
    else if (S.view === 'draws') title = drawDraws(root);
    else if (S.view === 'people' && me().admin) title = drawPeople(root);
    else title = drawLists(root);
    document.title = `${title} · ${SITE}`;
    const target = asked || kept;
    let f = target ? document.querySelector(target) : null;
    if (!f && asked) f = $('pageH');
    if (f && f !== document.activeElement) f.focus({ preventScroll: !asked || asked === '#pageH' });
    // The tour starts once, right after setup ends.
    if (S.tourStep !== null) { markTip(false); placeTip(); }
    else if (!tourSeen && me().tour && me().tour.state === 'pending' && S.view === 'lists' && !S.form) startTour();
  }

  function drawSignedOut() {
    $('toast').hidden = true;
    $('status').textContent = '';
    $('view').hidden = true;
    $('who').hidden = true;
    $('mainNav').hidden = true;
    $('signin').hidden = false;
    document.title = SITE;
  }

  function drawMainNav() {
    const nav = $('mainNav');
    if (S.view === 'setup') { nav.hidden = true; return; }
    const on = S.view === 'item' ? 'lists' : S.view;
    const links = [navLink(urlFor({ list: me().id }), 'Lists', on === 'lists'),
      navLink(urlFor({ view: 'shopping' }), 'My shopping', on === 'shopping'),
      navLink(urlFor({ view: 'draws' }), 'Draw names', on === 'draws')];
    if (me().admin) links.push(navLink(urlFor({ view: 'people' }), 'People', on === 'people'));
    nav.replaceChildren(...links);
    nav.hidden = false;
  }

  // ------------------------------------------------------------ form pieces (SDC Field, Select, Choice)

  // addon: a button that sits on the same line as the input, lined up with it; the hint goes under both.
  function field({ id, label, value = '', type = 'text', hint, multiline, rows = 3, required, attrs, oninput, onchange, error, addon }) {
    const hintId = hint ? `${id}-hint` : null;
    const errId = error ? `${id}-err` : null;
    const described = [hintId, errId].filter(Boolean).join(' ') || null;
    const common = { class: 'sdc-field__input', id, name: id, 'aria-describedby': described,
      'aria-invalid': error ? 'true' : null, required: Boolean(required), ...(attrs || {}) };
    const input = multiline ? el('textarea', { ...common, rows }) : el('input', { ...common, type });
    input.value = value || '';
    if (oninput) input.addEventListener('input', oninput);
    if (onchange) input.addEventListener('change', onchange);
    return el('div', { class: 'sdc-field' + (error ? ' sdc-field--invalid' : '') },
      el('label', { class: 'sdc-field__label', for: id }, label,
        required ? el('span', { class: 'sdc-field__req', 'aria-hidden': 'true' }, '*') : null),
      addon ? el('div', { class: 'wl-input-row' }, input, hint ? el('p', { class: 'sdc-field__hint', id: hintId }, hint) : null, addon) : input,
      hint && !addon ? el('p', { class: 'sdc-field__hint', id: hintId }, hint) : null,
      error ? el('p', { class: 'sdc-field__error', id: errId }, error) : null);
  }

  function selectField({ id, label, options, groups, value, hint, onchange, cls, addon }) {
    const hintId = hint ? `${id}-hint` : null;
    const opt = o => el('option', { value: o.value }, o.label);
    const s = el('select', { class: 'sdc-select', id, name: id, 'aria-describedby': hintId },
      groups ? groups.map(g => el('optgroup', { label: g.label }, g.options.map(opt))) : options.map(opt));
    s.value = value;
    if (onchange) s.addEventListener('change', onchange);
    return el('div', { class: 'sdc-field' + (cls ? ' ' + cls : '') },
      el('label', { class: 'sdc-field__label', for: id }, label), addon ? el('div', { class: 'wl-input-row' }, s, addon) : s,
      hint ? el('p', { class: 'sdc-field__hint', id: hintId }, hint) : null);
  }

  function choice({ name, value, label, checked, radio = true, onchange }) {
    return el('label', { class: 'sdc-choice' },
      el('input', { type: radio ? 'radio' : 'checkbox', name, value, checked: Boolean(checked), onchange }),
      el('span', null, label));
  }

  const btn = (label, onclick, primary, extra) =>
    el('button', { class: 'sdc-btn' + (primary ? ' sdc-btn--primary' : ''), type: 'button', onclick, ...(extra || {}) }, label);
  const tag = (tone, text) => el('span', { class: `wl-tag wl-tag--${tone}` }, text);
  // An action that reads as a text link (still a button, since it does something here).
  const linkBtn = (label, onclick, extra) => el('button', { class: 'wl-linkbtn', type: 'button', onclick, ...(extra || {}) }, label);
  const pageH = (text, cls) => el('h1', { class: 'sdc-display wl-h1' + (cls ? ' ' + cls : ''), id: 'pageH', tabindex: '-1' }, text);

  // A photo, or the item's name in its place.
  function art(it) {
    const src = imgSrc(it.image);
    return el('div', { class: 'wl-art' + (src ? '' : ' wl-art--none'), 'aria-hidden': 'true' }, src
      ? el('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', decoding: 'async' })
      : el('span', { class: 'wl-art__name' }, it.title || ''));
  }

  // ------------------------------------------------------------ Lists page

  function orderedPeople() {
    const rank = p => (p.rel === 'own' ? 0 : p.rel === 'shop' ? 2 : 1);
    return [...S.data.people].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }

  function drawLists(root) {
    const owner = person(S.personId) || person(me().id);
    S.personId = owner.id;
    const counts = {};
    for (const it of S.data.items) counts[it.ownerId] = (counts[it.ownerId] || 0) + 1;
    const everyone = orderedPeople();
    const label = p => (p.rel === 'own' ? 'My list' : p.name);

    // Names down the side on a computer; one simple menu on a phone.
    const side = el('nav', { class: 'wl-side', 'aria-label': 'Whose list' },
      el('h2', { class: 'sdc-subhead' }, 'Lists'),
      el('ul', null, everyone.map(p => el('li', null,
        navLink(urlFor({ list: p.id }), [el('span', null, label(p)),
          el('span', { class: 'wl-side__count' }, String(counts[p.id] || 0), el('span', { class: 'sdc-u-sr-only' }, (counts[p.id] || 0) === 1 ? ' thing' : ' things'))],
          p.id === owner.id)))));
    // On a phone: choose a name, then tap Show list. Changing the menu alone never leaves the
    // page, because arrow keys change a closed menu on some computers (WCAG 3.2.2).
    const pick = el('form', { class: 'wl-pick', novalidate: true, onsubmit: e => { e.preventDefault(); go(urlFor({ list: $('wl-person').value })); } },
      // S.pick keeps a choice made but not yet shown, so a background refresh cannot undo it.
      selectField({ id: 'wl-person', label: 'Whose list', value: S.pick && person(S.pick) ? S.pick : owner.id,
        onchange: e => { S.pick = e.target.value; },
        options: everyone.map(p => { const c = counts[p.id] || 0; return { value: p.id, label: `${label(p)}, ${c} ${c === 1 ? 'thing' : 'things'}` }; }),
        addon: el('button', { class: 'sdc-btn', type: 'submit', id: 'wl-show' }, 'Show list') }));

    const rel = owner.rel;
    const lede = rel === 'own' ? 'Add what you would like. You will never see what anyone buys for you.'
      : rel === 'manage' ? `You keep this list for ${owner.name}. What is bought is hidden from you too.`
      : rel === 'parent' ? `You keep this list for ${owner.name}, and you can see what has been bought.`
      : `${owner.name} cannot see what is bought, or the secret ideas people add.`;
    const addLabel = keeps(rel) ? 'Add an item' : 'Add a secret idea';

    // A parent who keeps a child's list can change its details or remove it, right here.
    const keptKid = owner.kid && rel !== 'own' && keeps(rel);
    const quiet = !S.kidForm && !S.kidPanel && !S.share;
    const shareLink = linkBtn(rel === 'own' ? 'Change who can see it' : 'Who can see it', () => openShare(owner), { id: 'shareEdit' });
    const kidLinks = keptKid && quiet ? el('div', { class: 'wl-actions wl-actions--links' },
      linkBtn('Edit details', () => openKidEdit(owner), { id: 'kidEdit' }), shareLink,
      linkBtn('Remove this list', () => openLayer('remove-list', () => { S.kidPanel = { id: owner.id }; S.focus = '#kp-remove'; }, '#kidRemove'),
        { id: 'kidRemove' })) : null;
    // Your own list says who can see it, with a way to change that.
    const ownShare = rel === 'own' ? el('div', null, el('p', { class: 'wl-sub' }, sharedText(owner)),
      quiet ? el('div', { class: 'wl-actions wl-actions--links' }, shareLink) : null) : null;

    const main = el('div', { class: 'wl-main' }, pick,
      el('header', { class: 'wl-listhead' },
        el('div', null, pageH(listName(owner)), el('p', { class: 'wl-sub' }, lede),
          owner.keptBy ? el('p', { class: 'wl-sub' }, `Kept by ${owner.keptBy.join(' and ')}.`) : null,
          keptKid ? el('p', { class: 'wl-sub' }, sharedText(owner)) : null, ownShare, kidLinks),
        S.form && S.form.kind === 'add' ? null : btn(addLabel, () => openAdd(owner.id), true, { id: 'addBtn' })));
    // The side list comes after the list in the page, so a screen reader meets the heading first.

    if (keptKid && S.kidForm && S.kidForm.id === owner.id) main.append(el('div', { class: 'wl-panel' }, kidForm()));
    if (keptKid && S.kidPanel && S.kidPanel.id === owner.id) main.append(kidRemovePanel(owner));
    if (S.share && S.share.personId === owner.id && (rel === 'own' || keptKid)) main.append(el('div', { class: 'wl-panel' }, shareForm(owner)));
    if (S.form && S.form.kind === 'add') main.append(el('div', { class: 'wl-panel' }, itemForm()));
    main.append(aboutCard(owner));

    const all = S.data.items.filter(i => i.ownerId === owner.id);
    if (!all.length) {
      main.append(el('div', { class: 'wl-empty' },
        el('p', null, rel === 'own' ? 'Your list is empty.' : 'Nothing on this list yet.'),
        el('p', null, rel === 'own'
          ? 'Tap Add an item. A store link is optional, so homemade things like cookies or a knitted dog work too.'
          : keeps(rel) ? 'Tap Add an item to put the first thing on it.'
          : `You can still add a secret idea for ${owner.name}. Everyone but ${owner.name} will see it.`)));
    } else {
      const shown = filtered(all, rel);
      main.append(el('div', { class: 'wl-toolbar' }, sortField(rel),
        el('p', { class: 'wl-count', 'aria-live': 'polite' },
          shown.length === all.length ? `${all.length} ${all.length === 1 ? 'thing' : 'things'}` : `Showing ${shown.length} of ${all.length}`)));
      if (shown.length) main.append(el('ul', { class: 'wl-grid', 'aria-label': listName(owner) }, shown.map(card)));
      else main.append(el('div', { class: 'wl-empty' }, el('p', null, 'Nothing matches. Choose "Newest first" in Sort to see everything.')));
    }
    if (rel === 'own') main.append(kidsPanel(), helpPanel());
    root.append(el('div', { class: 'wl-split' }, main, side));
    return listName(owner);
  }

  // ------------------------------------------------------------ lists for children
  // Any grown-up can add a list for their own child. A child has no email, so this never
  // lets anyone new sign in (only the admin does that, on People). The server checks all of it.

  const keptKids = () => S.data.people.filter(p => p.kid && p.rel !== 'own' && keeps(p.rel))
    .sort((a, b) => a.name.localeCompare(b.name));

  // On My list: the children's lists this person keeps, and the way to add one.
  function kidsPanel() {
    if (S.kidForm && !S.kidForm.id) return el('div', { class: 'wl-panel' }, kidForm());
    const mine = keptKids();
    return el('section', { class: 'wl-panel wl-panel--quiet', 'aria-labelledby': 'kidsH' },
      el('h2', { class: 'sdc-subhead', id: 'kidsH' }, 'Lists for your kids'),
      el('p', null, 'For a child who does not have an email. You keep their list and add what they would like.'),
      mine.length ? el('ul', { class: 'wl-kids' }, mine.map(p => el('li', null, navLink(urlFor({ list: p.id }), listName(p))))) : null,
      el('div', { class: 'wl-actions' }, btn('Add a list for your child', () => openLayer('add-list', () => {
        S.kidForm = { values: { name: '', other: '', extra: [], parentsSee: true } };
        S.focus = '#kf-name';
      }, '#addKidBtn'), false, { id: 'addKidBtn' })));
  }

  function openKidEdit(owner) {
    const others = (owner.managers || []).filter(id => id !== me().id);
    openLayer('edit-list', () => {
      S.kidForm = { id: owner.id, original: owner.name,
        values: { name: owner.name, other: others[0] || '', extra: others.slice(1), parentsSee: Boolean(owner.parentsSee) } };
      S.focus = '#kf-name';
    }, '#kidEdit');
  }

  // The child's name, the other parent, and whether the parents see what was bought.
  function kidForm() {
    const f = S.kidForm, v = f.values;
    const grownUps = S.data.people.filter(p => !p.kid && p.id !== me().id).sort((a, b) => a.name.localeCompare(b.name));
    return el('form', { class: 'wl-form', novalidate: true, 'aria-labelledby': 'kidFormH', onsubmit: async e => {
      e.preventDefault();
      const name = v.name.trim();
      f.nameError = name ? null : 'Enter your child\'s name.';
      if (f.nameError) { S.focus = '#kf-name'; draw(); return; }
      const r = await change({ op: 'saveKid', id: f.id, name, managers: [v.other, ...v.extra].filter(Boolean), parentsSee: v.parentsSee });
      if (!r) { S.focus = '#kf-name'; draw(); return; }
      if (f.id) { closeLayer(); say('Saved.', 'success'); return; }
      // Open the new list in place of the form, so Back returns to My list.
      go(urlFor({ list: r.id }), true);
      say(`${possessive(name)} list is ready. Tap Add an item to put the first thing on it.`, 'success');
    } },
    el('h2', { class: 'sdc-subhead', id: 'kidFormH' }, f.id ? `Edit ${possessive(f.original)} list` : 'Add a list for your child'),
    el('div', { class: 'wl-fields' },
      field({ id: 'kf-name', label: 'Child\'s name', value: v.name, required: true, error: f.nameError || null,
        attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'The name everyone sees, like Ella or Baby Max.',
        oninput: e => { v.name = e.target.value; } }),
      selectField({ id: 'kf-other', label: 'Other parent (optional)', value: v.other,
        options: [{ value: '', label: 'Just me' }, ...grownUps.map(p => ({ value: p.id, label: p.name }))],
        hint: 'They can add and change things on this list too.', onchange: e => { v.other = e.target.value; } })),
    el('fieldset', { class: 'sdc-fieldset' },
      el('legend', null, 'Can the parents see what others buy for this child?'),
      el('div', { class: 'sdc-choice-set' },
        choice({ name: 'kf-see', value: 'yes', label: 'Yes, so we do not buy the same thing', checked: v.parentsSee, onchange: () => { v.parentsSee = true; } }),
        choice({ name: 'kf-see', value: 'no', label: 'No, keep it a surprise for us too', checked: !v.parentsSee, onchange: () => { v.parentsSee = false; } }))),
    el('div', { class: 'wl-actions' },
      el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, f.id ? 'Save' : 'Make the list'),
      btn('Cancel', closeLayer)));
  }

  function kidRemovePanel(owner) {
    const n = S.data.items.filter(i => i.ownerId === owner.id).length;
    return el('div', { class: 'wl-confirm', role: 'group', 'aria-labelledby': 'kp-q' },
      el('p', { id: 'kp-q' }, `Remove ${possessive(owner.name)} list? ${n ? `The ${n} ${n === 1 ? 'thing' : 'things'} on it go too, and anything people marked bought for ${owner.name}.` : 'It is empty.'} This cannot be undone.`),
      btn(`Yes, remove ${possessive(owner.name)} list`, async () => {
        const name = owner.name;
        const ok = await change({ op: 'removeKid', id: owner.id });
        if (!ok) return;
        go(urlFor({ list: me().id }), true);
        say(`${possessive(name)} list was removed.`, 'success');
      }, true, { id: 'kp-remove' }),
      btn('No, keep it', closeLayer));
  }

  // ------------------------------------------------------------ who can see a list

  const joinNames = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

  // The line under a list's heading: everyone, or the names it is shared with.
  function sharedText(owner) {
    const yours = owner.rel === 'own';
    const whose = yours ? 'your list' : `${possessive(owner.name)} list`;
    if (!Array.isArray(owner.audience)) return `Everyone on the wish list can see ${whose}.`;
    const names = owner.audience.map(id => S.data.members.find(m => m.id === id)).filter(Boolean).map(m => m.name);
    if (!names.length) return yours ? 'Only you can see your list.' : `Only ${possessive(owner.name)} parents can see ${whose}.`;
    return `Only ${joinNames(names)} can see ${whose}${yours ? '' : `, besides ${possessive(owner.name)} parents`}.`;
  }

  function openShare(owner) {
    openLayer('share', () => {
      S.share = { personId: owner.id, mode: Array.isArray(owner.audience) ? 'some' : 'all', ids: [...(owner.audience || [])], kidsToo: false };
      S.focus = 'input[name="sh-mode"]:checked';
    }, '#shareEdit');
  }

  function shareForm(owner) {
    const f = S.share;
    const yours = owner.rel === 'own';
    const kids = yours ? keptKids() : [];
    const skip = new Set([me().id, owner.id, ...(owner.managers || [])]);
    const choices = S.data.members.filter(m => !skip.has(m.id));
    const whose = yours ? 'your list' : `${possessive(owner.name)} list`;
    const mode = m => () => { f.mode = m; S.focus = `input[name="sh-mode"][value="${m}"]`; draw(); };
    const notes = [yours ? null : `${possessive(owner.name)} parents always can.`,
      me().admin ? null : `${S.data.adminName} can always see every list, to help.`,
      'Someone who draws this name in a name draw can see it too.'].filter(Boolean);
    return el('form', { class: 'wl-form', novalidate: true, 'aria-labelledby': 'shareH', onsubmit: async e => {
      e.preventDefault();
      const audience = f.mode === 'all' ? null : f.ids.filter(id => choices.some(m => m.id === id));
      const ok = await change({ op: 'saveAudience', personId: owner.id, audience, kidsToo: f.kidsToo });
      if (!ok) return;
      closeLayer();
      say(`Saved. ${sharedText(person(owner.id))}`, 'success');
    } },
    el('h2', { class: 'sdc-subhead', id: 'shareH' }, `Who can see ${whose}?`),
    el('fieldset', { class: 'sdc-fieldset' },
      el('legend', { class: 'sdc-u-sr-only' }, `Who can see ${whose}`),
      el('div', { class: 'sdc-choice-set' },
        choice({ name: 'sh-mode', value: 'all', label: 'Everyone on the wish list', checked: f.mode === 'all', onchange: mode('all') }),
        choice({ name: 'sh-mode', value: 'some', label: 'Only the people I pick', checked: f.mode === 'some', onchange: mode('some') }))),
    f.mode === 'some' ? el('fieldset', { class: 'sdc-fieldset' },
      el('legend', null, 'Pick who can see it'),
      choices.length ? el('div', { class: 'sdc-choice-set' }, choices.map(m => choice({ name: 'sh-who', value: m.id, label: m.name, radio: false,
        checked: f.ids.includes(m.id), onchange: e => { f.ids = e.target.checked ? [...f.ids, m.id] : f.ids.filter(x => x !== m.id); } })))
        : el('p', null, 'There is nobody else to pick yet.')) : null,
    el('p', { class: 'wl-hint' }, notes.join(' ')),
    kids.length ? el('div', { class: 'sdc-choice-set' }, choice({ name: 'sh-kids', value: 'kids', radio: false, checked: f.kidsToo,
      label: `Use the same for ${joinNames(kids.map(listName))}`, onchange: e => { f.kidsToo = e.target.checked; } })) : null,
    el('div', { class: 'wl-actions' },
      el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, 'Save'),
      btn('Cancel', closeLayer)));
  }

  // ------------------------------------------------------------ Draw names
  // Each person in a draw gets one name to give to. Only the giver sees it (for a kid, the
  // kid's parents). Not the person who started the draw, and not the admin. The server
  // does the drawing and keeps the full list of matches to itself.

  const longDay = iso => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

  function drawDraws(root) {
    const draws = [...S.data.draws].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const adding = S.drawForm && !S.drawForm.id;
    root.append(el('header', { class: 'wl-listhead' },
      el('div', null, pageH('Draw names'),
        el('p', { class: 'wl-sub' }, 'Each person draws one name and gives that person a gift. Only you see who you drew. Not even the person who starts the draw sees the rest.')),
      adding ? null : btn('Start a name draw', () => openDrawForm(), true, { id: 'newDrawBtn' })));
    if (adding) root.append(el('div', { class: 'wl-panel' }, drawFormEl()));
    if (!draws.length && !adding) {
      root.append(el('div', { class: 'wl-empty' },
        el('p', null, 'No name draws yet.'),
        el('p', null, 'Start one for Christmas, or for one side of the family. Pick who is in it, then tap Draw names.')));
    }
    if (draws.length) root.append(el('div', { class: 'wl-draws' }, draws.map(drawCard)));
    return 'Draw names';
  }

  function drawCard(d) {
    if (S.drawForm && S.drawForm.id === d.id) return el('section', { class: 'wl-panel' }, drawFormEl());
    const panel = S.drawPanel && S.drawPanel.id === d.id ? S.drawPanel.kind : null;
    const facts = [`Started by ${d.mine ? 'you' : d.organizer}`, `${d.participants.length} people`];
    if (d.budget) facts.push(`Spending limit ${d.budget}`);
    if (d.giveBy) facts.push(`Give by ${longDay(d.giveBy)}`);
    const line = (label, m) => el('p', { class: 'wl-match' }, `${label} `,
      el('a', { href: urlFor({ list: m.id }), 'data-nav': true }, m.name), '.');
    const matches = [];
    if (d.myMatch) matches.push(line('You are giving to', d.myMatch));
    for (const k of d.kidMatches || []) matches.push(line(`${k.kidName} is giving to`, k));
    const status = d.drawnAt
      ? (matches.length ? el('div', { class: 'wl-matches' }, matches) : el('p', null, 'Names are drawn. Only each giver sees who they drew.'))
      : el('p', null, d.redraw ? 'Someone was added or taken out, so names need to be drawn again.' : 'Names have not been drawn yet.');
    let actions = null;
    if (panel === 'redraw') {
      actions = el('div', { class: 'wl-confirm', role: 'group', 'aria-labelledby': `dq-${d.id}` },
        el('p', { id: `dq-${d.id}` }, `Draw ${d.name} again? Everyone gets a new name. Let them know to look again.`),
        btn('Yes, draw again', () => drawNow(d, 'Names are drawn again. Everyone sees their new name here.'), true, { id: 'dp-yes' }),
        btn('Cancel', closeLayer));
    } else if (panel === 'remove') {
      actions = el('div', { class: 'wl-confirm', role: 'group', 'aria-labelledby': `dq-${d.id}` },
        el('p', { id: `dq-${d.id}` }, `Remove ${d.name}? The names drawn go with it.`),
        btn('Yes, remove it', async () => { const ok = await change({ op: 'removeDraw', id: d.id }, `${d.name} was removed.`); if (ok) { S.drawPanel = null; S.focus = '#pageH'; draw(); } }, true, { id: 'dp-yes' }),
        btn('No, keep it', closeLayer));
    } else if (d.canManage) {
      const confirm = kind => () => openLayer(`draw-${kind}`, () => { S.drawPanel = { id: d.id, kind }; S.focus = '#dp-yes'; }, `#d${kind[0]}-${d.id}`);
      actions = el('div', { class: 'wl-draw__actions' },
        d.drawnAt ? null : btn('Draw names', () => drawNow(d, 'Names are drawn. Everyone in it sees who they drew, here on Draw names.'), true, { id: `dd-${d.id}` }),
        el('div', { class: 'wl-actions wl-actions--links' },
          linkBtn('Edit', () => openDrawForm(d), { id: `de-${d.id}` }),
          d.drawnAt ? linkBtn('Draw again', confirm('redraw'), { id: `dr-${d.id}` }) : null,
          linkBtn('Remove this draw', confirm('remove'), { id: `dx-${d.id}` })));
    }
    return el('section', { class: 'wl-panel wl-draw', 'aria-labelledby': `dh-${d.id}` },
      el('h2', { class: 'sdc-subhead', id: `dh-${d.id}` }, d.name),
      el('p', { class: 'wl-row__meta' }, facts.join(' · ')),
      status,
      el('p', { class: 'wl-row__meta' }, `In it: ${joinNames(d.participants.map(p => p.name))}.`),
      actions);
  }

  async function drawNow(d, okText) {
    const ok = await change({ op: 'drawNames', id: d.id });
    if (!ok) return;
    S.drawPanel = null;
    S.focus = `#dh-${d.id}`;
    if (history.state && history.state.layer) history.replaceState(null, '', location.pathname + location.search);
    draw();
    say(okText, 'success');
  }

  function openDrawForm(d) {
    openLayer(d ? 'edit-draw' : 'new-draw', () => {
      S.drawPanel = null;
      S.drawForm = d
        ? { id: d.id, drawn: Boolean(d.drawnAt), values: { name: d.name, participants: d.participants.map(p => p.id),
            apart: (d.apart || []).map(x => [...x]), budget: d.budget, giveBy: d.giveBy, a: '', b: '' } }
        : { values: { name: '', participants: [me().id], apart: [], budget: '', giveBy: '', a: '', b: '' } };
      S.focus = '#df-name';
    }, d ? `#de-${d.id}` : '#newDrawBtn');
  }

  function drawFormEl() {
    const f = S.drawForm, v = f.values;
    const everyone = orderedPeople();
    const label = p => (p.id === me().id ? `${p.name} (you)` : p.kid ? `${p.name} (kid)` : p.name);
    const nameOf = id => (person(id) || {}).name || 'Someone';
    const inDraw = everyone.filter(p => v.participants.includes(p.id));
    const pickOptions = [{ value: '', label: 'Pick a person' }, ...inDraw.map(p => ({ value: p.id, label: p.name }))];
    const toggle = p => e => {
      v.participants = e.target.checked ? [...v.participants, p.id] : v.participants.filter(x => x !== p.id);
      v.apart = v.apart.filter(([a, b]) => v.participants.includes(a) && v.participants.includes(b));
      S.focus = `input[name="df-who"][value="${p.id}"]`;
      draw();
    };
    const keepApart = () => {
      if (!v.a || !v.b || v.a === v.b) { say('Pick two different people to keep apart.', 'error'); S.focus = v.a ? '#df-b' : '#df-a'; draw(); return; }
      if (!v.apart.some(([a, b]) => (a === v.a && b === v.b) || (a === v.b && b === v.a))) v.apart.push([v.a, v.b]);
      v.a = ''; v.b = '';
      S.focus = '#df-a';
      draw();
    };
    return el('form', { class: 'wl-form', novalidate: true, 'aria-labelledby': 'drawFormH', onsubmit: async e => {
      e.preventDefault();
      f.nameError = v.name.trim() ? null : 'Give the draw a name, like Christmas 2026.';
      f.whoError = v.participants.length >= 3 ? null : 'Pick at least three people.';
      if (f.nameError || f.whoError) { S.focus = f.nameError ? '#df-name' : 'input[name="df-who"]'; draw(); return; }
      const name = v.name.trim();
      const r = await change({ op: 'saveDraw', id: f.id, name, participants: v.participants, apart: v.apart, budget: v.budget, giveBy: v.giveBy });
      if (!r) return;
      const was = f;
      closeLayer();
      say(was.id ? 'Saved.' : `${name} is ready. Tap Draw names when everyone is in.`, 'success');
    } },
    el('h2', { class: 'sdc-subhead', id: 'drawFormH' }, f.id ? `Edit ${v.name || 'the draw'}` : 'Start a name draw'),
    f.drawn ? el('p', { class: 'wl-hint' }, 'Names are already drawn. Changing who is in it, or who is kept apart, means drawing again.') : null,
    el('div', { class: 'wl-fields' },
      field({ id: 'df-name', label: 'Name of the draw', value: v.name, required: true, error: f.nameError || null,
        attrs: { maxlength: 60, autocomplete: 'off' }, hint: 'Like Christmas 2026, or Cousins on Mom\'s side.', oninput: e => { v.name = e.target.value; } }),
      field({ id: 'df-budget', label: 'Spending limit (optional)', value: v.budget, attrs: { maxlength: 40, autocomplete: 'off' },
        hint: 'Like $30', oninput: e => { v.budget = e.target.value; } }),
      field({ id: 'df-giveby', label: 'Give gifts by (optional)', type: 'date', value: v.giveBy,
        oninput: e => { v.giveBy = e.target.value; } })),
    el('fieldset', { class: 'sdc-fieldset', 'aria-describedby': f.whoError ? 'df-who-err' : null },
      el('legend', null, 'Who is in it'),
      el('div', { class: 'sdc-choice-set' }, everyone.map(p => choice({ name: 'df-who', value: p.id, label: label(p), radio: false,
        checked: v.participants.includes(p.id), onchange: toggle(p) }))),
      f.whoError ? el('p', { class: 'sdc-field__error', id: 'df-who-err' }, f.whoError) : null,
      el('p', { class: 'sdc-fieldset__desc' }, 'Kids can be in it too. Their parents see who the kid drew, and shop for them.')),
    el('fieldset', { class: 'sdc-fieldset' },
      el('legend', null, 'Keep apart (optional)'),
      el('p', { class: 'sdc-fieldset__desc' }, 'People who live together usually skip each other. Parents and their own kids, and two parents of the same kid, are kept apart already.'),
      v.apart.length ? el('ul', { class: 'wl-apart' }, v.apart.map(([a, b], i) => el('li', null, `${nameOf(a)} and ${nameOf(b)}`,
        linkBtn('Take off', () => { v.apart.splice(i, 1); S.focus = '#df-a'; draw(); }, { 'aria-label': `Take off ${nameOf(a)} and ${nameOf(b)}` })))) : null,
      inDraw.length >= 2 ? el('div', { class: 'wl-fields' },
        selectField({ id: 'df-a', label: 'Keep', value: v.a, options: pickOptions, onchange: e => { v.a = e.target.value; } }),
        selectField({ id: 'df-b', label: 'Apart from', value: v.b, options: pickOptions, onchange: e => { v.b = e.target.value; },
          addon: btn('Keep apart', keepApart, false, { id: 'df-apart' }) })) : null),
    el('div', { class: 'wl-actions' },
      el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, f.id ? 'Save' : 'Save the draw'),
      btn('Cancel', closeLayer)));
  }

  // Sizes and favorites
  function aboutCard(owner) {
    const editable = keeps(owner.rel);
    const heading = owner.rel === 'own' ? 'About me' : `About ${owner.name}`;
    if (S.about && S.about.personId === owner.id) {
      return el('form', { class: 'wl-panel', novalidate: true, onsubmit: async e => {
        e.preventDefault();
        const ok = await change({ op: 'saveAbout', personId: owner.id, about: S.about.value }, 'Saved.');
        if (ok) closeLayer();
      } },
      el('h2', { class: 'sdc-subhead' }, heading),
      field({ id: 'f-about', label: 'Sizes, favorites and anything a shopper should know', multiline: true, rows: 5,
        value: S.about.value, attrs: { maxlength: 600 },
        hint: 'Shirt, pants and shoe size, favorite colors, teams, gluten free, and things you have plenty of.',
        oninput: e => { S.about.value = e.target.value; } }),
      el('div', { class: 'wl-actions' },
        el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, 'Save'),
        btn('Cancel', closeLayer)));
    }
    if (!owner.about && !editable) return el('div', { hidden: true });
    return el('section', { class: 'wl-panel wl-panel--quiet', 'aria-labelledby': 'aboutH' },
      el('h2', { class: 'sdc-subhead', id: 'aboutH' }, heading),
      owner.about ? el('p', { class: 'wl-about' }, owner.about)
        : el('p', { class: 'wl-about wl-about--empty' }, 'Add sizes and favorites so shoppers get it right: shirt and shoe size, favorite colors, gluten free, and so on.'),
      editable ? el('div', { class: 'wl-actions' },
        btn('Edit', () => openLayer('about', () => { S.about = { personId: owner.id, value: owner.about || '' }; S.focus = '#f-about'; }, '#aboutEdit'),
          false, { id: 'aboutEdit' })) : null);
  }

  // One Sort menu holds the order and the price ranges.
  const RANGES = { u25: [0, 2500], 25: [2500, 5000], 50: [5000, 10000], 100: [10000, Infinity] };
  function sortField(rel) {
    const show = [{ value: 'u25', label: 'Under $25' }, { value: '25', label: '$25 to $50' },
      { value: '50', label: '$50 to $100' }, { value: '100', label: '$100 and up' }];
    if (!hides(rel)) show.unshift({ value: 'needed', label: 'Still needed' });
    if (hides(rel) && S.sort === 'needed') S.sort = 'new';
    return selectField({ id: 'wl-sort', label: 'Sort', value: S.sort,
      groups: [
        { label: 'Order', options: [{ value: 'new', label: 'Newest first' }, { value: 'low', label: 'Price: low to high' }, { value: 'high', label: 'Price: high to low' }] },
        { label: 'Show only', options: show }],
      onchange: e => { S.sort = e.target.value; S.focus = '#wl-sort'; draw(); } });
  }
  function filtered(items, rel) {
    let out = items;
    const range = RANGES[S.sort];
    if (range) out = out.filter(i => i.priceCents !== null && i.priceCents !== undefined && i.priceCents >= range[0] && i.priceCents < range[1]);
    if (S.sort === 'needed') out = out.filter(i => i.need > 0 && !i.removed);
    const order = range ? 'low' : S.sort;
    const price = i => (i.priceCents === null || i.priceCents === undefined ? null : i.priceCents);
    return [...out].sort((a, b) => {
      if (!hides(rel)) {
        const done = i => (i.removed ? 2 : i.need > 0 ? 0 : 1);
        if (done(a) !== done(b)) return done(a) - done(b);
      }
      if (order === 'low' || order === 'high') {
        const pa = price(a), pb = price(b);
        if (pa === null && pb !== null) return 1;
        if (pb === null && pa !== null) return -1;
        if (pa !== pb) return order === 'low' ? pa - pb : pb - pa;
      }
      return b.createdAt - a.createdAt;
    });
  }

  // ------------------------------------------------------------ the gift card: one link, no buttons

  // onPage: the item's own page shows the chip-in box itself, so no chip-in tag there.
  function statusTags(it, owner, onPage) {
    if (hides(it.rel)) return [];
    const tags = [];
    if (it.secret) tags.push(tag('idea', it.addedBy === me().name ? 'Your secret idea' : `Secret idea from ${it.addedBy}`));
    for (const b of it.buys) {
      tags.push(tag('done', b.mine ? (it.qty > 1 ? `You bought ${b.qty}` : 'You bought this')
        : it.qty > 1 ? `${b.buyer} bought ${b.qty}` : `Bought by ${b.buyer}`));
    }
    if (!onPage && it.chips.length && !it.removed && it.need > 0) tags.push(tag('idea', `Going in together: ${money(it.chips.reduce((n, c) => n + c.cents, 0))}`));
    if (it.removed) tags.push(tag('stop', `${owner ? owner.name : 'The owner'} took this off the list`));
    if (it.buys.some(b => b.mine && b.changed)) tags.push(tag('warn', 'Changed after you bought it'));
    return tags;
  }

  function card(it) {
    const owner = person(it.ownerId);
    const shopper = !hides(it.rel);
    const meta = [];
    if (it.priceCents !== null && it.priceCents !== undefined) meta.push(el('span', { class: 'wl-price' }, money(it.priceCents)));
    if (it.qty > 1) meta.push(el('span', null, shopper && it.bought ? `${it.need} of ${it.qty} still needed` : `Wants ${it.qty}`));
    const tags = statusTags(it, owner);
    const done = shopper && !it.removed && it.need === 0;
    return el('li', { class: 'wl-card' + (done ? ' wl-card--done' : '') }, art(it),
      el('div', { class: 'wl-card__body' },
        it.store ? el('p', { class: 'wl-card__store' }, storeName(it.store)) : null,
        el('h2', { class: 'sdc-subhead wl-card__title' }, el('a', { class: 'wl-card__link', href: urlFor({ item: it.id }), 'data-nav': true }, it.title)),
        meta.length ? el('p', { class: 'wl-card__meta' }, meta) : null,
        tags.length ? el('p', { class: 'wl-tags' }, tags) : null));
  }

  // ------------------------------------------------------------ one item's own page

  function drawItem(root) {
    const it = itemById(S.itemId);
    if (!it) {
      root.append(navLink(urlFor({ list: me().id }), '← Back to my list', false, { class: 'wl-back' }),
        pageH('This is no longer on the list'),
        el('p', { class: 'wl-sub' }, 'It may have been taken off, or already given.'));
      return 'Not on the list';
    }
    const owner = person(it.ownerId);
    const shopper = !hides(it.rel);
    const back = navLink(urlFor({ list: it.ownerId }), `← Back to ${owner.rel === 'own' ? 'my list' : possessive(owner.name) + ' list'}`, false, { class: 'wl-back' });

    if (S.form && S.form.kind === 'edit' && S.form.id === it.id) {
      root.append(back, el('div', { class: 'wl-panel' }, itemForm()));
      return `Edit ${it.title}`;
    }

    const body = el('div', { class: 'wl-detail__body' },
      it.store ? el('p', { class: 'wl-card__store' }, storeName(it.store)) : null,
      pageH(it.title));
    if (it.priceCents !== null && it.priceCents !== undefined) body.append(el('p', { class: 'wl-detail__price' }, money(it.priceCents)));
    if (it.qty > 1) body.append(el('p', null, shopper ? `Wants ${it.qty}. ${it.need} still needed.` : `You want ${it.qty}.`));
    if (it.note) body.append(el('p', { class: 'wl-detail__note' }, it.note));
    const tags = statusTags(it, owner, true);
    if (tags.length) body.append(el('p', { class: 'wl-detail__tags' }, tags));
    if (shopper) {
      for (const b of it.buys) {
        body.append(el('p', { class: 'wl-detail__fact' }, `${b.mine ? 'You' : b.buyer} marked ${b.qty > 1 ? b.qty : 'it'} bought on ${day(b.at)}.`));
      }
      if (it.chips.length) body.append(chipBox(it, owner));
    }
    body.append(S.panel ? itemPanel(it, owner) : itemActions(it, owner, shopper));
    // The photo only when there is one: without it, a big box would just repeat the name.
    const photo = imgSrc(it.image);
    root.append(back, el('article', { class: 'wl-detail' + (photo ? '' : ' wl-detail--text'), 'aria-labelledby': 'pageH' }, photo ? art(it) : null, body));
    return it.title;
  }

  function itemActions(it, owner, shopper) {
    const href = safeHref(it.url);
    const out = [];
    const open = (kind, from) => () => openLayer(kind, () => { S.panel = kind; S.focus = `#p-${kind}`; }, from);
    const ext = (label, primary) => el('a', { class: 'sdc-btn' + (primary ? ' sdc-btn--primary' : ''), href, target: '_blank', rel: 'noopener noreferrer' },
      label, el('span', { class: 'sdc-u-sr-only' }, ' (opens in a new tab)'));
    if (shopper) {
      const mine = it.buys.find(b => b.mine);
      if (href && !it.removed && it.need > 0) {
        out.push(ext(shopLabel('Buy it', it.store), !mine));
        out.push(el('p', { class: 'wl-hint' }, 'The store opens in a new tab. After you buy it, come back here and tap I bought this.'));
      }
      if (!it.removed && it.need > 0) {
        out.push(btn(mine ? 'I bought more' : 'I bought this', it.need === 1 && !mine ? () => buy(it, 1) : open('buy', '#buyBtn'), !href && !mine, { id: 'buyBtn' }));
      }
      if (mine) {
        out.push(btn('It has been given', open('given', '#givenBtn'), false, { id: 'givenBtn' }));
        out.push(btn('Undo, I did not buy it', () => change({ op: 'unbuy', buyId: mine.id }, 'Undone. It is back to not bought.').then(ok => { if (ok) { S.focus = '#pageH'; draw(); } })));
      }
      if (!it.removed && it.need > 0) {
        out.push(btn(it.chips.some(c => c.mine) ? 'Change my amount' : 'Go in together', () => openLayer('chip', () => {
          const mineChip = it.chips.find(c => c.mine);
          S.panel = 'chip';
          S.chip = { value: mineChip ? String(mineChip.cents / 100) : '', error: null };
          S.focus = '#p-chip';
        }, '#chipBtn'), false, { id: 'chipBtn' }));
      }
    } else if (href) {
      out.push(ext(shopLabel('See it', it.store)));
    }
    if (it.canEdit && !it.removed) {
      out.push(btn('Edit', () => openEdit(it), false, { id: 'editBtn' }));
      out.push(btn(it.secret ? 'Remove this idea' : it.rel === 'own' ? 'Remove from my list' : `Remove from ${possessive(owner.name)} list`, open('remove', '#removeBtn'), false, { id: 'removeBtn' }));
    }
    return el('div', { class: 'wl-stack' }, out);
  }

  function itemPanel(it, owner) {
    // An owner's copy of an item carries no purchase data at all, so it.buys can be missing.
    const mine = (it.buys || []).find(b => b.mine);
    if (S.panel === 'remove') {
      const q = it.secret ? 'Remove this idea?' : it.rel === 'own' ? 'Take this off your list?' : `Take this off ${possessive(owner.name)} list?`;
      return el('div', { class: 'wl-confirm', role: 'group', 'aria-labelledby': 'p-q' },
        el('p', { class: 'sdc-subhead', id: 'p-q' }, q),
        btn('Yes, remove it', async () => {
          const ok = await change({ op: 'removeItem', id: it.id });
          if (ok) { go(urlFor({ list: it.ownerId }), true); say('Removed.', 'success'); }
        }, true, { id: 'p-remove' }),
        btn('No, keep it', closeLayer));
    }
    if (S.panel === 'given' && mine) {
      // A gift marked given leaves everyone's list, the owner's too, so ask first.
      return el('div', { class: 'wl-confirm', role: 'group', 'aria-labelledby': 'p-q' },
        el('p', { class: 'sdc-subhead', id: 'p-q' }, `Has ${owner.name} opened it?`),
        el('p', null, `Once it is given, it comes off the list for everyone, ${owner.name} too.`),
        btn('Yes, it has been given', async () => {
          const ok = await change({ op: 'given', buyId: mine.id });
          if (ok) { go(urlFor({ list: it.ownerId }), true); say('Marked given. It is off the list now. You can still find it in My shopping.', 'success'); }
        }, true, { id: 'p-given' }),
        btn('Not yet', closeLayer));
    }
    if (S.panel === 'buy') {
      const opts = Array.from({ length: Math.max(1, it.need) }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
      return el('form', { class: 'wl-confirm', novalidate: true, onsubmit: e => { e.preventDefault(); buy(it, Number($('p-qty').value) || 1); } },
        selectField({ id: 'p-qty', label: `How many did you buy? ${it.need} still needed.`, options: opts, value: '1' }),
        el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit', id: 'p-buy' }, 'Save, I bought them'),
        btn('Cancel', closeLayer));
    }
    if (S.panel === 'chip') {
      const c = S.chip || (S.chip = { value: '', error: null });
      const had = it.chips.some(x => x.mine);
      return el('form', { class: 'wl-confirm', novalidate: true, onsubmit: async e => {
        e.preventDefault();
        const raw = c.value.replace(/[$,\s]/g, '');
        if (raw && !/^\d+(\.\d{1,2})?$/.test(raw)) { c.error = 'Type an amount in dollars, like 25.'; S.focus = '#p-chip'; draw(); return; }
        c.error = null;
        const off = !raw || Number(raw) === 0;
        const ok = await change({ op: 'chip', itemId: it.id, amount: off ? 0 : raw },
          off ? 'Your amount was taken off.' : 'Saved. Whoever buys it taps I bought this.');
        if (ok) closeLayer();
      } },
      el('p', null, `Say how much you will put toward this. Everyone shopping for ${owner.name} sees the total. ${owner.name} never does. One of you buys it and taps I bought this.`),
      field({ id: 'p-chip', label: 'How much will you put in? (dollars)', value: c.value, error: c.error,
        attrs: { inputmode: 'decimal', autocomplete: 'off', maxlength: 9 }, hint: had ? 'Clear it to take your amount off.' : 'For example 25',
        oninput: e => { c.value = e.target.value; } }),
      el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, 'Save my amount'),
      had ? btn('Take my amount off', async () => {
        const ok = await change({ op: 'chip', itemId: it.id, amount: 0 }, 'Your amount was taken off.');
        if (ok) closeLayer();
      }) : null,
      btn('Cancel', closeLayer));
    }
    return el('div');
  }

  function chipBox(it, owner) {
    const total = it.chips.reduce((n, c) => n + c.cents, 0);
    const of = it.priceCents ? it.priceCents * Math.max(1, it.need || 1) : null;
    const pct = of ? Math.min(100, Math.round((total / of) * 100)) : null;
    return el('div', { class: 'wl-chipin' },
      el('p', { class: 'sdc-subhead' }, 'Going in together'),
      el('p', null, of ? `${money(total)} of ${money(of)} so far` : `${money(total)} so far`),
      pct !== null ? el('div', { class: 'wl-meter', role: 'img', 'aria-label': `${pct} percent pledged` }, el('span', { style: `width:${pct}%` })) : null,
      el('ul', null, it.chips.map(c => el('li', null, `${c.mine ? 'You' : c.person}: ${money(c.cents)}`))));
  }

  async function buy(it, qty) {
    const owner = person(it.ownerId);
    S.returnFocus = S.returnFocus === '#buyBtn' || !S.returnFocus ? '#givenBtn' : S.returnFocus;
    const ok = await change({ op: 'buy', itemId: it.id, qty }, `Saved. ${it.rel === 'parent' ? '' : `${owner.name} will not see this. `}It is in My shopping too.`);
    if (ok) closeLayer();
  }

  // ------------------------------------------------------------ add and edit form

  function openAdd(ownerId) {
    openLayer('add', () => {
      S.panel = null;
      S.form = { kind: 'add', ownerId, values: { url: '', title: '', image: '', price: '', note: '', qty: '1' } };
      S.focus = '#f-title';
    }, '#addBtn');
  }

  function openEdit(it) {
    openLayer('edit', () => {
      S.panel = null;
      S.form = { kind: 'edit', id: it.id, ownerId: it.ownerId, values: {
        url: it.url || '', title: it.title, image: it.image || '', note: it.note || '',
        price: it.priceCents === null || it.priceCents === undefined ? '' : String(it.priceCents / 100),
        qty: String(it.qty || 1) } };
      S.focus = '#f-title';
    }, '#editBtn');
  }

  function targets() {
    // Where an item can go: my list, kids I keep, then a secret idea for anyone else.
    return orderedPeople().map(p => ({ value: p.id,
      label: p.rel === 'own' ? 'My list' : keeps(p.rel) ? `${possessive(p.name)} list (you keep it)` : `Secret idea for ${p.name}` }));
  }

  function itemForm() {
    const f = S.form;
    const v = f.values;
    const owner = person(f.ownerId);
    // What the person typed themselves. Get details from the link never overwrites those.
    const set = k => e => { v[k] = e.target.value; (f.typed ||= {})[k] = true; };
    const isAdd = f.kind === 'add';
    const heading = isAdd ? (keeps(owner.rel) ? `Add to ${owner.rel === 'own' ? 'my list' : possessive(owner.name) + ' list'}` : `Secret idea for ${owner.name}`) : `Edit ${v.title || 'this'}`;
    const src = imgSrc(v.image);
    const more = Boolean(v.note || src || (v.qty && v.qty !== '1') || f.moreOpen);

    return el('form', { class: 'wl-form', novalidate: true, onsubmit: submitItem },
      // Editing is its own screen, so its heading is the page heading.
      isAdd ? el('h2', { class: 'sdc-subhead', id: 'formH' }, heading) : pageH(heading),
      !isAdd || keeps(owner.rel) ? null
        : el('p', { class: 'wl-sub' }, `${owner.name} will never see this. Everyone else shopping for ${owner.name} will.`),
      // Only when something arrived from a store does "where should it go" need asking.
      isAdd && f.arrived ? selectField({ id: 'f-owner', label: 'Add to', options: targets(), value: f.ownerId,
        onchange: e => { f.ownerId = e.target.value; S.personId = e.target.value; history.replaceState(history.state, '', urlFor({ list: f.ownerId }) + location.hash); draw(); } }) : null,
      field({ id: 'f-title', label: 'What is it?', value: v.title, required: true,
        attrs: { maxlength: 200, autocomplete: 'off' }, error: f.error || null,
        hint: 'For example: LEGO Batmobile, or Aunt Suzy\'s cinnamon rolls', oninput: set('title') }),
      field({ id: 'f-url', label: 'Store link (optional)', type: 'url', value: v.url, error: f.urlError || null,
        attrs: { inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' },
        hint: 'Paste a link and the details fill in where the store allows. Leave it empty for something homemade.',
        oninput: set('url'),
        onchange: () => { if (/^\S+\.\S+/.test((v.url || '').trim()) && v.url.trim() !== f.looked) lookup(true); },
        addon: btn('Get details from the link', () => lookup(false), false, { id: 'f-lookup' }) }),
      el('div', { class: 'wl-fields' },
        field({ id: 'f-price', label: 'Price (optional)', value: v.price,
          attrs: { inputmode: 'decimal', autocomplete: 'off', maxlength: 12 }, oninput: set('price') })),
      el('details', { class: 'wl-more', open: more, ontoggle: e => { f.moreOpen = e.target.open; } },
        el('summary', null, 'More details: how many, notes, photo'),
        el('div', { class: 'wl-form' },
          el('div', { class: 'wl-fields' },
            selectField({ id: 'f-qty', label: 'How many', value: v.qty || '1',
              options: Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })), onchange: set('qty') })),
          field({ id: 'f-note', label: 'Notes (optional)', multiline: true, rows: 3, value: v.note,
            attrs: { maxlength: 400 }, hint: 'Size, color, or anything that helps.', oninput: set('note') }),
          el('div', { class: 'sdc-field' },
            el('span', { class: 'sdc-field__label', id: 'f-photo-label' }, 'Photo (optional)'),
            el('div', { class: 'wl-photo' },
              el('div', { class: 'wl-photo__frame' }, src
                ? el('img', { src, alt: 'The photo for this item', referrerpolicy: 'no-referrer' }) : 'No photo'),
              el('input', { class: 'wl-file', type: 'file', id: 'f-file', accept: 'image/*', 'aria-labelledby': 'f-photo-label f-file-btn',
                onchange: e => upload(e.target.files && e.target.files[0]) }),
              el('label', { class: 'sdc-btn', for: 'f-file', id: 'f-file-btn' }, src ? 'Change photo' : 'Choose a photo'),
              src ? btn('Remove photo', () => { v.image = ''; (f.typed ||= {}).image = true; S.focus = '#f-file'; draw(); }) : null),
            el('p', { class: 'sdc-field__hint' }, 'A screenshot works. With no photo, the name shows instead.')))),
      el('div', { class: 'wl-actions' },
        el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit', id: 'f-save' },
          isAdd ? (keeps(owner.rel) ? 'Add to the list' : 'Add the secret idea') : 'Save changes'),
        btn('Cancel', closeLayer)));
  }

  // The same check the server makes, so a bad link is flagged under its own field.
  function linkProblem(raw) {
    let x = (raw || '').trim();
    if (!x) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(x)) x = 'https://' + x;
    try { const u = new URL(x); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw 0; return null; }
    catch (e) { return 'That link does not look right. Copy the whole address from the store, starting with https.'; }
  }

  async function submitItem(e) {
    e.preventDefault();
    const f = S.form;
    const v = f.values;
    // A link pasted into "What is it?" belongs in Store link; move it there and look it up.
    if (/^(https?:\/\/|www\.)\S+$/i.test(v.title.trim()) && !v.url.trim()) {
      v.url = v.title.trim();
      v.title = '';
      if (f.typed) f.typed.title = false;
      f.error = 'That was a link, so it moved to Store link. Now say what it is.';
      S.focus = '#f-title';
      draw();
      lookup(true);
      return;
    }
    f.error = v.title.trim() ? null : 'Say what it is.';
    f.urlError = linkProblem(v.url);
    if (f.error || f.urlError) { S.focus = f.error ? '#f-title' : '#f-url'; draw(); return; }
    $('f-save').disabled = true;
    const owner = person(f.ownerId);
    const body = { url: v.url, title: v.title, image: v.image, price: v.price, note: v.note, qty: v.qty };
    const text = f.kind === 'edit' ? 'Saved.'
      : owner.rel === 'own' ? 'Added to your list.'
      : keeps(owner.rel) ? `Added to ${possessive(owner.name)} list.`
      : `Added as a secret idea for ${owner.name}.`;
    if (f.kind === 'add' && !S.returnFocus) S.returnFocus = '#addBtn';
    const ok = await change(f.kind === 'add' ? { op: 'addItem', ownerId: f.ownerId, ...body } : { op: 'editItem', id: f.id, ...body },
      text, () => { S.personId = owner.id; });
    if (ok) closeLayer();
    else if ($('f-save')) $('f-save').disabled = false;
  }

  async function lookup(auto) {
    const f = S.form;
    if (!f) return;
    const url = (f.values.url || '').trim();
    if (!url) { if (!auto) { say('Paste a store link first.', 'error'); S.focus = '#f-url'; draw(); } return; }
    f.looked = url;
    say('Looking up that link…');
    const b = $('f-lookup');
    if (b) b.disabled = true;
    const r = await api('/lookup', { url });
    if (!S.form) return;
    if (r.ok && r.data.ok) {
      const v = S.form.values;
      const typed = S.form.typed || {};
      // Clicking the button: the store's details win over anything filled in for you, never
      // over what you typed. Pasting a link: only empty fields are filled.
      const take = (k, val) => { if (val && !typed[k] && (!auto || !v[k])) v[k] = val; };
      v.url = r.data.url || v.url;
      S.form.looked = v.url;
      take('title', r.data.title);
      take('image', /^https:\/\//.test(r.data.image || '') ? r.data.image : '');
      take('price', r.data.price);
      if (v.title) S.form.error = null;
      say('Filled in what the store shares. Check it, then add it.', 'success');
    } else {
      // The store said no, but the name was read from the link itself.
      const g = r.data && r.data.guess;
      const v = S.form.values, typed = S.form.typed || {};
      if (g && g.title && !typed.title && (!auto || !v.title)) { v.title = g.title; S.form.error = null; }
      say(r.data.message || 'That link could not be read. Type the details in.', g && g.title ? 'success' : 'warning');
    }
    S.focus = '#f-title';
    draw();
  }

  // Shrink a photo to 900px on the phone before sending it, so uploads are quick.
  async function upload(file) {
    if (!file || !S.form) return;
    if (!/^image\//.test(file.type || 'image/')) { say('That file is not a photo.', 'error'); return; }
    say('Adding the photo…');
    let dataUrl;
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = URL.createObjectURL(file);
      });
      const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--sdc-paper-white').trim() || 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) { say('That photo could not be read. Try a different one.', 'error'); return; }
    const r = await api('/photo', { data: dataUrl });
    if (!S.form) return;
    if (!r.ok) { say(r.data.message || 'The photo could not be saved.', 'error'); return; }
    S.form.values.image = r.data.image;
    (S.form.typed ||= {}).image = true;
    say('Photo added.', 'success');
    S.focus = '#f-file';
    draw();
  }

  // ------------------------------------------------------------ My shopping

  function drawShopping(root) {
    const { buys, chips } = S.data.shopping;
    const open = buys.filter(b => !b.given);
    const given = buys.filter(b => b.given);
    const spend = open.reduce((n, b) => n + (b.priceCents || 0) * b.qty, 0) + chips.reduce((n, c) => n + c.cents, 0);
    const people = new Set([...open.map(b => b.ownerId), ...chips.map(c => c.ownerId)]);
    root.append(el('header', { class: 'wl-listhead' }, el('div', null, pageH('My shopping'),
      el('p', { class: 'wl-sub' }, 'Everything you bought, or are going in together on. Tap one to open it. After a gift is opened, tap It has been given on its page. Anything still marked bought counts as given on December 26.'))));
    if (!buys.length && !chips.length) {
      root.append(el('div', { class: 'wl-empty' }, el('p', null, 'Nothing yet. When you tap I bought this on someone\'s list, it shows up here.')));
      return 'My shopping';
    }
    if (open.length || chips.length) {
      root.append(el('p', null, el('span', { class: 'wl-total' }, money(spend) || '$0'),
        ` for ${people.size} ${people.size === 1 ? 'person' : 'people'}, counting the prices that are known.`));
    }
    const byOwner = new Map();
    for (const b of open) { if (!byOwner.has(b.ownerId)) byOwner.set(b.ownerId, []); byOwner.get(b.ownerId).push(b); }
    for (const [ownerId, list] of byOwner) {
      const p = person(ownerId);
      root.append(el('section', { class: 'wl-group' }, el('h2', { class: 'sdc-subhead' }, `For ${p ? p.name : list[0].ownerName || 'someone'}`),
        el('ul', { class: 'wl-rows' }, list.map(shopRow))));
    }
    if (chips.length) {
      root.append(el('section', { class: 'wl-group' }, el('h2', { class: 'sdc-subhead' }, 'Going in together'),
        el('ul', { class: 'wl-rows' }, chips.map(c => {
          const p = person(c.ownerId);
          const what = `${money(c.cents)} toward ${c.title}`;
          return el('li', { class: 'wl-row wl-row--plain' }, el('div', { class: 'wl-row__body' },
            el('p', null, c.hidden ? what : el('a', { class: 'wl-row__link', href: urlFor({ item: c.itemId }), 'data-nav': true }, what)),
            el('p', { class: 'wl-row__meta' }, `For ${p ? p.name : c.ownerName || 'someone'}. You said so on ${day(c.at)}.`)));
        }))));
    }
    if (given.length) {
      root.append(el('section', { class: 'wl-group' }, el('h2', { class: 'sdc-subhead' }, 'Given'),
        el('ul', { class: 'wl-rows' }, given.map(shopRow))));
    }
    return 'My shopping';
  }

  function shopRow(b) {
    const p = person(b.ownerId) || (b.ownerName ? { name: b.ownerName } : null);
    const bits = [];
    if (b.given && p) bits.push(`For ${p.name}`);
    bits.push(b.given ? `Given ${day(b.givenAt)}` : `Bought ${day(b.at)}`);
    if (b.priceCents) bits.push(money(b.priceCents));
    if (b.qty > 1) bits.push(`${b.qty} of them`);
    const tags = [];
    if (b.removed && !b.given) tags.push(tag('stop', `${p ? p.name : 'They'} took this off the list`));
    if (b.changed && !b.given) tags.push(tag('warn', 'Changed after you bought it'));
    // A gift already given has left the list, so it has no page to open. Neither does one
    // whose list is no longer shared with you; you can still mark it given here.
    if (b.hidden && !b.given) tags.push(tag('idea', `${p ? p.name : 'They'} no longer shares this list with you`));
    const title = b.given || b.hidden ? el('p', { class: 'sdc-subhead' }, b.title)
      : el('p', { class: 'sdc-subhead' }, el('a', { class: 'wl-row__link', href: urlFor({ item: b.itemId }), 'data-nav': true }, b.title));
    return el('li', { class: 'wl-row' }, art(b),
      el('div', { class: 'wl-row__body' }, title, el('p', { class: 'wl-row__meta' }, bits.join(' · ')),
        tags.length ? el('p', { class: 'wl-tags' }, tags) : null,
        b.hidden && !b.given ? el('div', { class: 'wl-actions' }, btn('It has been given', async () => {
          const ok = await change({ op: 'given', buyId: b.id }, 'Marked given.'); if (ok) { S.focus = '#pageH'; draw(); } })) : null,
        b.given && b.manual ? el('div', { class: 'wl-actions' }, btn('Not given yet', async () => { const ok = await change({ op: 'ungiven', buyId: b.id }, 'Back to bought.'); if (ok) { S.focus = '#pageH'; draw(); } })) : null));
  }

  // ------------------------------------------------------------ People (the admin only)

  function drawPeople(root) {
    const people = [...S.data.people].sort((a, b) => a.name.localeCompare(b.name));
    const adults = people.filter(p => p.email);
    root.append(el('header', { class: 'wl-listhead' },
      el('div', null, pageH('People'),
        el('p', { class: 'wl-sub' }, 'Only you see this page. Only people here with an email can sign in. A kid has no email; the parents you pick keep the kid\'s list. Parents can also add lists for their own kids, from their list.')),
      S.personForm && !S.personForm.id ? null : btn('Add a person', () => openLayer('person', () => {
        S.personPanel = null;
        S.personForm = { values: { name: '', email: '', admin: false, managers: [], parentsSee: false } };
        S.focus = '#pf-name';
      }, '#addPersonBtn'), true, { id: 'addPersonBtn' })));
    if (S.personForm && !S.personForm.id) root.append(el('div', { class: 'wl-panel' }, personForm(adults)));
    // Asking to join, from the sign-in page. Add opens the person form with their name and email.
    const reqs = S.data.requests || [];
    if (reqs.length && !S.personForm) {
      root.append(el('section', { class: 'wl-group', 'aria-labelledby': 'reqH' },
        el('h2', { class: 'sdc-subhead', id: 'reqH' }, `Asking to join (${reqs.length})`),
        el('ul', { class: 'wl-rows' }, reqs.map(r => el('li', { class: 'wl-row wl-row--plain' }, el('div', { class: 'wl-row__body' },
          el('p', { class: 'sdc-subhead' }, r.name),
          el('p', { class: 'wl-row__meta' }, `${r.email} · asked ${day(r.at)}`),
          r.note ? el('p', null, `"${r.note}"`) : null,
          el('div', { class: 'wl-actions' },
            btn(`Add ${r.name}`, () => openLayer('person', () => {
              S.personPanel = null;
              S.personForm = { values: { name: r.name, email: r.email, admin: false, managers: [], parentsSee: false } };
              S.focus = '#pf-name';
            }, '#addPersonBtn'), true, { id: `ra-${r.id}` }),
            linkBtn('Decline', () => change({ op: 'dismissRequest', id: r.id }, `Declined. Nothing is sent to ${r.name}.`), { id: `rd-${r.id}` }))))))));
    }

    root.append(el('ul', { class: 'wl-rows' }, people.map(p => {
      if (S.personForm && S.personForm.id === p.id) return el('li', { class: 'wl-row wl-row--plain' }, personForm(adults));
      const meta = p.email ? p.email
        : `Kid. Kept by ${(p.keptBy || []).join(' and ') || 'nobody yet, pick a parent'}.${p.addedBy ? ` Added by ${p.addedBy}.` : ''}`;
      const tags = [];
      if (p.admin) tags.push(tag('idea', 'Can add and remove people'));
      if (p.kid) tags.push(tag(p.parentsSee ? 'done' : 'idea', p.parentsSee ? 'Parents see purchases' : 'Purchases hidden from parents'));
      if (Array.isArray(p.audience)) {
        const n = p.audience.length;
        tags.push(tag('idea', n ? `Shared with ${n} ${n === 1 ? 'person' : 'people'}` : 'Shared with no one else'));
      }
      const panel = S.personPanel && S.personPanel.id === p.id ? S.personPanel.kind : null;
      const isMe = p.id === me().id;
      const cancel = closeLayer;
      return el('li', { class: 'wl-row wl-row--plain' }, el('div', { class: 'wl-row__body' },
        el('p', { class: 'sdc-subhead' }, p.name, isMe ? ' (you)' : ''),
        el('p', { class: 'wl-row__meta' }, meta),
        tags.length ? el('p', { class: 'wl-tags' }, tags) : null,
        panel === 'remove' ? el('div', { class: 'wl-confirm' },
          el('p', null, `Remove ${p.name}? Their list, the ideas for them, and anything they marked bought on other lists all go. This cannot be undone.`),
          btn(`Yes, remove ${p.name}`, async () => { S.returnFocus = '#addPersonBtn'; if (await change({ op: 'removePerson', id: p.id }, `${p.name} was removed.`)) closeLayer(); }, true, { id: 'pp-remove' }),
          btn('No, keep them', cancel))
        : panel === 'signout' ? el('div', { class: 'wl-confirm' },
          el('p', null, `Sign ${p.name} out on every phone and computer? They can sign back in with their email.`),
          btn('Yes, sign them out', async () => { if (await change({ op: 'signOutPerson', id: p.id }, `${p.name} is signed out everywhere.`)) closeLayer(); }, true, { id: 'pp-signout' }),
          btn('Cancel', cancel))
        : el('div', { class: 'wl-actions wl-actions--links' },
          linkBtn('Edit', () => openLayer('person', () => {
            S.personPanel = null;
            S.personForm = { id: p.id, values: { name: p.name, email: p.email || '', admin: p.admin, managers: [...(p.managers || [])], parentsSee: p.parentsSee } };
            S.focus = '#pf-name';
          }, `#pe-${p.id}`), { id: `pe-${p.id}` }),
          p.email ? linkBtn('Sign out everywhere', () => openLayer('signout', () => { S.personPanel = { id: p.id, kind: 'signout' }; S.focus = '#pp-signout'; }, `#ps-${p.id}`), { id: `ps-${p.id}` }) : null,
          isMe ? null : linkBtn('Remove', () => openLayer('remove', () => { S.personPanel = { id: p.id, kind: 'remove' }; S.focus = '#pp-remove'; }, `#pr-${p.id}`), { id: `pr-${p.id}` }))));
    })));
    root.append(siteNamePanel(), shortcutPanel());
    return 'People';
  }

  // The names of this wish list: the full one on the sign-in page and in emails, the short
  // one in the bar at the top. Empty goes back to the default.
  function siteNamePanel() {
    const cur = S.data.settings || {};
    const f = S.siteName || (S.siteName = { title: cur.title || '', shortTitle: cur.shortTitle || '' });
    return el('form', { class: 'wl-panel wl-panel--quiet wl-form', novalidate: true, 'aria-labelledby': 'siteNameH', onsubmit: async e => {
      e.preventDefault();
      const ok = await change({ op: 'saveSettings', title: f.title, shortTitle: f.shortTitle }, 'Saved. The new names show on every page and in emails.');
      if (ok) { S.siteName = null; S.focus = '#f-sitetitle'; draw(); }
    } },
    el('h2', { class: 'sdc-subhead', id: 'siteNameH' }, 'Name of this wish list'),
    el('div', { class: 'wl-fields' },
      field({ id: 'f-sitetitle', label: 'Full name', value: f.title, attrs: { maxlength: 80, autocomplete: 'off' },
        hint: 'On the sign-in page and in emails, like Smith Family and Friends Wish List.', oninput: e => { f.title = e.target.value; } }),
      field({ id: 'f-siteshort', label: 'Short name', value: f.shortTitle, attrs: { maxlength: 40, autocomplete: 'off' },
        hint: 'In the bar at the top, like Smith Wish List.', oninput: e => { f.shortTitle = e.target.value; } })),
    el('div', { class: 'wl-actions' }, el('button', { class: 'sdc-btn', type: 'submit' }, 'Save names')));
  }

  // The iPhone shortcut's iCloud link: the admin builds the shortcut once and pastes the link here,
  // and every iPhone then gets a one-tap Get the iPhone shortcut button instead of the build steps.
  function shortcutPanel() {
    const current = (S.data.settings && S.data.settings.shortcutLink) || '';
    const f = S.shortcut || (S.shortcut = { value: current, error: null });
    return el('form', { class: 'wl-panel wl-panel--quiet wl-form', novalidate: true, onsubmit: async e => {
      e.preventDefault();
      const ok = await change({ op: 'saveSettings', shortcutLink: f.value }, f.value.trim()
        ? 'Saved. Every iPhone now gets the one-tap shortcut button.' : 'The shortcut link was cleared.');
      if (ok) { S.shortcut = null; S.focus = '#f-shortcut'; draw(); }
      else { f.error = 'That is not an iCloud shortcut link. In Shortcuts, touch and hold the shortcut, tap Share, then Copy iCloud Link.'; S.focus = '#f-shortcut'; draw(); }
    } },
    el('h2', { class: 'sdc-subhead' }, 'iPhone shortcut'),
    el('p', null, current
      ? 'Shared. iPhones see a Get the iPhone shortcut button.'
      : 'Build the shortcut once on your iPhone (the steps are on your list, under Add things from any store), then paste its iCloud link here.'),
    field({ id: 'f-shortcut', label: 'iCloud link for Add to Wish List', type: 'url', value: f.value, error: f.error,
      attrs: { inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' },
      hint: 'In Shortcuts: touch and hold the shortcut, tap Share, then Copy iCloud Link.',
      oninput: e => { f.value = e.target.value; f.error = null; } }),
    el('div', { class: 'wl-actions' }, el('button', { class: 'sdc-btn', type: 'submit' }, 'Save link')));
  }

  function personForm(adults) {
    const f = S.personForm;
    const v = f.values;
    const isMe = f.id === me().id;
    const parents = adults.filter(p => p.id !== f.id);
    return el('form', { class: 'wl-form', novalidate: true, onsubmit: async e => {
      e.preventDefault();
      const name = v.name.trim();
      f.nameError = name ? null : 'Enter a name.';
      if (f.nameError) { S.focus = '#pf-name'; draw(); return; }
      const ok = await change({ op: 'savePerson', id: f.id, name, email: v.email, admin: v.admin, managers: v.managers, parentsSee: v.parentsSee },
        f.id ? 'Saved.' : `${name} was added.${v.email ? ' They can sign in with that email now.' : ''}`,
      );
      if (ok) closeLayer();
    } },
    el('h2', { class: 'sdc-subhead' }, f.id ? `Edit ${v.name}` : 'Add a person'),
    el('div', { class: 'wl-fields' },
      field({ id: 'pf-name', label: 'Name', value: v.name, required: true, error: f.nameError || null, attrs: { maxlength: 40, autocomplete: 'off' },
        hint: 'The name everyone sees, like Grandma or Aunt Suzy.', oninput: e => { v.name = e.target.value; } }),
      field({ id: 'pf-email', label: 'Email', type: 'email', value: v.email,
        attrs: { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email', disabled: isMe ? true : null },
        hint: isMe ? 'Your own email cannot be changed here.' : 'Leave it empty for a kid who has no email.',
        oninput: e => { v.email = e.target.value; } })),
    el('fieldset', { class: 'sdc-fieldset' },
      el('legend', null, 'For a kid: the parents who keep this list'),
      parents.length ? el('div', { class: 'sdc-choice-set' }, parents.map(p => choice({
        name: 'pf-managers', value: p.id, label: p.name, radio: false, checked: v.managers.includes(p.id),
        onchange: e => { v.managers = e.target.checked ? [...v.managers, p.id] : v.managers.filter(id => id !== p.id); }
      }))) : el('p', { class: 'sdc-fieldset__desc' }, 'Add the parents first.'),
      el('div', { class: 'sdc-choice-set' }, choice({ name: 'pf-see', value: 'see', radio: false, checked: v.parentsSee,
        label: 'Parents can see what was bought', onchange: e => { v.parentsSee = e.target.checked; } })),
      el('p', { class: 'sdc-fieldset__desc' }, 'Only used when there is no email. Turn it on if the parents shop for the kid too, so they do not buy the same thing.')),
    isMe ? null : el('div', { class: 'sdc-choice-set' }, choice({ name: 'pf-admin', value: 'admin', radio: false, checked: v.admin,
      label: 'Can add and remove people', onchange: e => { v.admin = e.target.checked; } })),
    el('div', { class: 'wl-actions' },
      el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit' }, f.id ? 'Save' : 'Add person'),
      btn('Cancel', closeLayer)));
  }

  // ------------------------------------------------------------ the Add button: computer, iPhone, Android

  // Runs on a store's page in the person's own browser and reads what that page already
  // shows them. It sends nothing anywhere; it opens this page with the details filled in.
  function grabber(finish) {
    return '(function(){var d=document,B=' + JSON.stringify(ORIGIN) + ';' +
      'if(location.origin===B){alert("Open a store\'s product page first, then click Add to Wish List.");return}' +
      'function m(n){var e=d.querySelector(\'meta[property="\'+n+\'"],meta[name="\'+n+\'"]\');return e?e.getAttribute("content")||"":""}' +
      'function q(s,a){var e=d.querySelector(s);return e?((a?e.getAttribute(a):e.textContent)||"").trim():""}' +
      'var p={};try{[].forEach.call(d.querySelectorAll(\'script[type="application/ld+json"]\'),function(s){try{var j=JSON.parse(s.textContent);[].concat(j["@graph"]||j).forEach(function(o){if(!p.name&&o&&/Product/.test([].concat(o["@type"]).join(" ")))p=o})}catch(e){}})}catch(e){}' +
      'var o=[].concat(p.offers||[])[0]||{},g=[].concat(p.image||[])[0]||"";if(g&&g.url)g=g.url;' +
      'var u=q(\'link[rel="canonical"]\',"href");try{u=u?new URL(u,location.href).href:location.href}catch(e){u=location.href}' +
      'var t=m("og:title")||p.name||q("#productTitle")||q("#title")||d.title||"";' +
      'var i=m("og:image")||g||q("#landingImage","data-old-hires")||q("#landingImage","src")||q("#main-image","src")||q("#imgBlkFront","src")||"";' +
      'if(!i){var a=0;[].forEach.call(d.images,function(e){var s=e.naturalWidth*e.naturalHeight,b=e.getBoundingClientRect();if(e.naturalWidth>=200&&s>a&&b.top<innerHeight*1.5&&b.width>0){a=s;i=e.currentSrc||e.src}})}' +
      'var r=m("product:price:amount")||m("og:price:amount")||o.price||o.lowPrice||(o.priceSpecification||{}).price||q(\'[itemprop="price"]\',"content")||q("#corePrice_feature_div .a-offscreen")||q(".a-price .a-offscreen")||q(\'[data-test="product-price"]\')||q(".priceView-customer-price span")||q(\'[itemprop="price"]\')||"";try{i=i?new URL(i,location.href).href:""}catch(e){i=""}' +
      'var x=B+"/lists?add=1&u="+encodeURIComponent(u)+"&t="+encodeURIComponent(String(t).trim().slice(0,200))+"&i="+encodeURIComponent(String(i).slice(0,1500))+"&p="+encodeURIComponent(String(r).trim().slice(0,20));' +
      finish + '})();';
  }
  const bookmarklet = () => 'javascript:' + encodeURIComponent(grabber('var w=window.open(x,"_blank");if(!w)location.href=x;'));
  const shortcutScript = () => grabber('completion(x);');

  // The steps for one kind of device. Setup shows only the one in the person's hand.
  function deviceSteps(kind, idPrefix) {
    if (kind === 'computer') {
      return el('ol', null,
        el('li', null, 'Show your bookmarks bar. Chrome: press Command Shift B. Safari: View, then Show Favorites Bar.'),
        el('li', null, 'Drag this button onto the bar: ',
          el('a', { class: 'sdc-btn wl-bookmarklet', href: bookmarklet(), onclick: e => { e.preventDefault(); say('Drag the button to your bookmarks bar instead of clicking it.', 'warning'); } }, 'Add to Wish List')),
        el('li', null, 'Go to a product on any store\'s website and click Add to Wish List in the bar.'));
    }
    if (kind === 'iphone') return iphoneSteps(idPrefix);
    return el('ol', null,
      el('li', null, 'Open this page in Chrome.'),
      el('li', null, 'Tap the ⋮ menu, then Add to Home screen (it may say Install app). Tap Install.'),
      el('li', null, 'In any store app or website, tap Share and choose Wish List.'));
  }

  // iPhone and iPad. Checked against Apple's Shortcuts guide (2026-10-29): Run JavaScript on
  // Web Page only runs from Safari's Share menu, needs Show in Share Sheet with Safari web pages
  // as the input, and needs Allow Running Scripts turned on in the Shortcuts settings.
  const SCRIPTS_STEP = 'Open the Settings app. Tap Apps (newer iPhones only), then Shortcuts, then Advanced. Turn on Allow Running Scripts.';
  const USE_STEP = 'To add something: in Safari, open the product, tap the Share button, then tap Add to Wish List. The first time, tap Allow.';
  function iphoneSteps(idPrefix) {
    const link = S.data && S.data.settings && S.data.settings.shortcutLink;
    const amazon = el('p', null, 'Shopping in the Amazon app? Tap Share, then Open in Browser (or copy the link and open it in Safari), then use the shortcut.');
    if (link) {
      // The admin built it once and shared it: everyone else just adds it.
      return el('div', null,
        el('ol', null,
          el('li', null, 'Tap this button, then tap Add Shortcut. ',
            el('a', { class: 'sdc-btn sdc-btn--primary', href: link, target: '_blank', rel: 'noopener' }, 'Get the iPhone shortcut',
              el('span', { class: 'sdc-u-sr-only' }, ' (opens the Shortcuts app)'))),
          el('li', null, SCRIPTS_STEP),
          el('li', null, USE_STEP)),
        amazon);
    }
    // No shared shortcut yet: build it once, about five minutes.
    const script = el('textarea', { class: 'sdc-field__input wl-script', id: `${idPrefix}-script`, rows: 3, readonly: true, 'aria-label': 'Script for the iPhone shortcut' });
    script.value = shortcutScript();
    const copy = btn('Copy the script', async () => {
      try { await navigator.clipboard.writeText(script.value); say('Copied. Now open the Shortcuts app.', 'success'); }
      catch (e) { script.select(); say('Tap and hold the script, choose Select All, then Copy.', 'warning'); }
    });
    return el('div', null,
      el('p', null, 'Do this on the iPhone itself. It takes about five minutes, once.'),
      el('ol', null,
        el('li', null, 'Tap Copy the script. ', el('div', { class: 'wl-actions' }, copy), script),
        el('li', null, 'Open the Shortcuts app and tap the + at the top right.'),
        el('li', null, 'In the search box at the bottom, type Run JavaScript. Tap Run JavaScript on Web Page.'),
        el('li', null, 'Tap inside the code in that box. Tap and hold, choose Select All, then tap Paste.'),
        el('li', null, 'In the search box again, type Open URLs and tap it. It fills in JavaScript Result by itself.'),
        el('li', null, 'Tap the name at the top, choose Rename, and type Add to Wish List.'),
        el('li', null, 'Tap the ⓘ button at the bottom (on some iPhones it is under the name at the top, called Details). Turn on Show in Share Sheet, then tap Done.'),
        el('li', null, 'A Receive line now shows at the top. Tap its blue words, leave only Safari web pages checked, and tap Done. Then tap Done again to save.'),
        el('li', null, SCRIPTS_STEP),
        el('li', null, USE_STEP)),
      amazon,
      me().admin ? el('p', null, 'Then share it with the family: in Shortcuts, touch and hold Add to Wish List, tap Share, then Copy iCloud Link. Paste it on the People page, and everyone gets a one-tap button instead of these steps.') : null);
  }

  function thisDevice() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iphone';
    if (/Android/.test(ua)) return 'android';
    return 'computer';
  }
  const DEVICE_NAMES = { computer: 'On a computer (Chrome or Safari)', iphone: 'On an iPhone or iPad', android: 'On an Android phone' };

  function helpPanel() {
    return el('section', { class: 'wl-panel wl-help', 'aria-labelledby': 'helpH' },
      el('h2', { class: 'sdc-subhead', id: 'helpH' }, 'Add things from any store'),
      el('p', null, 'Set this up once on each phone or computer. Then, on any product page, one tap brings its name, photo and price here.'),
      ['computer', 'iphone', 'android'].map(kind =>
        el('details', null, el('summary', null, DEVICE_NAMES[kind]), deviceSteps(kind, 'help-' + kind))));
  }

  // ------------------------------------------------------------ first-run setup
  // Like the analytics dashboard's setup: one question per screen, every answer saved as
  // you go, so closing the window or switching devices picks up where you left off.

  const needsSetup = () => !(me().setup && (me().setup.doneAt || me().setup.skippedAt));
  function setupSteps() {
    const steps = ['welcome', 'sizes', 'likes', 'avoid', 'first', 'kids', 'device'];
    if (me().admin) steps.push('family');
    steps.push('done');
    return steps;
  }

  // The About me card is built from the answers, one labeled line each, so the answers
  // survive in the card itself and come back if setup is opened again.
  const ABOUT = [['shirt', 'Shirt'], ['pants', 'Pants'], ['shoe', 'Shoe'], ['colors', 'Favorite colors'], ['loves', 'Loves'], ['avoid', 'Please avoid']];
  function readAnswers() {
    const a = { extra: [] };
    for (const line of (me().about || '').split('\n')) {
      const hit = ABOUT.find(([, label]) => line.startsWith(label + ': '));
      if (hit) a[hit[0]] = line.slice(hit[1].length + 2);
      else if (line.trim()) a.extra.push(line);
    }
    return a;
  }
  const composeAbout = a => [...ABOUT.filter(([k]) => (a[k] || '').trim()).map(([k, label]) => `${label}: ${a[k].trim()}`), ...a.extra]
    .join('\n').slice(0, 600);

  async function setupMove(delta) {
    const steps = setupSteps();
    const key = steps[S.setupIdx];
    // Typed something and tapped Next instead of Add? Save it rather than lose it.
    const val = id => ($(id) ? $(id).value.trim() : '');
    if (delta > 0 && key === 'first' && val('s-title')) {
      const t = { title: val('s-title'), url: val('s-url'), price: val('s-price') };
      const ok = await change({ op: 'addItem', ownerId: me().id, ...t, qty: 1 }, `Added ${t.title} to your list.`, () => { S.added.push(t.title); });
      if (!ok) return;
    }
    if (delta > 0 && key === 'kids' && val('s-kid')) {
      const ok = await change({ op: 'saveKid', name: val('s-kid'), managers: [], parentsSee: true }, `${possessive(val('s-kid'))} list is ready.`);
      if (!ok) return;
    }
    if (delta > 0 && key === 'family' && val('f-pname') && val('f-pemail')) {
      const ok = await change({ op: 'savePerson', name: val('f-pname'), email: val('f-pemail') }, `${val('f-pname')} was added.`);
      if (!ok) return;
    }
    if (delta > 0 && ['sizes', 'likes', 'avoid'].includes(key)) {
      const about = composeAbout(S.answers);
      if (about !== (me().about || '')) {
        const ok = await change({ op: 'saveAbout', personId: me().id, about });
        if (!ok) return;
      }
    }
    S.setupIdx = Math.max(0, Math.min(steps.length - 1, S.setupIdx + delta));
    S.focus = '#pageH';
    await change({ op: 'saveSetup', step: S.setupIdx });
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  async function setupFinish(how) {
    const done = how === 'done';
    const ok = await change(done ? { op: 'saveSetup', setup: 'done', tour: 'pending' } : { op: 'saveSetup', setup: 'skipped' });
    if (!ok) return;
    S.answers = null;
    go(urlFor({ list: me().id }), true);
    if (!done) say('Setup skipped. Tap How it works at the top any time for a quick tour.', 'success');
  }

  function drawSetup(root) {
    const steps = setupSteps();
    S.setupIdx = Math.min(S.setupIdx, steps.length - 1);
    const key = steps[S.setupIdx];
    const n = S.setupIdx + 1;
    if (!S.answers) S.answers = readAnswers();
    const a = S.answers;
    const set = k => e => { a[k] = e.target.value; };
    const box = el('section', { class: 'wl-setup', 'aria-labelledby': 'pageH' });
    // box.append is the browser's own, which would print "null"; put() skips empty parts.
    const put = (...kids) => box.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
    put(el('p', { class: 'wl-setup__count' }, `Setup, step ${n} of ${steps.length}`),
      el('div', { class: 'wl-meter', role: 'img', 'aria-label': `Step ${n} of ${steps.length}` },
        el('span', { style: `width:${Math.round((n / steps.length) * 100)}%` })));
    const next = (label = 'Next') => el('button', { class: 'sdc-btn sdc-btn--primary', type: 'submit', id: 'setupNext' }, label);
    const back = n > 1 ? btn('Back', () => setupMove(-1)) : null;
    const skip = key !== 'done' ? el('div', { class: 'wl-setup__skip' }, btn('Skip setup for now', () => setupFinish('skipped'))) : null;
    const form = (body, nextBtn = next()) => el('form', { class: 'wl-form', novalidate: true, onsubmit: e => { e.preventDefault(); setupMove(1); } },
      body, el('div', { class: 'wl-setup__nav' }, back, nextBtn), skip);

    if (key === 'welcome') {
      put(pageH(`Welcome, ${me().name}`),
        el('p', { class: 'wl-setup__lede' }, 'Let us set up your wish list. It takes about two minutes, and you can change anything later.'),
        el('ul', { class: 'wl-setup__points' },
          el('li', null, 'Your family and friends see your list.'),
          el('li', null, 'You never see what anyone buys for you. It stays a surprise.'),
          el('li', null, 'You can shop from everyone else\'s list too.')),
        form(null, next('Start')));
    } else if (key === 'sizes') {
      put(pageH('What sizes do you wear?'),
        el('p', { class: 'wl-setup__lede' }, 'This helps people buy clothes that fit. Leave any of them empty.'),
        form(el('div', { class: 'wl-fields' },
          field({ id: 's-shirt', label: 'Shirt', value: a.shirt, attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'For example M, or 16 33', oninput: set('shirt') }),
          field({ id: 's-pants', label: 'Pants', value: a.pants, attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'For example 34x32', oninput: set('pants') }),
          field({ id: 's-shoe', label: 'Shoe', value: a.shoe, attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'For example 10.5', oninput: set('shoe') }))));
    } else if (key === 'likes') {
      put(pageH('What do you love?'),
        el('p', { class: 'wl-setup__lede' }, 'Helps people pick something you will enjoy.'),
        form(el('div', { class: 'wl-form' },
          field({ id: 's-colors', label: 'Favorite colors', value: a.colors, attrs: { maxlength: 80, autocomplete: 'off' }, oninput: set('colors') }),
          field({ id: 's-loves', label: 'Teams, hobbies and things you collect', value: a.loves, multiline: true, rows: 3,
            attrs: { maxlength: 200 }, hint: 'For example: baseball, camping, board games', oninput: set('loves') }))));
    } else if (key === 'avoid') {
      put(pageH('Anything to avoid?'),
        el('p', { class: 'wl-setup__lede' }, 'Food allergies, gluten free, or things you already have plenty of.'),
        form(field({ id: 's-avoid', label: 'Please avoid', value: a.avoid, multiline: true, rows: 3, attrs: { maxlength: 200 },
          hint: 'For example: gluten, more coffee mugs', oninput: set('avoid') })));
    } else if (key === 'first') {
      const added = S.added;
      const t = { title: '', url: '', price: '' };
      const addOne = async () => {
        if (!t.title.trim()) { say('Type what you would like first.', 'error'); $('s-title').focus(); return; }
        const ok = await change({ op: 'addItem', ownerId: me().id, title: t.title, url: t.url, price: t.price, qty: 1 },
          `Added ${t.title.trim()} to your list.`, () => { added.push(t.title.trim()); });
        if (ok) { S.focus = '#s-title'; draw(); }
      };
      put(pageH('Add one thing you would like'),
        el('p', { class: 'wl-setup__lede' }, 'Just a name is enough, like Grandma\'s cookies. A store link and a price are extras. You can add more and add photos later.'),
        el('form', { class: 'wl-panel wl-form', novalidate: true, onsubmit: e => { e.preventDefault(); addOne(); } },
          field({ id: 's-title', label: 'What would you like?', attrs: { maxlength: 200, autocomplete: 'off' }, oninput: e => { t.title = e.target.value; } }),
          el('div', { class: 'wl-fields' },
            field({ id: 's-url', label: 'Store link (optional)', type: 'url', attrs: { inputmode: 'url', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' },
              hint: 'Paste it from the store', oninput: e => { t.url = e.target.value; } }),
            field({ id: 's-price', label: 'Price (optional)', attrs: { inputmode: 'decimal', autocomplete: 'off', maxlength: 12 },
              hint: 'For example 25', oninput: e => { t.price = e.target.value; } })),
          el('div', { class: 'wl-actions' }, el('button', { class: 'sdc-btn', type: 'submit' }, 'Add it to my list'))),
        added.length ? el('div', null, el('p', { class: 'sdc-subhead' }, 'On your list now'), el('ul', null, added.map(x => el('li', null, x)))) : null,
        form(null, next('Next')));
    } else if (key === 'kids') {
      const mine = keptKids();
      const v = { name: '' };
      const addKid = async () => {
        const name = v.name.trim();
        if (!name) { say('Type your child\'s name first.', 'error'); $('s-kid').focus(); return; }
        const ok = await change({ op: 'saveKid', name, managers: [], parentsSee: true }, `${possessive(name)} list is ready.`);
        if (ok) { S.focus = '#s-kid'; draw(); }
      };
      put(pageH('Lists for your kids'),
        el('p', { class: 'wl-setup__lede' }, 'Have a child who does not have an email? Add their name, and you keep their list for them. No young kids? Tap Next.'),
        el('form', { class: 'wl-panel wl-form', novalidate: true, onsubmit: e => { e.preventDefault(); addKid(); } },
          field({ id: 's-kid', label: 'Child\'s name', attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'Like Ella or Baby Max',
            oninput: e => { v.name = e.target.value; } }),
          el('div', { class: 'wl-actions' }, el('button', { class: 'sdc-btn', type: 'submit' }, 'Add their list'))),
        mine.length ? el('div', null, el('p', { class: 'sdc-subhead' }, 'Lists you keep'), el('ul', null, mine.map(p => el('li', null, p.name)))) : null,
        el('p', { class: 'wl-hint' }, 'You will see what others buy for them, so nobody buys the same thing. To change that, or add the other parent, open their list and tap Edit details.'),
        form(null, next('Next')));
    } else if (key === 'device') {
      const kind = thisDevice();
      put(pageH('Add things straight from a store'),
        el('p', { class: 'wl-setup__lede' }, `This step is for the ${kind === 'computer' ? 'computer' : kind === 'iphone' ? 'iPhone or iPad' : 'phone'} you are using now. Afterward, one tap on any store's product page brings its name, photo and price to your list.`),
        el('div', { class: 'wl-panel wl-help' }, el('p', { class: 'sdc-subhead' }, DEVICE_NAMES[kind]), deviceSteps(kind, 'setup')),
        el('p', { class: 'wl-hint' }, 'Using another phone or computer later? The steps for every kind are on your list, under Add things from any store.'),
        form(null, next('Next')));
    } else if (key === 'family') {
      const others = S.data.people.filter(p => p.id !== me().id);
      const v = { name: '', email: '' };
      put(pageH('Who is in the family?'),
        el('p', { class: 'wl-setup__lede' }, 'Only people you add here can sign in. Add each person\'s name and email. You can add kids and make changes later on the People page.'),
        el('form', { class: 'wl-panel wl-form', novalidate: true, onsubmit: async e => {
          e.preventDefault();
          if (!v.name.trim() || !v.email.trim()) { say('Add a name and an email.', 'error'); return; }
          const ok = await change({ op: 'savePerson', name: v.name, email: v.email }, `${v.name.trim()} was added.`);
          if (ok) { S.focus = '#f-pname'; draw(); }
        } },
          el('div', { class: 'wl-fields' },
            field({ id: 'f-pname', label: 'Name', attrs: { maxlength: 40, autocomplete: 'off' }, hint: 'Like Grandma or Aunt Suzy', oninput: e => { v.name = e.target.value; } }),
            field({ id: 'f-pemail', label: 'Email', type: 'email', attrs: { autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', inputmode: 'email' },
              hint: 'The address they will sign in with', oninput: e => { v.email = e.target.value; } })),
          el('div', { class: 'wl-actions' }, el('button', { class: 'sdc-btn', type: 'submit' }, 'Add person'))),
        others.length ? el('div', null, el('p', { class: 'sdc-subhead' }, `${others.length} ${others.length === 1 ? 'person' : 'people'} so far`),
          el('ul', null, others.map(p => el('li', null, p.name + (p.email ? `, ${p.email}` : ', a kid'))))) : null,
        form(null, next('Next')));
    } else {
      put(pageH('You are all set'),
        el('ul', { class: 'wl-setup__points' },
          el('li', null, 'To add more, open your list and tap Add an item.'),
          el('li', null, 'To shop for someone, tap their name, tap a thing, then tap I bought this.'),
          el('li', null, 'After a gift is opened, tap It has been given.'),
          el('li', null, 'You never see what anyone buys for you.')),
        el('div', { class: 'wl-setup__nav' }, back, btn('Go to my list', () => setupFinish('done'), true, { id: 'setupNext' })));
    }
    root.append(box);
    return 'Setup';
  }

  // ------------------------------------------------------------ the tour: a walk through the whole app
  // Runs once after setup, and any time from How it works. Each tip opens the real screen and
  // outlines the real thing on it, so people learn the actual buttons, not a picture of them.
  // Tips that do not apply are left out (no one else's items yet, or not an admin).

  let tourDialog = null;
  let tourSeen = false;      // set when the tour ends, so a redraw never starts it again
  let tips = [];

  const sideOrPick = () => (document.querySelector('.wl-side') && document.querySelector('.wl-side').offsetParent ? '.wl-side' : '#wl-person');

  function buildTips() {
    const myList = urlFor({ list: me().id });
    const mine = S.data.items.filter(i => i.ownerId === me().id);
    // Someone else's thing that is still needed, to show how buying works.
    const shopItem = S.data.items.find(i => !hides(i.rel) && !i.removed && i.need > 0 && !i.buys.some(b => b.mine) && !i.secret);
    const owner = shopItem ? person(shopItem.ownerId) : null;
    // One short sentence each, so most fit on one line of a phone and the tip stays small.
    // ui() keeps a button's name on one line when the sentence wraps.
    const ui = name => name.replace(/ /g, '\u00a0');
    return [
      { route: myList, target: '#addBtn', title: 'Your list',
        text: `Tap ${ui('Add an item')} to put things on it.` },
      { route: myList, target: 'section[aria-labelledby="aboutH"]', title: 'About me',
        text: 'Tap Edit to add sizes and favorites.' },
      mine.length ? { route: myList, target: '.wl-grid .wl-card', title: 'Change something',
        text: 'Tap a thing to change it or take it off.' } : null,
      { route: myList, target: sideOrPick, title: 'Everyone else',
        text: 'Pick a name to see their list.' },
      shopItem ? { route: urlFor({ list: shopItem.ownerId }), title: `${possessive(owner.name)} list`,
        target: () => { const a = document.querySelector(`.wl-card__link[href$="item=${shopItem.id}"]`); return a && a.closest('.wl-card'); },
        text: 'Tap a thing to open it.' } : null,
      shopItem ? { route: urlFor({ item: shopItem.id }), target: '#buyBtn', title: 'I bought this',
        text: `Bought it? Tap ${ui('I bought this')}. ${owner.name} never sees it.` } : null,
      shopItem ? { route: urlFor({ item: shopItem.id }), target: '#chipBtn', title: 'Go in together',
        text: `Tap ${ui('Go in together')} to split a big gift.` } : null,
      { route: urlFor({ view: 'shopping' }), target: '#pageH', title: 'My shopping',
        text: 'Everything you bought, in one place.' },
      me().admin ? { route: urlFor({ view: 'people' }), target: '#addPersonBtn', title: 'People',
        text: 'Add family and kids here. Only you see this.' } : null,
      { route: myList, target: '#helpBtn', title: 'Help any time',
        text: `Tap ${ui('How it works')} to see these tips again.` }
    ].filter(Boolean);
  }

  function startTour() {
    tips = buildTips();
    S.tourStep = 0;
    say('');                 // no message bar peeking out behind the tip
    showTip();
  }

  function endTour(state) {
    document.querySelectorAll('.wl-tour-target').forEach(n => n.classList.remove('wl-tour-target'));
    if (tourDialog && tourDialog.open) tourDialog.close();
    S.tourStep = null;
    tourSeen = true;
    api('/data', { op: 'saveSetup', tour: state }).then(r => { if (r.ok && r.data.people) S.data = r.data; });
    const home = urlFor({ list: me().id });
    if (location.pathname + location.search !== home) go(home, true);
    const help = document.getElementById('helpBtn');
    if (help && !help.hidden) help.focus();
  }

  // Outline the thing the current tip is about.
  function markTip(scroll) {
    const tip = tips[S.tourStep];
    if (!tip) return;
    document.querySelectorAll('.wl-tour-target').forEach(n => n.classList.remove('wl-tour-target'));
    const found = typeof tip.target === 'function' ? tip.target() : tip.target;
    const target = typeof found === 'string' ? document.querySelector(found) : found;
    if (!target) return;
    target.classList.add('wl-tour-target');
    if (scroll && onPhone()) {
      // Bring it near the top, so the tip at the bottom of the screen does not cover it.
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      window.scrollBy({ top: -Math.round(window.innerHeight * 0.15), behavior: 'instant' });
    } else if (scroll) {
      // On a computer the tip sits next to it, so only scroll when it is off screen or
      // too close to the edge to leave room for the tip.
      const r = target.getBoundingClientRect(), room = (tourDialog ? tourDialog.offsetHeight : 160) + space('md');
      if (r.top < space('md') || r.bottom > window.innerHeight - room) target.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
    return target;
  }

  const onPhone = () => window.matchMedia('(max-width: 640px)').matches;
  // An SDC spacing token in pixels, for placing the tip.
  const space = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(`--sdc-space-${name}`)) || 16;

  // On a phone the tip docks at the bottom of the screen, or the top when the bottom would
  // cover the outlined thing. On a computer it sits right next to the outlined thing.
  function placeTip() {
    if (!tourDialog) return;
    const d = tourDialog;
    d.classList.remove('is-top', 'is-anchored');
    delete d.dataset.side;
    for (const p of ['top', 'left', '--wl-tip-arrow']) d.style.removeProperty(p);
    const target = document.querySelector('.wl-tour-target');
    if (!target) return;
    const t = target.getBoundingClientRect();
    if (!onPhone() && anchorTip(d, t)) return;
    const r = d.getBoundingClientRect();
    if (t.top < r.bottom && t.bottom > r.top) d.classList.add('is-top');
  }

  // Below the outlined thing when there is room, else above it, else to its right or left,
  // with a small arrow pointing at it. When none fits (or it is scrolled off screen), the
  // tip stays in the corner.
  function anchorTip(d, t) {
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const edge = space('sm'), gap = space('md');
    if (t.bottom < edge || t.top > vh - edge) return false;
    d.classList.add('is-anchored');            // out of the corner, so it measures at its real size
    const w = d.offsetWidth, h = d.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const cx = (t.left + t.right) / 2, cy = (t.top + t.bottom) / 2;
    let side = null, top = 0, left = 0;
    if (t.bottom + gap + h <= vh - edge) { side = 'below'; top = t.bottom + gap; }
    else if (t.top - gap - h >= edge) { side = 'above'; top = t.top - gap - h; }
    if (side) left = clamp(t.width >= w ? t.left : cx - w / 2, edge, vw - w - edge);
    else if (t.right + gap + w <= vw - edge) { side = 'right'; left = t.right + gap; }
    else if (t.left - gap - w >= edge) { side = 'left'; left = t.left - gap - w; }
    if (!side) { d.classList.remove('is-anchored'); return false; }
    if (side === 'right' || side === 'left') top = clamp(Math.min(t.top, cy - h / 2), edge, vh - h - edge);
    d.dataset.side = side;
    d.style.top = `${Math.round(top)}px`;
    d.style.left = `${Math.round(left)}px`;
    // The arrow points at the middle of the outlined thing, kept clear of the rounded corners.
    const along = side === 'below' || side === 'above' ? [cx - left, w] : [cy - top, h];
    d.style.setProperty('--wl-tip-arrow', `${Math.round(clamp(along[0], gap * 1.5, along[1] - gap * 1.5))}px`);
    return true;
  }
  // Keep it beside the outlined thing when the page scrolls or the window changes size.
  let placing = false;
  const replaceTip = () => {
    if (placing || S.tourStep === null || !tourDialog || !tourDialog.open) return;
    placing = true;
    requestAnimationFrame(() => { placing = false; placeTip(); });
  };
  window.addEventListener('scroll', replaceTip, { passive: true });
  window.addEventListener('resize', replaceTip);

  function showTip() {
    const i = S.tourStep;
    const tip = tips[i];
    // Open the screen this tip is about. Replace, not push, so Back after the tour is not a maze.
    if (tip.route && location.pathname + location.search !== tip.route) go(tip.route, true);
    markTip(true);
    if (!tourDialog) {
      tourDialog = el('dialog', { class: 'wl-tour', 'aria-labelledby': 'tourH' });
      tourDialog.addEventListener('cancel', e => { e.preventDefault(); endTour('skipped'); });
      document.body.append(tourDialog);
    }
    const last = i === tips.length - 1;
    // Small on purpose: the point is to see the page behind it. Skip is a plain text link;
    // Back and Next share its row.
    tourDialog.replaceChildren(
      el('div', { class: 'wl-tour__head' },
        el('h2', { class: 'sdc-subhead', id: 'tourH' }, tip.title),
        el('p', { class: 'wl-tour__count' }, `Tip ${i + 1} of ${tips.length}`)),
      el('p', null, tip.text),
      el('div', { class: 'wl-tour__nav' },
        last ? null : linkBtn('Skip the tips', () => endTour('skipped')),
        i > 0 ? btn('Back', () => { S.tourStep = i - 1; showTip(); }) : null,
        btn(last ? 'Done' : 'Next', () => { if (last) endTour('done'); else { S.tourStep = i + 1; showTip(); } }, true, { id: 'tourNext', autofocus: true })));
    if (!tourDialog.open) tourDialog.showModal();
    placeTip();
    $('tourNext').focus();
  }

  // ------------------------------------------------------------ sign in

  // An error under the field it is about, tied to it for screen readers.
  function fieldError(inputId, text) {
    const input = $(inputId), err = $(inputId + '-err'), wrap = input.closest('.sdc-field');
    err.textContent = text || '';
    err.hidden = !text;
    wrap.classList.toggle('sdc-field--invalid', Boolean(text));
    if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  }

  async function sendEmail(e) {
    if (e) e.preventDefault();
    const input = $('email');
    const email = (input.value || S.email).trim();
    fieldError('email', '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      fieldError('email', 'Type your email address, like name@gmail.com.');
      say('');
      input.focus();
      return;
    }
    S.email = email;
    say('Sending…');
    const r = await api('/login', { email });
    if (!r.ok) { say(r.data.message || 'The email did not send. Try again.', 'error'); return; }
    say(r.data.message, 'success');
    $('sentTo').textContent = `We sent a code to ${email}.`;
    $('codeForm').hidden = false;
    $('emailForm').hidden = true;
    fieldError('code', '');
    if (r.data.dev) {
      // Local testing only: the server hands back the link instead of emailing it.
      $('signinStatus').append(' ', el('a', { href: r.data.dev.link }, 'Dev: open the sign-in link'), ` Dev code: ${r.data.dev.code}`);
    }
    $('code').focus();
  }

  async function sendCode(e) {
    e.preventDefault();
    const code = $('code').value.replace(/\D/g, '');
    if (code.length !== 6) { fieldError('code', 'The code is six numbers. Check the email.'); $('code').focus(); return; }
    fieldError('code', '');
    say('Checking…');
    const r = await api('/login', { email: S.email || $('email').value.trim(), code });
    if (!r.ok) { say(''); fieldError('code', r.data.message || 'That code did not work.'); $('code').focus(); return; }
    say('');
    S.focus = '#pageH';
    await load();
  }

  // Asking to join: a name, an email and a note for the admin. Nothing more happens until they are added.
  function showRequestStep() {
    $('emailForm').hidden = true;
    $('codeForm').hidden = true;
    $('requestForm').hidden = false;
    for (const id of ['rq-name', 'rq-email', 'rq-note']) fieldError(id, '');
    if (!$('rq-email').value) $('rq-email').value = S.email || $('email').value.trim();
    say('');
    $('rq-name').focus();
  }
  async function sendRequest(e) {
    e.preventDefault();
    const name = $('rq-name').value.trim(), email = $('rq-email').value.trim();
    for (const id of ['rq-name', 'rq-email', 'rq-note']) fieldError(id, '');
    if (!name) { fieldError('rq-name', 'Enter your name.'); $('rq-name').focus(); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { fieldError('rq-email', 'Type your email address, like name@gmail.com.'); $('rq-email').focus(); return; }
    say('Sending…');
    const r = await api('/request', { name, email, note: $('rq-note').value.trim(), website: $('rq-website').value });
    if (!r.ok) {
      say('');
      const where = /email/i.test(r.data.message || '') ? 'rq-email' : 'rq-name';
      fieldError(where, r.data.message || 'That did not go through. Try again.');
      $(where).focus();
      return;
    }
    $('requestForm').reset();
    showEmailStep();
    say(r.data.message, 'success');
  }

  function showEmailStep() {
    $('codeForm').hidden = true;
    $('requestForm').hidden = true;
    $('emailForm').hidden = false;
    $('code').value = '';
    fieldError('code', '');
    say('');
    $('email').focus();
  }

  // ------------------------------------------------------------ start

  document.addEventListener('click', async e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'sign-out') {
      await api('/logout', {});
      S.data = null;
      closeAll();
      history.replaceState(null, '', '/lists');
      draw();
      showEmailStep();
      say('You are signed out on this device.', 'success');
    } else if (a.dataset.action === 'tour') {
      startTour();
    } else if (a.dataset.action === 'new-code') {
      sendEmail();
    } else if (a.dataset.action === 'change-email') {
      showEmailStep();
    } else if (a.dataset.action === 'toast-close') {
      say('');
    } else if (a.dataset.action === 'ask-to-join') {
      showRequestStep();
    } else if (a.dataset.action === 'back-to-signin') {
      showEmailStep();
    }
  });

  $('emailForm').addEventListener('submit', sendEmail);
  $('codeForm').addEventListener('submit', sendCode);
  $('requestForm').addEventListener('submit', sendRequest);

  // The names of this wish list and its admin, before anyone signs in (and the footer's
  // contact address, sent as hex so it is not plain in the page). Signed in, S.data.site
  // keeps them current after the admin changes them on People.
  function applySite(info) {
    if (!info) return;
    if (info.shortTitle) SITE = info.shortTitle;
    const text = { title: info.title, short: info.shortTitle, admin: info.adminName };
    for (const n of document.querySelectorAll('[data-site]')) if (text[n.dataset.site]) n.textContent = text[n.dataset.site];
    if (!S.data) document.title = SITE;
  }
  api('/config').then(r => {
    if (!r.ok) return;
    applySite(r.data);
    const hex = r.data.contactHex || '';
    if (hex) {
      let address = '';
      for (let i = 0; i < hex.length; i += 2) address += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
      $('mailAdmin').href = 'mailto:' + address;
      $('mailAdmin').hidden = false;
    }
    // The SDC display face, Nickel Gothic, from an Adobe Fonts project when one is set.
    if (r.data.adobeKit && !document.querySelector('link[href*="use.typekit.net"]')) {
      document.head.append(el('link', { rel: 'stylesheet', href: `https://use.typekit.net/${r.data.adobeKit}.css` }));
    }
  });

  // Lets Android show "Wish List" in its share menu once the page is installed.
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/lists-sw.js', { scope: '/lists' }).catch(() => {});
  }

  readArrival();
  load();
})();
