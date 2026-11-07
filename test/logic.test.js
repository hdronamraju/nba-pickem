import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBoard, parseDollars, formatMoney, projectWins, expectedWins } from '../shared/logic.js';

const mk = (name, picks) => ({ id: name.toLowerCase(), name, picks });

test('spec example 1: split picks, over wins -> $10 each to the winners', () => {
  const players = [
    mk('Andrew', { Wiz: 'over' }), mk('Ben', { Wiz: 'over' }),
    mk('Chris', { Wiz: 'under' }), mk('Doug', { Wiz: 'under' }),
  ];
  const b = computeBoard({ lines: [{ team: 'Wiz', line: 34.5 }], players, wins: { Wiz: 40 }, cents: 500 });
  const t = b.teams[0];
  assert.equal(t.on, true);
  assert.equal(t.pool, 2000);
  assert.deepEqual(t.payouts, { andrew: 1000, ben: 1000 });
  assert.equal(b.players.find((p) => p.name === 'Andrew').net, 500);
  assert.equal(b.players.find((p) => p.name === 'Chris').net, -500);
});

test('spec example 2: one lone over takes the whole $50 pool', () => {
  const names = ['Andrew', 'Ben', 'Chris', 'Doug', 'Emily', 'Frank', 'Greg', 'Harsha', 'Isabel'];
  const players = [...names.map((n) => mk(n, { Bucks: 'under' })), mk('Jeh', { Bucks: 'over' })];
  const b = computeBoard({ lines: [{ team: 'Bucks', line: 25.5 }], players, wins: { Bucks: 30 }, cents: 500 });
  assert.equal(b.teams[0].pool, 5000);
  assert.deepEqual(b.teams[0].payouts, { jeh: 5000 });
  assert.equal(b.players[0].name, 'Jeh');
  assert.equal(b.players[0].net, 4500);
});

test('spec example 3: nobody under -> bet is off, no money moves', () => {
  const players = ['Andrew', 'Ben', 'Chris', 'Doug'].map((n) => mk(n, { Suns: 'over' }));
  const b = computeBoard({ lines: [{ team: 'Suns', line: 39.5 }], players, wins: { Suns: 20 }, cents: 500 });
  assert.equal(b.teams[0].on, false);
  assert.equal(b.teams[0].pool, 0);
  assert.equal(b.teams[0].leader, null);
  assert.ok(b.players.every((p) => p.net === 0 && p.staked === 0));
});

test('under wins when wins are below the line', () => {
  const players = [mk('A', { X: 'over' }), mk('B', { X: 'under' })];
  const b = computeBoard({ lines: [{ team: 'X', line: 40.5 }], players, wins: { X: 40 }, cents: 500 });
  assert.equal(b.teams[0].leader, 'under');
  assert.deepEqual(b.teams[0].payouts, { b: 1000 });
});

test('leftover cents go to winners alphabetically, total is conserved', () => {
  const players = [mk('Cy', { X: 'over' }), mk('Al', { X: 'over' }), mk('Bo', { X: 'over' }), mk('Di', { X: 'under' })];
  const b = computeBoard({ lines: [{ team: 'X', line: 10.5 }], players, wins: { X: 50 }, cents: 333 });
  const { payouts, pool } = b.teams[0];
  assert.equal(pool, 1332);
  assert.equal(Object.values(payouts).reduce((a, c) => a + c, 0), pool);
  assert.deepEqual(payouts, { al: 444, bo: 444, cy: 444 });
  const odd = computeBoard({ lines: [{ team: 'X', line: 10.5 }], players, wins: { X: 50 }, cents: 335 });
  assert.equal(Object.values(odd.teams[0].payouts).reduce((a, c) => a + c, 0), 1340);
  assert.equal(odd.teams[0].payouts.al, 447);
});

test('no win total yet: bet can be on but has no leader', () => {
  const players = [mk('A', { X: 'over' }), mk('B', { X: 'under' })];
  const b = computeBoard({ lines: [{ team: 'X', line: 40.5 }], players, wins: {}, cents: 500 });
  assert.equal(b.teams[0].on, true);
  assert.equal(b.teams[0].pool, 1000);
  assert.equal(b.teams[0].leader, null);
  assert.equal(b.players[0].net, 0);
});

