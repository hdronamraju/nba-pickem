import { computeBoard, formatMoney, playerRanges } from '/shared/logic.js';
import { groupByDivision } from '/shared/teams.js';

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'pickem.token';
const SOUND_KEY = 'pickem.sound';
const HOSTPW_KEY = 'pickem.hostpw';
const CARD_STAGGER_MS = 80;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: still works for this tab */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let S = null;
let token = store.get(TOKEN_KEY);
let view = 'picks';
let focusKey = null;
let soundOn = store.get(SOUND_KEY) === '1';
let audioCtx = null;
let lockAnimUntil = 0;   // while Date.now() < this, cards play the lock-in animation
let cardIndex = 0;       // order of cards in the current render, drives the stagger
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, v); } catch { /* ignore */ } },
};

async function api(method, url, body) {
  const res = await fetch(url, {
    method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error || 'Something went wrong.'), { status: res.status });
  // A response cut off mid-body (flaky connection, page reload) must never look like "you are not signed in".
  if (data === null) throw new Error('The server response was cut off.');
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
    const wasOpen = S && S.phase === 'open';
    S = next;
    if (token && !S.me) { token = null; store.del(TOKEN_KEY); }
    if (wasOpen && S.phase === 'locked' && S.me) startLockAnimation();
    render();
  } catch { say('Can\'t reach the server. Retrying.'); }
}

const ledText = (v) => esc(v);
const stake = () => S.stakeCents;
const maxAtRisk = () => stake() * S.lines.length;

// Everyone's picks, when this viewer is allowed to see them.
const allPlayers = () => (S.everyone ?? []).map((p) => ({ id: p.id, name: p.name, picks: p.picks }));
const boardFor = () => (S.everyone
  ? computeBoard({ lines: S.lines, players: allPlayers(), wins: S.wins, cents: stake() })
  : null);

function scoreboard(board) {
  const total = S.lines.length;
  const picked = Object.keys(S.me.picks).length;
  const cell = (val, ghost, caption, small) =>
    `<div class="c99-scoreboard__cell"><span class="c99-led${small ? ' c99-led--sm' : ''}" data-ghost="${ghost}"><span>${ledText(val)}</span></span><span class="c99-scoreboard__caption">${esc(caption)}</span></div>`;
  if (S.phase !== 'locked' || !board) {
    return `<div class="c99-scoreboard" role="group" aria-label="${picked} of ${total} teams picked">${cell(picked, '88', 'Picked')}${cell(total - picked, '88', 'Left')}</div>`;
  }
  const pool = formatMoney(board.totalPool);
  return `<div class="c99-scoreboard" role="group" aria-label="${board.teamsOn} teams on, ${pool} in play">${cell(board.teamsOn, '88', 'Teams on')}${cell(pool, '8888', 'In play')}</div>`;
}

function lockBar() {
  const total = S.lines.length;
  const picked = Object.keys(S.me.picks).length;
  if (S.phase === 'locked') return '<p class="app-lock__done">Locked. Picks are final.</p>';
  const left = total - picked;
  const label = S.me.ready ? 'Ready (tap to undo)' : "I'm ready";
  const note = left ? `Pick ${left} more ${left === 1 ? 'team' : 'teams'}, then tap I'm ready.`
    : S.me.ready ? 'You are ready. The host locks everyone in when all players are.' : 'All picked. Tap I\'m ready when you are happy with them.';
  return `<button class="c99-pill app-lock" id="ready" type="button" aria-pressed="${S.me.ready}" ${left ? 'disabled' : ''}>${label}</button>
    <p class="app-note">${note}</p>`;
}

function sidesBlock(info, nameOf, compact) {
  if (!info) return '';
  return `<div class="sides${compact ? ' sides--compact' : ''}">
    <div><span class="c99-label">Over (${info.over.length})</span><p>${names(info.over, nameOf)}</p></div>
    <div><span class="c99-label">Under (${info.under.length})</span><p>${names(info.under, nameOf)}</p></div>
  </div>`;
}

