import { computeBoard, parseDollars, formatMoney } from '/shared/logic.js';
import { groupByDivision } from '/shared/teams.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'pickem.token';
const BET_KEY = 'pickem.bet';
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: still works for this tab */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let token = store.get(TOKEN_KEY);
let view = 'board';
let betText = store.get(BET_KEY) ?? '5';
let focusKey = null;

async function api(method, url, body) {
  const res = await fetch(url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { status: res.status });
  return data;
}

function say(text) {
  const el = $('msg');
  el.textContent = text || '';
  el.hidden = !text;
  if (text) setTimeout(() => { if (el.textContent === text) say(''); }, 5000);
}

async function load() {
  try {
    const sent = token;
    const next = await api('GET', '/api/state');
    if (sent !== token) return load(); // joined while this request was in flight: ask again with the new token
    S = next;
    if (token && !S.me) { token = null; store.del(TOKEN_KEY); }
    render();
  } catch { say('Can\'t reach the server. Retrying.'); }
}

const cents = () => parseDollars(betText);
const ledText = (v) => esc(v);

function scoreboard(board) {
  const total = S.lines.length;
  const picked = Object.keys(S.me.picks).length;
  const cell = (val, ghost, caption, small) =>
    `<div class="c99-scoreboard__cell"><span class="c99-led${small ? ' c99-led--sm' : ''}" data-ghost="${ghost}"><span>${ledText(val)}</span></span><span class="c99-scoreboard__caption">${esc(caption)}</span></div>`;
  if (!S.me.locked) {
    return `<div class="c99-scoreboard" role="group" aria-label="${picked} of ${total} teams picked">${cell(picked, '88', 'Picked')}${cell(total - picked, '88', 'Left')}</div>`;
  }
  const c = cents();
  const pool = c === null ? '--' : formatMoney(board.totalPool);
  return `<div class="c99-scoreboard" role="group" aria-label="${board.teamsOn} teams on, ${pool} in play">${cell(board.teamsOn, '88', 'Teams on')}${cell(pool, '8888', 'In play')}</div>`;
}

function lockBar() {
  const total = S.lines.length;
  const picked = Object.keys(S.me.picks).length;
  if (S.me.locked) return '<p class="app-lock__done">Locked. Picks are final.</p>';
  const left = total - picked;
  return `<button class="c99-pill app-lock" id="lock" type="button" ${left ? 'disabled' : ''}>Lock in picks</button>
    <p class="app-note">${left ? `Pick ${left} more ${left === 1 ? 'team' : 'teams'} to lock in.` : 'All picked. Locking is final.'}</p>`;
}

function pickCard(t) {
  const mine = S.me.picks[t.team];
  const btn = (side) =>
    `<button class="c99-pill" type="button" data-team="${esc(t.team)}" data-side="${side}" aria-pressed="${mine === side}">${side}</button>`;
  return `<article class="c99-panel team${mine ? '' : ' team--open'}" aria-label="${esc(t.team)}">
    <div class="team__body">
      <div class="team__top">
        <h4 class="team__name">${esc(t.team)}</h4>
        <div class="team__line"><span class="c99-scoreboard__caption">Line</span><span class="c99-led c99-led--sm" data-ghost="88.8"><span>${t.line}</span></span></div>
      </div>
      <div class="team__picks" role="group" aria-label="${esc(t.team)} over or under ${t.line}">${btn('over')}${btn('under')}</div>
    </div></article>`;
}

function names(ids, nameOf) {
  if (!ids.length) return '<span class="is-off">None</span>';
  return ids.map((id) => `<span class="${id === S.me.id ? 'is-me' : ''}">${esc(nameOf[id])}</span>`).join(', ');
}