test('parseDollars / formatMoney', () => {
  assert.equal(parseDollars('5'), 500);
  assert.equal(parseDollars('$2.50'), 250);
  assert.equal(parseDollars('0'), 0);
  assert.equal(parseDollars(''), null);
  assert.equal(parseDollars('-3'), null);
  assert.equal(parseDollars('1.234'), null);
  assert.equal(parseDollars('abc'), null);
  assert.equal(formatMoney(1250), '$12.50');
  assert.equal(formatMoney(500), '$5');
  assert.equal(formatMoney(450, { signed: true }), '+$4.50');
  assert.equal(formatMoney(-500, { signed: true }), '-$5');
  assert.equal(formatMoney(0, { signed: true }), '$0');
});

import { playerRanges } from '../shared/logic.js';

test('playerRanges: spec example 1 (2 over, 2 under at $5)', () => {
  const players = [
    mk('Andrew', { Wiz: 'over' }), mk('Ben', { Wiz: 'over' }),
    mk('Chris', { Wiz: 'under' }), mk('Doug', { Wiz: 'under' }),
  ];
  const r = playerRanges({ lines: [{ team: 'Wiz', line: 34.5 }], players, cents: 500 });
  assert.deepEqual(r.map((p) => [p.name, p.best, p.worst, p.teamsOn]), [
    ['Andrew', 500, -500, 1], ['Ben', 500, -500, 1], ['Chris', 500, -500, 1], ['Doug', 500, -500, 1],
  ]);
});

test('playerRanges: a lone wolf stands to win far more than the crowd (spec example 2)', () => {
  const names = ['Andrew', 'Ben', 'Chris', 'Doug', 'Emily', 'Frank', 'Greg', 'Harsha', 'Isabel'];
  const players = [...names.map((n) => mk(n, { Bucks: 'under' })), mk('Jeh', { Bucks: 'over' })];
  const r = playerRanges({ lines: [{ team: 'Bucks', line: 25.5 }], players, cents: 500 });
  const jeh = r.find((p) => p.name === 'Jeh');
  const crowd = r.find((p) => p.name === 'Ben');
  assert.equal(jeh.best, 4500); // $50 pool minus his $5
  assert.equal(crowd.best, Math.floor(5000 / 9) - 500); // $55.55 share minus $5
  assert.equal(jeh.worst, -500);
  assert.equal(r[0].name, 'Jeh');
});

test('playerRanges: OFF teams and unpicked teams risk nothing; bests and worsts add up across teams', () => {
  const lines = [{ team: 'A', line: 1.5 }, { team: 'B', line: 2.5 }, { team: 'C', line: 3.5 }];
  const players = [mk('X', { A: 'over', B: 'over', C: 'over' }), mk('Y', { A: 'under', B: 'over' })];
  const [x] = playerRanges({ lines, players, cents: 1000 }).filter((p) => p.name === 'X');
  assert.deepEqual([x.best, x.worst, x.teamsOn], [1000, -1000, 1]); // only A is ON; B and C are all-over
  assert.deepEqual(playerRanges({ lines: [], players, cents: 1000 }).map((p) => p.best), [0, 0]);
});

test('projectWins scales wins to an 82-game pace and skips teams with no games', () => {
  const p = projectWins({ A: 3, B: 1, C: 0 }, { A: 3, B: 2, C: 0 });
  assert.equal(p.A, 82);
  assert.equal(p.B, 41);
  assert.equal('C' in p, false);
  const players = [mk('Al', { A: 'over' }), mk('Bo', { A: 'under' })];
  const b = computeBoard({ lines: [{ team: 'A', line: 45.5 }], players, wins: p, cents: 500 });
  assert.equal(b.teams[0].leader, 'over'); // 3-0 start paces past the line, though 3 wins is nowhere near 45.5
});

test('expectedWins prefers a published projection and falls back to pace', () => {
  const e = expectedWins({ A: 3, B: 1 }, { A: 3, B: 2 }, { A: 45.5, C: 60, D: NaN });
  assert.equal(e.A, 45.5);
  assert.equal(e.B, 41);
  assert.equal(e.C, 60);
  assert.equal('D' in e, false);
});
