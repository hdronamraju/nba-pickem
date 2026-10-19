import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStandings, fetchWins, fetchRaw } from '../shared/espn.js';

// Shape modelled on ESPN's standings response (children[] -> standings.entries[] -> stats[]).
const fixture = {
  children: [
    { name: 'Eastern Conference', standings: { entries: [
      { team: { displayName: 'Boston Celtics' }, stats: [{ name: 'losses', value: 3 }, { name: 'wins', value: 7 }] },
      { team: { displayName: 'Miami Heat' }, stats: [{ name: 'wins', value: 0 }] },
    ] } },
    { name: 'Western Conference', standings: { entries: [
      { team: { displayName: 'LA Clippers' }, stats: [{ name: 'wins', value: 5 }] },
      { team: { displayName: 'Broken' }, stats: [] },
    ] } },
  ],
};

test('parseStandings reads wins per team and skips malformed entries', () => {
  assert.deepEqual(parseStandings(fixture), { 'Boston Celtics': 7, 'Miami Heat': 0, 'LA Clippers': 5 });
  assert.deepEqual(parseStandings({}), {});
});

test('fetchWins rejects an incomplete table so stale data is kept', async () => {
  const ok = async () => ({ ok: true, json: async () => fixture });
  await assert.rejects(fetchWins(['Boston Celtics', 'Utah Jazz'], ok), /missing: Utah Jazz/);
  assert.deepEqual(await fetchWins(['Boston Celtics'], ok), { 'Boston Celtics': 7, 'Miami Heat': 0, 'LA Clippers': 5 });
  await assert.rejects(fetchWins([], async () => ({ ok: false, status: 503 })), /503/);
});

test('fetchRaw returns the raw stat list for one team plus the season info', async () => {
  const json = { children: [{ standings: { seasonDisplayName: '2026-27', seasonType: 2, entries: [
    { team: { displayName: 'Boston Celtics' }, stats: [{ name: 'wins', value: 4, displayValue: '4' }, { name: 'losses', value: 0 }] },
  ] } }] };
  const raw = await fetchRaw('Boston Celtics', async () => ({ ok: true, json: async () => json }));
  assert.equal(raw.team, 'Boston Celtics');
  assert.equal(raw.seasonInfo.seasonDisplayName, '2026-27');
  assert.deepEqual(raw.stats.map((s) => s.name), ['wins', 'losses']);
});
