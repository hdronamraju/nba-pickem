import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.js';
import { TEAMS } from '../shared/teams.js';

async function boot(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickem-'));
  const app = createApp({ dataFile: path.join(dir, 'state.json'), ...opts });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://localhost:${app.server.address().port}`;
  const call = async (method, url, body, token, headers = {}) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const join = async (name) => (await call('POST', '/api/join', { name })).body.token;
  const pickAll = async (token, side) => { for (const t of TEAMS) await call('PUT', '/api/picks', { team: t.team, side }, token); };
  const ready = (token, r = true) => call('POST', '/api/ready', { ready: r }, token);
  const admin = { 'x-admin-password': 'pw' };
  const host = (method, url, body) => call(method, url, body, undefined, admin);
  return { app, base, call, join, pickAll, ready, host, close: () => app.server.close() };
}
const boot2 = async (t, opts) => { const s = await boot({ adminPassword: 'pw', ...opts }); t.after(s.close); return s; };
const lineText = (over = {}) => TEAMS.map((t) => `${t.team}, ${over[t.team] ?? t.line}`).join('\n');

test('30 teams are seeded', () => assert.equal(TEAMS.length, 30));

test('join validates names and rejects duplicates', async (t) => {
  const s = await boot2(t);
  assert.equal((await s.call('POST', '/api/join', { name: '  ' })).status, 400);
  assert.equal((await s.call('POST', '/api/join', { name: 'Harsha' })).status, 201);
  assert.equal((await s.call('POST', '/api/join', { name: 'harsha' })).status, 409);
});

test('board is capped at 10 players', async (t) => {
  const s = await boot2(t);
  for (let i = 0; i < 10; i++) assert.equal((await s.call('POST', '/api/join', { name: `P${i}` })).status, 201);
  assert.equal((await s.call('POST', '/api/join', { name: 'Extra' })).status, 409);
});

test('unknown token and bad picks are rejected', async (t) => {
  const s = await boot2(t);
  assert.equal((await s.call('PUT', '/api/picks', { team: 'X', side: 'over' }, 'nope')).status, 401);
  const tok = await s.join('Ana');
  assert.equal((await s.call('PUT', '/api/picks', { team: 'Not A Team', side: 'over' }, tok)).status, 400);
  assert.equal((await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'maybe' }, tok)).status, 400);
});

test('stake is fixed at $10 and comes from the server', async (t) => {
  const s = await boot2(t);
  assert.equal((await s.call('GET', '/api/state')).body.stakeCents, 1000);
});

test('ready needs all 30 picks, and changing a pick clears it', async (t) => {
  const s = await boot2(t);
  const tok = await s.join('Ana');
  assert.equal((await s.ready(tok)).status, 400);
  await s.pickAll(tok, 'over');
  assert.equal((await s.ready(tok)).status, 200);
  assert.equal((await s.call('GET', '/api/state', null, tok)).body.me.ready, true);
  await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'under' }, tok);
  assert.equal((await s.call('GET', '/api/state', null, tok)).body.me.ready, false);
  assert.equal((await s.ready(tok, 'yes')).status, 400);
});

test('live picks: joined players see everyone, visitors see nothing, tokens never leak', async (t) => {
  const s = await boot2(t);
  const [a, b] = [await s.join('Ana'), await s.join('Bo')];
  await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'over' }, a);

  const asBo = (await s.call('GET', '/api/state', null, b)).body;
  assert.equal(asBo.showPicks, true);
  assert.deepEqual(asBo.everyone.find((p) => p.name === 'Ana').picks, { [TEAMS[0].team]: 'over' });
  assert.equal(JSON.stringify(asBo).includes(a), false);
  assert.equal((await s.call('GET', '/api/state')).body.everyone, null);
});

test('with live picks off, picks stay hidden until the host locks', async (t) => {
  const s = await boot2(t);
  const [a, b] = [await s.join('Ana'), await s.join('Bo')];
  assert.equal((await s.host('PUT', '/api/admin/settings', { showPicks: false })).status, 200);
  await s.pickAll(a, 'over'); await s.pickAll(b, 'under');
  assert.equal((await s.call('GET', '/api/state', null, b)).body.everyone, null);
  await s.ready(a); await s.ready(b);
  assert.equal((await s.host('POST', '/api/admin/lock')).status, 200);
  const after = (await s.call('GET', '/api/state', null, b)).body;
  assert.equal(after.phase, 'locked');
  assert.equal(after.everyone.length, 2);
  assert.equal((await s.call('GET', '/api/state')).body.everyone, null);
});