function pickCard(t, info, nameOf) {
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
      ${sidesBlock(info, nameOf, true)}
    </div></article>`;
}

function names(ids, nameOf) {
  if (!ids.length) return '<span class="is-off">None</span>';
  return ids.map((id) => `<span class="${id === S.me.id ? 'is-me' : ''}">${esc(nameOf[id])}</span>`).join(', ');
}

const LOCK_ICON = '<svg class="team__lock" viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M7 11V8a5 5 0 0 1 10 0v3"/><rect x="5" y="11" width="14" height="10" rx="2"/></svg>';

function resultCard(t, nameOf) {
  const locked = S.phase === 'locked';
  const animating = locked && Date.now() < lockAnimUntil;
  const style = animating ? ` style="--i:${cardIndex}"` : '';
  cardIndex += 1;
  const row = (label, value, cls = '') => `<div class="c99-option"><span class="c99-option__label">${label}</span><span class="c99-option__value ${cls}">${esc(value)}</span></div>`;
  return `<article class="c99-panel team${locked ? ' is-locked' : ''}${animating ? ' is-locking' : ''}"${style} aria-label="${esc(t.team)}">
    <div class="team__body">
      <div class="team__top">
        <h4 class="team__name">${esc(t.team)}</h4>
        <div class="team__line"><span class="c99-scoreboard__caption">Line</span><span class="c99-led c99-led--sm" data-ghost="88.8"><span>${t.line}</span></span></div>
      </div>
      ${row(locked ? 'Bet' : 'Bet (so far)', t.on ? 'On' : 'Off', t.on ? 'is-on' : 'is-off')}
      ${row('Pool', t.on ? formatMoney(t.pool) : '--')}
      ${t.on && locked ? row('Leads', t.leader ?? '--') : ''}
      ${sidesBlock(t, nameOf, false)}
      ${locked ? LOCK_ICON : ''}
    </div></article>`;
}

function payoutsView(board) {
  const meta = S.winsMeta;
  const when = meta.updatedAt ? new Date(meta.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
  const stale = meta.error || (meta.updatedAt && Date.now() - meta.updatedAt > 36 * 3_600_000);
  const status = !S.seasonStarted ? "The season hasn't started yet, so every payout is $0 until the host starts the season."
    : !when ? 'Win totals have not loaded yet.'
    : `Wins from ESPN, updated ${when}.${stale ? ' Showing the last good update.' : ''}`;
  const rows = board.players.map((p) => {
    const v = formatMoney(p.net, { signed: true });
    return `<div class="c99-option"><span class="c99-option__label ${p.id === S.me.id ? 'is-me' : ''}">${esc(p.name)}</span><span class="c99-option__value ${p.net > 0 ? 'pos' : 'neg'}">${esc(v)}</span></div>`;
  }).join('');
  return `<section class="c99-panel pay" aria-labelledby="pay-h">
    <header class="c99-panel__header"><span id="pay-h">If The Season Ended Today</span><span class="c99-panel__caret" aria-hidden="true"></span></header>
    <div class="c99-panel__body">${rows || '<p class="app-note">No players yet.</p>'}
      <p class="app-note">${esc(formatMoney(stake()))} per team. Net = winnings minus what you put in on every team that is on. ${esc(status)}</p>
    </div></section>`;
}

// ---- Money Board: a candlestick per player, worst outcome to best outcome ----
function niceStep(rough) {
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

const whole = (c) => Math.round(c / 100) * 100; // chart labels in whole dollars so they never collide
const axisMoney = (c) => (c < 0 ? `-${formatMoney(-c)}` : formatMoney(c));

function moneyBoard(board) {
  const players = allPlayers();
  const ranges = playerRanges({ lines: S.lines, players, cents: stake() });
  if (!ranges.length) return '';
  const anyOn = ranges.some((r) => r.teamsOn > 0);
  // The actual outcome appears once the season is underway and wins decide at least one bet.
  const hasActual = S.seasonStarted && board.teams.some((t) => t.leader);
  const net = hasActual ? Object.fromEntries(board.players.map((p) => [p.id, p.net])) : {};

  const n = ranges.length;
  const W = Math.max(320, 48 + n * 44), H = 300;
  const padL = 56, padR = 10, padT = 30, padB = 34;
  const plotH = H - padT - padB;
  const hi = Math.max(0, ...ranges.map((r) => r.best), ...Object.values(net));
  const lo = Math.min(0, ...ranges.map((r) => r.worst), ...Object.values(net));
  const spanD = Math.max(1, (hi - lo) / 100);
  const stepC = niceStep(spanD / 4) * 100;
  const top = Math.max(stepC, Math.ceil(hi / stepC) * stepC);
  const bottom = Math.min(0, Math.floor(lo / stepC) * stepC);
  const y = (c) => padT + ((top - c) / (top - bottom)) * plotH;
  const slot = (W - padL - padR) / n;
  const bw = Math.min(22, slot * 0.5);

  let grid = '';
  for (let t = bottom; t <= top; t += stepC) {
    grid += `<line class="${t === 0 ? 'mb-zero' : 'mb-grid'}" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`
      + `<text class="mb-axis" x="${padL - 6}" y="${y(t) + 4}" text-anchor="end">${esc(axisMoney(t))}</text>`;
  }

  const candles = ranges.map((r, i) => {
    const cx = padL + slot * (i + 0.5);
    const mine = r.id === S.me.id;
    const label = r.name.length > 7 ? `${r.name.slice(0, 6)}.` : r.name;
    const cap = (c) => `<line class="mb-wick" x1="${cx - bw / 2}" x2="${cx + bw / 2}" y1="${y(c)}" y2="${y(c)}"/>`;
    let g = '';
    if (r.teamsOn > 0) {
      g += `<rect class="mb-up" x="${cx - bw / 2}" y="${y(r.best)}" width="${bw}" height="${Math.max(0, y(0) - y(r.best))}"/>`
        + `<rect class="mb-down" x="${cx - bw / 2}" y="${y(0)}" width="${bw}" height="${Math.max(0, y(r.worst) - y(0))}"/>`
        + `<line class="mb-wick" x1="${cx}" x2="${cx}" y1="${y(r.best)}" y2="${y(r.worst)}"/>${cap(r.best)}${cap(r.worst)}`
        + `<text class="mb-val" x="${cx}" y="${y(r.best) - 6}" text-anchor="middle">${esc(formatMoney(whole(r.best), { signed: true }))}</text>`
        + `<text class="mb-val" x="${cx}" y="${y(r.worst) + 15}" text-anchor="middle">${esc(formatMoney(whole(r.worst), { signed: true }))}</text>`;
    }
    if (hasActual && r.id in net) {
      const cy = y(net[r.id]);
      g += `<polygon class="mb-actual" points="${cx},${cy - 8} ${cx + 8},${cy} ${cx},${cy + 8} ${cx - 8},${cy}"><title>${esc(r.name)}: ${esc(formatMoney(net[r.id], { signed: true }))} so far</title></polygon>`;
    }
    return `<g>${g}<text class="mb-name${mine ? ' is-me' : ''}" x="${cx}" y="${H - 12}" text-anchor="middle">${esc(label)}</text></g>`;
  }).join('');

  const rows = ranges.map((r) => `<tr><th scope="row">${esc(r.name)}</th><td>${esc(formatMoney(r.best, { signed: true }))}</td><td>${esc(formatMoney(r.worst, { signed: true }))}</td>${hasActual ? `<td>${esc(formatMoney(net[r.id] ?? 0, { signed: true }))}</td>` : ''}</tr>`).join('');
  return `<section class="c99-panel pay mb-panel" aria-labelledby="mb-h">
    <header class="c99-panel__header"><span id="mb-h">Money Board</span><span class="c99-panel__caret" aria-hidden="true"></span></header>
    <div class="c99-panel__body">
      ${anyOn ? `<svg class="mb" viewBox="0 0 ${W} ${H}" role="img" aria-label="Best and worst outcome for each player">${grid}${candles}</svg>
      <p class="mb-legend"><span><i class="mb-key mb-key--up"></i>Best case</span><span><i class="mb-key mb-key--down"></i>Worst case</span>${hasActual ? '<span><i class="mb-key mb-key--actual"></i>Actual so far</span>' : ''}</p>
      <table class="sr-only"><caption>Best and worst outcome for each player</caption><thead><tr><th>Player</th><th>Best</th><th>Worst</th>${hasActual ? '<th>Actual so far</th>' : ''}</tr></thead><tbody>${rows}</tbody></table>`
      : '<p>No bets are on yet. A team turns on when one friend picks Over and another picks Under.</p>'}
      <p class="app-note">Best case: every bet you are in goes your way. Worst case: every one misses. ${esc(formatMoney(stake()))} a team, and it moves as picks change.</p>
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
  const locked = S.phase === 'locked';
  cardIndex = 0;
  if (view === 'payouts') {
    el.innerHTML = locked && board ? payoutsView(board)
      : '<section class="c99-panel pay"><div class="c99-panel__body"><p>Payouts appear after the host locks it in.</p></div></section>';
    return;
  }
  const nameOf = Object.fromEntries((S.everyone ?? []).map((p) => [p.id, p.name]));
  const byTeam = board ? Object.fromEntries(board.teams.map((t) => [t.team, t])) : null;
  if (view === 'picks') {
    el.innerHTML = grouped(S.lines, (t) => pickCard(t, byTeam?.[t.team], nameOf));
    return;
  }
  el.innerHTML = board
    ? moneyBoard(board) + grouped(board.teams, (t) => resultCard(t, nameOf))
    : '<section class="c99-panel pay"><div class="c99-panel__body"><p>Picks are hidden until the host locks it in.</p></div></section>';
}

