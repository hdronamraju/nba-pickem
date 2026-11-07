import test from 'node:test';
import assert from 'node:assert/strict';
import { rootingGuide, buildReport, makeSnapshot } from '../shared/rooting.js';

const mk = (name, picks) => ({ id: name.toLowerCase(), name, picks });
const lines = [{ team: 'Celtics', line: 50.5 }, { team: 'Heat', line: 40.5 }, { team: 'Nets', line: 30.5 }];
const players = [
  mk('Al', { Celtics: 'over', Heat: 'under', Nets: 'over' }),
  mk('Bo', { Celtics: 'under', Heat: 'over', Nets: 'over' }), // Nets: nobody under, so that bet is OFF
];
const game = (home, away, extra = {}) => ({ id: `${away}@${home}`, state: 'pre', detail: '7:30 PM', home, away, ...extra });

test('root for your Over team and against your Under team', () => {
  const g = rootingGuide({ lines, players, meId: 'al', cents: 1000, schedule: [game('Celtics', 'Heat')] })[0];
  assert.equal(g.pick, 'Celtics'); // Al: Celtics over (win helps) and Heat under (loss helps)
  assert.equal(g.against, 'Heat');
  assert.equal(g.reasons.length, 2);
});

test('flips for the player on the other side', () => {
  const g = rootingGuide({ lines, players, meId: 'bo', cents: 1000, schedule: [game('Celtics', 'Heat')] })[0];
  assert.equal(g.pick, 'Heat');
});

test('OFF bets and unrelated teams give no preference', () => {
  const [a, b] = rootingGuide({ lines, players, meId: 'al', cents: 1000, schedule: [game('Nets', 'Lakers'), game('Lakers', 'Kings')] });
  assert.equal(a.pick, null);
  assert.equal(b.pick, null);
});

test('own bets that cancel out show no preference; finished games are dropped', () => {
  const both = [mk('Al', { Celtics: 'over', Heat: 'over' }), mk('Bo', { Celtics: 'under', Heat: 'under' })];
  const out = rootingGuide({ lines, players: both, meId: 'al', cents: 1000, schedule: [game('Celtics', 'Heat'), game('Celtics', 'Heat', { state: 'post' })] });
  assert.equal(out.length, 1);
  assert.equal(out[0].pick, null);
});

test('bubble teams outrank long shots, and reasons say who is winning', () => {
  const wins = { Celtics: 30, Heat: 10 }; const games = { Celtics: 50, Heat: 50 }; // paces 49.2 and 16.4
  const out = rootingGuide({ lines, players, meId: 'al', wins, games, cents: 1000, schedule: [game('Heat', 'Lakers'), game('Celtics', 'Kings')] });
  assert.equal(out[0].home, 'Celtics'); // 49.2 vs 50.5: close; Heat at 16.4 vs 40.5 is out of reach
  assert.equal(out[0].reasons[0].ahead, 'under');
  assert.ok(Math.abs(out[0].reasons[0].projected - 49.2) < 0.1);
});

test('report ranks on pace and compares with the daily snapshot', () => {
  const wins = { Celtics: 30, Heat: 10, Nets: 5 }; const games = { Celtics: 40, Heat: 40, Nets: 40 }; // Celtics 61.5, Heat 20.5
  const input = { lines, players, wins, games, cents: 1000 };
  const old = makeSnapshot({ ...input, wins: { Celtics: 20, Heat: 10, Nets: 5 } }, '2026-11-04'); // Celtics 41 then: under
  const r = buildReport({ ...input, history: [old], today: '2026-11-05' });
  assert.equal(r.ready, true);
  assert.equal(r.dayFrom, '2026-11-04');
  assert.equal(r.players[0].name, 'Al'); // Al has Celtics over and Heat under: both going his way
  assert.equal(r.players[0].net, 2000);
  assert.equal(r.players[0].day, 2000 - old.nets.al);
  const celtics = r.teams.find((t) => t.team === 'Celtics');
  assert.equal(celtics.flippedDay, true);
  assert.equal(celtics.leader, 'over');
  assert.equal(r.teams[0].team, 'Celtics'); // flips sort first
  assert.ok(Math.abs(celtics.projected - 61.5) < 0.1);
});

test('report is not ready without win totals', () => {
  assert.equal(buildReport({ lines, players, wins: {}, games: {}, cents: 1000, today: '2026-11-05' }).ready, false);
});

test('a published projection overrides the raw pace, for the guide, the snapshot and the report', () => {
  // 3-0 team paces to 82 wins, but the projection says 45: that is under the 50.5 line.
  const wins = { Celtics: 3 }; const games = { Celtics: 3 }; const projections = { Celtics: 45 };
  const g = rootingGuide({ lines, players, meId: 'al', wins, games, projections, cents: 1000, schedule: [game('Celtics', 'Lakers')] })[0];
  assert.equal(g.pick, 'Celtics'); // Al has Celtics over: he still needs them to win, even though they project short
  assert.equal(g.reasons[0].ahead, 'under'); // ...and the projection says he is losing that bet right now
  assert.equal(makeSnapshot({ lines, players, wins, games, projections, cents: 1000 }, '2026-11-05').leaders.Celtics, 'under');
  assert.equal(makeSnapshot({ lines, players, wins, games, cents: 1000 }, '2026-11-05').leaders.Celtics, 'over'); // no projection: pace
  const r = buildReport({ lines, players, wins, games, projections, cents: 1000, today: '2026-11-05' });
  assert.equal(r.teams.find((t) => t.team === 'Celtics').projected, 45);
});