function resultCard(t, nameOf) {
  const mine = S.me.picks[t.team];
  const c = cents();
  const row = (label, value, cls = '') => `<div class="c99-option"><span class="c99-option__label">${label}</span><span class="c99-option__value ${cls}">${esc(value)}</span></div>`;
  return `<article class="c99-panel team" aria-label="${esc(t.team)}">
    <div class="team__body">
      <div class="team__top">
        <h4 class="team__name">${esc(t.team)}</h4>
        <div class="team__line"><span class="c99-scoreboard__caption">Line</span><span class="c99-led c99-led--sm" data-ghost="88.8"><span>${t.line}</span></span></div>
      </div>
      ${row('Bet', t.on ? 'On' : 'Off', t.on ? 'is-on' : 'is-off')}
      ${row('Pool', t.on && c !== null ? formatMoney(t.pool) : '--')}
      ${row('You', mine ?? '--')}
      ${row('Wins', t.wins ?? '--')}
      ${t.on ? row('Leads', t.leader ?? '--') : ''}
      <div class="sides">
        <div><span class="c99-label">Over (${t.over.length})</span><p>${names(t.over, nameOf)}</p></div>
        <div><span class="c99-label">Under (${t.under.length})</span><p>${names(t.under, nameOf)}</p></div>
      </div>
    </div></article>`;
}

function payoutsView(board) {
  const c = cents();
  const meta = S.winsMeta;
  const when = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const stale = meta.error || (meta.updatedAt && Date.now() - meta.updatedAt > 36 * 3_600_000);
  const status = !when ? 'Win totals have not loaded yet.'
    : `Wins from ESPN, updated ${when}.${stale ? ' Showing the last good update.' : ''}`;
  const rows = board.players.map((p) => {
    const v = c === null ? '--' : formatMoney(p.net, { signed: true });
    return `<div class="c99-option"><span class="c99-option__label ${p.id === S.me.id ? 'is-me' : ''}">${esc(p.name)}</span><span class="c99-option__value ${p.net > 0 ? 'pos' : 'neg'}">${esc(v)}</span></div>`;
  }).join('');
  return `<section class="c99-panel pay" aria-labelledby="pay-h">
    <header class="c99-panel__header"><span id="pay-h">If The Season Ended Today</span><span class="c99-panel__caret" aria-hidden="true"></span></header>
    <div class="c99-panel__body">${rows || '<p class="app-note">No locked players yet.</p>'}
      <p class="app-note">${c === null ? 'Enter a bet amount to see dollars. ' : ''}Net = winnings minus what you put in on every team that is on. ${esc(status)}</p>
    </div></section>`;
}

// Conference > division > teams A-Z.
function grouped(entries, card) {
  return groupByDivision(entries).map((c) => `<section class="conf" aria-label="${esc(c.conference)}">
    <h2 class="conf__title">${esc(c.conference)}</h2>
    ${c.divisions.map((d) => `<h3 class="div__title">${esc(d.name)}</h3><div class="teams">${d.items.map(card).join('')}</div>`).join('')}
  </section>`).join('');
}

function renderView(board) {
  const el = $('view');
  if (view === 'payouts') {
    el.innerHTML = S.me.locked ? payoutsView(board)
      : '<section class="c99-panel pay"><div class="c99-panel__body"><p>Lock in your picks to see payouts.</p></div></section>';
    return;
  }
  if (!S.me.locked) {
    el.innerHTML = grouped(S.lines, pickCard);
    return;
  }
  const nameOf = Object.fromEntries(S.revealed.map((p) => [p.id, p.name]));
  el.innerHTML = grouped(board.teams, (t) => resultCard(t, nameOf));
}

function renderRoster() {
  const rows = S.players.map((p) =>
    `<div class="c99-option"><span class="c99-option__label ${S.me && p.id === S.me.id ? 'is-me' : ''}">${esc(p.name)}</span><span class="c99-option__value ${p.locked ? 'is-on' : 'is-off'}">${p.locked ? 'Locked' : `${p.picked}/${S.lines.length}`}</span></div>`).join('');
  $('roster').innerHTML = `<div class="c99-panel"><header class="c99-panel__header"><span>Roster (${S.players.length}/${S.maxPlayers})</span><span class="c99-panel__caret" aria-hidden="true"></span></header>
    <div class="c99-panel__body">${rows || '<p class="app-note">Nobody yet. Be the first.</p>'}
    <p class="app-note">Picks stay hidden until you lock in yours.</p></div></div>`;
}