function renderRoster() {
  const rows = S.players.map((p) =>
    `<div class="c99-option"><span class="c99-option__label ${S.me && p.id === S.me.id ? 'is-me' : ''}">${esc(p.name)}</span><span class="c99-option__value ${p.ready ? 'is-on' : 'is-off'}">${p.ready ? 'Ready' : `${p.picked}/${S.lines.length}`}</span></div>`).join('');
  $('roster').innerHTML = `<div class="c99-panel"><header class="c99-panel__header"><span>Roster (${S.players.length}/${S.maxPlayers})</span><span class="c99-panel__caret" aria-hidden="true"></span></header>
    <div class="c99-panel__body">${rows || '<p class="app-note">Nobody yet. Be the first.</p>'}
    <p class="app-note">${S.phase === 'locked' ? 'Locked. Picks are final.' : S.showPicks && S.showGroup ? "Everyone's picks are on the Group tab." : 'Picks are hidden for now.'}</p></div></div>`;
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

  const locked = S.phase === 'locked';
  // The Group page can be hidden by the host (admin switch). Entries are untouched; it just isn't shown.
  if (!S.showGroup && view === 'group') view = locked ? 'payouts' : 'picks';
  if (locked && view === 'picks') view = S.showGroup ? 'group' : 'payouts';
  const tabs = document.querySelectorAll('[data-view]');
  tabs.forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
    if (b.dataset.view === 'picks') b.hidden = locked;
    if (b.dataset.view === 'group') b.hidden = !S.showGroup;
  });

  $('stake').textContent = formatMoney(stake());
  $('stake-note').textContent = `${formatMoney(stake())} on every team that turns out to be on. Most you can lose: ${formatMoney(maxAtRisk())}.`;
  const board = boardFor();
  $('scoreboard').innerHTML = scoreboard(board);
  $('lockbar').innerHTML = lockBar();
  renderHost();
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
  if (!b || S.phase === 'locked') return;
  const { team, side } = b.dataset;
  const next = S.me.picks[team] === side ? null : side;
  if (next) S.me.picks[team] = next; else delete S.me.picks[team];
  S.me.ready = false; // the server drops you off the ready list when a pick changes
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

