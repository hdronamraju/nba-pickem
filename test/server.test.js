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
  const call = async (method, url, body, token) => {
    const res = await fetch(base + url, {
      method, headers: { 'content-type': 'application/json', ...(token ? { 'x-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const join = async (name) => (await call('POST', '/api/join', { name })).body.token;
  const pickAll = async (token, side) => { for (const t of TEAMS) await call('PUT', '/api/picks', { team: t.team, side }, token); };
  return { app, call, join, pickAll, close: () => app.server.close() };
}

test('30 teams are seeded', () => assert.equal(TEAMS.length, 30));

test('join validates names and rejects duplicates', async (t) => {
  const s = await boot(); t.after(s.close);
  assert.equal((await s.call('POST', '/api/join', { name: '  ' })).status, 400);
  assert.equal((await s.call('POST', '/api/join', { name: 'Harsha' })).status, 201);
  assert.equal((await s.call('POST', '/api/join', { name: 'harsha' })).status, 409);
});

test('picks cannot change after lock, and lock needs all 30', async (t) => {
  const s = await boot(); t.after(s.close);
  const tok = await s.join('Ana');
  assert.equal((await s.call('POST', '/api/lock', null, tok)).status, 400);
  await s.pickAll(tok, 'over');
  assert.equal((await s.call('POST', '/api/lock', null, tok)).status, 200);
  const change = await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'under' }, tok);
  assert.equal(change.status, 403);
  assert.equal((await s.call('GET', '/api/state', null, tok)).body.me.picks[TEAMS[0].team], 'over');
});

test('other players picks stay hidden until you lock; tokens never leak', async (t) => {
  const s = await boot(); t.after(s.close);
  const [a, b] = [await s.join('Ana'), await s.join('Bo')];
  await s.pickAll(a, 'over'); await s.pickAll(b, 'under');
  await s.call('POST', '/api/lock', null, a);

  const beforeB = (await s.call('GET', '/api/state', null, b)).body;
  assert.equal(beforeB.revealed, null);
  assert.equal(JSON.stringify(beforeB).includes(a), false);

  await s.call('POST', '/api/lock', null, b);
  const afterB = (await s.call('GET', '/api/state', null, b)).body;
  assert.equal(afterB.revealed.length, 2);
  assert.equal(JSON.stringify(afterB).includes(a), false);
  assert.equal((await s.call('GET', '/api/state')).body.revealed, null);
});

test('unknown token and bad picks are rejected', async (t) => {
  const s = await boot(); t.after(s.close);
  assert.equal((await s.call('PUT', '/api/picks', { team: 'X', side: 'over' }, 'nope')).status, 401);
  const tok = await s.join('Ana');
  assert.equal((await s.call('PUT', '/api/picks', { team: 'Not A Team', side: 'over' }, tok)).status, 400);
  assert.equal((await s.call('PUT', '/api/picks', { team: TEAMS[0].team, side: 'maybe' }, tok)).status, 400);
});

test('board is capped at 10 players', async (t) => {
  const s = await boot(); t.after(s.close);
  for (let i = 0; i < 10; i++) assert.equal((await s.call('POST', '/api/join', { name: `P${i}` })).status, 201);
  assert.equal((await s.call('POST', '/api/join', { name: 'Extra' })).status, 409);
});

test('wins refresh keeps last good data when the fetch fails', async (t) => {
  let fail = false; let clock = 0;
  const s = await boot({ now: () => clock, fetchWins: async () => { if (fail) throw new Error('boom'); return { 'Miami Heat': 3 }; } });
  t.after(s.close);
  await s.app.refreshWins();
  assert.equal(s.app.state().wins['Miami Heat'], 3);
  fail = true; clock += 23 * 3_600_000;
  await s.app.refreshWins();
  assert.equal(s.app.state().wins['Miami Heat'], 3);
  assert.equal(s.app.state().winsMeta.error, 'boom');
});