function render() {
  const joined = !!S.me;
  $('join').hidden = joined;
  $('game').hidden = !joined;
  renderRoster();
  $('sources').innerHTML = `Lines: ${esc(S.linesSource)} &middot; Wins: <a href="${esc(S.winsSourceUrl)}" rel="noopener">ESPN standings</a> &middot; Bets are between friends`;
  if (!joined) return;

  document.title = `Pick'em: ${S.me.name}`;
  const link = `${location.origin}/?me=${token}`;
  if ($('mylink').value !== link) $('mylink').value = link;

  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
  const c = cents();
  const board = S.me.locked
    ? computeBoard({ lines: S.lines, players: S.revealed, wins: S.wins, cents: c ?? 0 })
    : null;
  $('scoreboard').innerHTML = scoreboard(board);
  $('lockbar').innerHTML = lockBar();
  renderView(board);

  if (focusKey) {
    const [team, side] = focusKey;
    const el = [...document.querySelectorAll('[data-team]')].find((b) => b.dataset.team === team && b.dataset.side === side);
    el?.focus();
    focusKey = null;
  }
}

// ---- events ----
$('join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('join-error');
  err.hidden = true;
  try {
    const { token: t } = await api('POST', '/api/join', { name: $('name').value });
    token = t; store.set(TOKEN_KEY, t);
    await load();
  } catch (ex) { err.textContent = ex.message; err.hidden = false; }
});

$('view').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-team]');
  if (!b || S.me.locked) return;
  const { team, side } = b.dataset;
  const next = S.me.picks[team] === side ? null : side;
  if (next) S.me.picks[team] = next; else delete S.me.picks[team];
  focusKey = [team, side];
  render();
  try { await api('PUT', '/api/picks', { team, side: next }); }
  catch (ex) { say(ex.message); load(); }
});

document.querySelector('.app-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  view = b.dataset.view;
  render();
});

$('lockbar').addEventListener('click', (e) => {
  if (e.target.closest('#lock') && !e.target.closest('#lock').disabled) $('confirm').showModal();
});
$('confirm-no').addEventListener('click', () => $('confirm').close());
$('confirm-yes').addEventListener('click', async () => {
  $('confirm').close();
  try { await api('POST', '/api/lock'); } catch (ex) { say(ex.message); }
  load();
});

const bet = $('bet');
bet.value = betText;
bet.addEventListener('input', () => {
  betText = bet.value;
  store.set(BET_KEY, betText);
  bet.setAttribute('aria-invalid', String(cents() === null));
  if (S?.me) render();
});

function bookmarkHint() {
  const ua = navigator.userAgent;
  const mac = /Mac/.test(navigator.platform || '') || /Macintosh/.test(ua);
  if (/iPhone|iPad|iPod/.test(ua) || (mac && navigator.maxTouchPoints > 1)) return 'Tap the Share button, then Add Bookmark (or Add to Home Screen).';
  if (/Android/.test(ua)) return 'Tap the ⋮ menu, then the star (or Add to Home screen).';
  if (mac) return 'Press ⌘D now to bookmark it.';
  return 'Press Ctrl+D now to bookmark it.';
}

let cleanTimer;
$('bookmarklink').addEventListener('click', () => {
  // Put the personal link in the address bar so the browser's own bookmark captures it,
  // then take it back out so a copied address bar never carries the secret.
  history.replaceState(null, '', `/?me=${token}`);
  $('bookmark-hint').textContent = bookmarkHint();
  clearTimeout(cleanTimer);
  cleanTimer = setTimeout(() => {
    history.replaceState(null, '', location.pathname);
    $('bookmark-hint').textContent = '';
  }, 60_000);
});

$('mylink').addEventListener('focus', (e) => e.target.select());
$('copylink').addEventListener('click', async () => {
  const input = $('mylink');
  try { await navigator.clipboard.writeText(input.value); }
  catch { input.select(); document.execCommand('copy'); }
  const btn = $('copylink');
  btn.textContent = 'Copied';
  setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
});

// ---- boot ----
// A personal link (/?me=<token>) restores your card on any device.
async function adoptLinkToken() {
  const t = new URLSearchParams(location.search).get('me');
  if (!t) return;
  history.replaceState(null, '', location.pathname); // keep the secret out of the address bar
  try {
    const res = await fetch('/api/state', { headers: { 'x-token': t } });
    const data = await res.json();
    if (data.me) { token = t; store.set(TOKEN_KEY, t); }
    else say('That personal link is not valid. Check that you copied all of it.');
  } catch { /* the normal load below will report connection trouble */ }
}
await adoptLinkToken();
load();
const es = new EventSource('/events');
es.addEventListener('update', load);
es.addEventListener('open', () => { if (S) load(); });