test('only the host can lock, and only when 2+ players are all ready', async (t) => {
  const s = await boot2(t);
  const a = await s.join('Ana');
  assert.equal((await s.call('POST', '/api/admin/lock')).status, 401);
  assert.equal((await s.host('POST', '/api/admin/lock')).status, 409); // one player
  const b = await s.join('Bo');
  await s.pickAll(a, 'over'); await s.ready(a);
  const refused = await s.host('POST', '/api/admin/lock');
  assert.equal(refused.status, 409);
  assert.match(refused.body.error, /Waiting on Bo/);
  await s.pickAll(b, 'under'); await s.ready(b);
  assert.equal((await s.host('POST', '/api/admin/lock')).status, 200);
  assert.equal((await s.host('POST', '/api/admin/lock')).status, 409); // already locked
});

test('after the lock, picks and ready are frozen; unlock reopens them', async (t) => {
  const s = await boot2(t);
  const [a, b] = [await s.join('Ana'), await s.join('Bo')];
  await s.pickAll(a, 'over'); await s.pickAll(b, 'under'); await s.ready(a); await s.ready(b);
  await s.host('POST', '/api/admin/lock');

  assert.equal((await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'under' }, a)).status, 403);
  assert.equal((await s.ready(a, false)).status, 403);
  assert.equal((await s.call('GET', '/api/state', null, a)).body.me.picks[TEAMS[0].team], 'over');

  assert.equal((await s.host('POST', '/api/admin/unlock')).status, 200);
  assert.equal((await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'under' }, a)).status, 200);
});

test('admin is disabled without a password and rejects a wrong one', async (t) => {
  const off = await boot({ adminPassword: undefined }); t.after(off.close);
  assert.equal((await off.call('GET', '/api/admin/lines')).status, 503);
  const on = await boot2(t);
  const get = (pw) => fetch(on.base + '/api/admin/lines', { headers: { 'x-admin-password': pw } });
  assert.equal((await get('nope')).status, 401);
  assert.equal((await get('pw')).status, 200);
});

test('saved lines drive the board and survive a restart; they freeze at the lock and thaw on unlock', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickem-'));
  const dataFile = path.join(dir, 'state.json');
  const s = await boot2(t, { dataFile });
  const put = (text, source = 'Yahoo Sports') => s.host('PUT', '/api/admin/lines', { text, source });

  const bad = await put('Thunder 61');
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors.length > 1);

  assert.equal((await put(lineText({ 'Sacramento Kings': 33.5 }))).status, 200);
  const state = (await s.call('GET', '/api/state')).body;
  assert.equal(state.linesSource, 'Yahoo Sports');
  assert.equal(state.lines.find((l) => l.team === 'Sacramento Kings').line, 33.5);
  assert.equal(createApp({ dataFile }).state().lines.find((l) => l.team === 'Sacramento Kings').line, 33.5);

  const [a, b] = [await s.join('Ana'), await s.join('Bo')];
  await s.pickAll(a, 'over'); await s.pickAll(b, 'under'); await s.ready(a); await s.ready(b);
  await s.host('POST', '/api/admin/lock');
  assert.equal((await put(lineText())).status, 409);
  await s.host('POST', '/api/admin/unlock');
  assert.equal((await put(lineText())).status, 200);
});

test('admin can list and delete players; the name is freed and their token stops working', async (t) => {
  const s = await boot2(t);
  const ana = await s.join('Ana'); await s.join('Bo');
  await s.pickAll(ana, 'over'); await s.ready(ana);

  assert.equal((await s.call('GET', '/api/admin/players')).status, 401);
  const list = (await s.host('GET', '/api/admin/players')).body;
  assert.deepEqual(list.players.map((p) => [p.name, p.ready, p.picked]), [['Ana', true, 30], ['Bo', false, 0]]);
  assert.equal(JSON.stringify(list).includes(ana), false);

  const id = list.players[0].id;
  assert.equal((await s.call('DELETE', `/api/admin/players/${id}`)).status, 401);
  assert.equal((await s.host('DELETE', '/api/admin/players/abc123')).status, 404);
  assert.equal((await s.host('DELETE', `/api/admin/players/${id}`)).status, 200);

  assert.equal((await s.call('GET', '/api/state', null, ana)).body.me, null);
  assert.equal((await s.call('POST', '/api/join', { name: 'ana' })).status, 201);
});