$('lockbar').addEventListener('click', async (e) => {
  const b = e.target.closest('#ready');
  if (!b || b.disabled) return;
  try { await api('POST', '/api/ready', { ready: !S.me.ready }); } catch (ex) { say(ex.message); }
  load();
});

// ---- host: lock everyone in ----
function renderHost() {
  const show = view === 'group' && S.phase === 'open';
  $('host').hidden = !show;
  if (!show) return;
  const ready = S.players.filter((p) => p.ready).length;
  const waiting = S.players.filter((p) => !p.ready).map((p) => p.name);
  $('host-status').textContent = `${ready} of ${S.players.length} ready${waiting.length ? `. Waiting on ${waiting.join(', ')}.` : '. Everyone is ready.'}`;
}

$('hostpw').value = session.get(HOSTPW_KEY) ?? '';
$('host-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('host-error');
  err.hidden = true;
  const pw = $('hostpw').value;
  const res = await fetch('/api/admin/lock', { method: 'POST', headers: { 'x-admin-password': pw } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { err.textContent = data.error || 'Could not lock.'; err.hidden = false; return; }
  session.set(HOSTPW_KEY, pw);
  load(); // the server also pushes the change to everyone's screen
});

// ---- the lock-in moment ----
function startLockAnimation() {
  const n = S.lines.length;
  if (S.showGroup) view = 'group';
  lockAnimUntil = Date.now() + n * CARD_STAGGER_MS + 1000;
  const banner = $('lockbanner');
  $('lockbanner-n').textContent = `${n} Teams`;
  setTimeout(() => { banner.hidden = false; thunk(); }, n * CARD_STAGGER_MS + 450);
  setTimeout(() => { banner.hidden = true; }, n * CARD_STAGGER_MS + 3200);
  setTimeout(() => document.querySelectorAll('.is-locking').forEach((el) => el.classList.remove('is-locking')), n * CARD_STAGGER_MS + 1100);
  for (let i = 0; i < n; i += 1) setTimeout(() => blip(i), i * CARD_STAGGER_MS + 120);
}

// Tiny WebAudio clicks, no audio files. Off unless the player turns it on.
function ensureAudio() {
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  }
  if (audioCtx?.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function tone(freq, ms, vol, type = 'square') {
  if (!soundOn || !audioCtx || audioCtx.state !== 'running') return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + ms / 1000);
}
const blip = (i) => tone(900 + (i % 6) * 60, 40, 0.04);
const thunk = () => tone(80, 320, 0.12, 'sawtooth');

function paintSound() {
  const b = $('soundtoggle');
  b.textContent = `Sound: ${soundOn ? 'on' : 'off'}`;
  b.setAttribute('aria-pressed', String(soundOn));
}
$('soundtoggle').addEventListener('click', () => {
  soundOn = !soundOn;
  store.set(SOUND_KEY, soundOn ? '1' : '0');
  if (soundOn) { ensureAudio(); tone(900, 60, 0.05); }
  paintSound();
});
document.addEventListener('pointerdown', () => { if (soundOn) ensureAudio(); }, { once: true });
paintSound();

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
