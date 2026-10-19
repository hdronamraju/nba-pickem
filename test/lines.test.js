import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, linesToText } from '../shared/lines.js';
import { TEAMS } from '../shared/teams.js';

const full = (over = {}) => TEAMS.map((t) => `${t.team}, ${over[t.team] ?? t.line}`).join('\n');

test('the default lines round-trip through text', () => {
  const { lines, errors } = parseLines(linesToText(TEAMS));
  assert.deepEqual(errors, []);
  assert.deepEqual(lines, TEAMS);
});

test('nicknames, separators, tables, comments and blank lines all parse', () => {
  const table = TEAMS.map((t) => `|**${t.team}**|${t.line}|`).join('\n');
  assert.deepEqual(parseLines(`# win totals\n\n${table}\n`).errors, []);
  assert.deepEqual(parseLines(TEAMS.map((t) => `${t.team}\t${t.line}`).join('\n')).errors, []);
  const explicit = parseLines(`${full()}\nThunder 50.5`);
  assert.match(explicit.errors[0].message, /listed twice/);
  const nick = parseLines(full().replace('Oklahoma City Thunder, 61.5', 'Thunder 61.5').replace('Portland Trail Blazers', 'Blazers').replace('Philadelphia 76ers', 'Sixers'));
  assert.deepEqual(nick.errors, []);
  assert.equal(nick.lines.find((l) => l.team === 'Portland Trail Blazers').line, 41.5);
});

test('uses canonical names and sorts by line', () => {
  const { lines } = parseLines(full({ 'Sacramento Kings': 70.5 }));
  assert.equal(lines[0].team, 'Sacramento Kings');
  assert.equal(lines[0].line, 70.5);
});

test('reports unknown, duplicate, whole-number and missing teams', () => {
  const bad = parseLines(`${full().split('\n').slice(2).join('\n')}\nGotham Knights, 40.5\nMiami Heat, 45`);
  const msgs = bad.errors.map((e) => e.message).join(' | ');
  assert.equal(bad.lines, null);
  assert.match(msgs, /Unknown team "Gotham Knights"/);
  assert.match(msgs, /Miami Heat: the line must end in \.5/);
  assert.match(msgs, /Missing 2 teams: Oklahoma City Thunder, San Antonio Spurs/);
  assert.equal(parseLines('Thunder').errors[0].line, 1);
});