test('old per-player locks migrate to ready and the game stays open', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickem-'));
  const dataFile = path.join(dir, 'state.json');
  fs.writeFileSync(dataFile, JSON.stringify({ players: [
    { id: 'aa', token: 't1', name: 'Old', picks: {}, lockedAt: 123, joinedAt: 1 },
    { id: 'bb', token: 't2', name: 'New', picks: {}, lockedAt: null, joinedAt: 2 },
  ] }));
  const app = createApp({ dataFile, adminPassword: 'pw' });
  const st = app.state();
  assert.deepEqual(st.players.map((p) => [p.name, p.ready, 'lockedAt' in p]), [['Old', true, false], ['New', false, false]]);
  assert.equal(st.phase, 'open');
  assert.equal(st.settings.showPicks, true);
});

test('wins refresh keeps last good data when the fetch fails', async (t) => {
  let fail = false; let clock = 0;
  const s = await boot2(t, { now: () => clock, fetchWins: async () => { if (fail) throw new Error('boom'); return { 'Miami Heat': 3 }; } });
  await s.app.refreshWins();
  assert.equal(s.app.state().wins['Miami Heat'], 3);
  fail = true; clock += 23 * 3_600_000;
  await s.app.refreshWins();
  assert.equal(s.app.state().wins['Miami Heat'], 3);
  assert.equal(s.app.state().winsMeta.error, 'boom');
});

test('every team sits in exactly one division, 5 per division, grouped A-Z', async () => {
  const { CONFERENCES, groupByDivision } = await import('../shared/teams.js');
  const all = CONFERENCES.flatMap((c) => c.divisions.flatMap((d) => d.teams));
  assert.equal(all.length, 30);
  assert.deepEqual([...new Set(all)].sort(), TEAMS.map((t) => t.team).sort());
  assert.ok(CONFERENCES.every((c) => c.divisions.length === 3 && c.divisions.every((d) => d.teams.length === 5)));
  const g = groupByDivision(TEAMS);
  assert.deepEqual(g.map((c) => c.conference), ['Eastern Conference', 'Western Conference']);
  const pacific = g[1].divisions.find((d) => d.name === 'Pacific').items.map((t) => t.team);
  assert.deepEqual(pacific, ['Golden State Warriors', 'LA Clippers', 'Los Angeles Lakers', 'Phoenix Suns', 'Sacramento Kings']);
});

test('win totals stay hidden until the host starts the season', async (t) => {
  const s = await boot2(t, { fetchWins: async () => ({ 'Boston Celtics': 4 }) });
  await s.app.refreshWins({ force: true });
  const before = (await s.call('GET', '/api/state')).body;
  assert.equal(before.seasonStarted, false);
  assert.deepEqual(before.wins, {});
  assert.equal((await s.host('PUT', '/api/admin/settings', { seasonStarted: true })).body.seasonStarted, true);
  assert.equal((await s.call('GET', '/api/state')).body.wins['Boston Celtics'], 4);
  assert.equal((await s.host('PUT', '/api/admin/settings', { seasonStarted: 'yes' })).status, 400);
  assert.equal((await s.host('PUT', '/api/admin/settings', { showPicks: false })).body.seasonStarted, true); // leaves the other setting alone
});

test('admin ESPN check needs the password and reports what ESPN sent', async (t) => {
  const s = await boot2(t, { fetchRaw: async () => ({ team: 'Boston Celtics', stats: [{ name: 'wins', value: 4 }] }) });
  assert.equal((await s.call('GET', '/api/admin/espn')).status, 401);
  assert.deepEqual((await s.host('GET', '/api/admin/espn')).body.stats, [{ name: 'wins', value: 4 }]);
  const bad = await boot2(t, { fetchRaw: async () => { throw new Error('nope'); } });
  assert.equal((await bad.host('GET', '/api/admin/espn')).status, 502);
});

test('the Group page is hidden by default, can be shown, and never touches entries', async (t) => {
  const s = await boot2(t);
  const a = await s.join('Ana'); await s.pickAll(a, 'over');
  assert.equal((await s.call('GET', '/api/state', null, a)).body.showGroup, false);
  assert.equal((await s.host('PUT', '/api/admin/settings', { showGroup: true })).body.showGroup, true);
  assert.equal((await s.call('GET', '/api/state', null, a)).body.showGroup, true);
  assert.equal((await s.host('PUT', '/api/admin/settings', { showGroup: false })).body.showGroup, false);
  const me = (await s.call('GET', '/api/state', null, a)).body.me;
  assert.equal(Object.keys(me.picks).length, 30); // entries intact
});
