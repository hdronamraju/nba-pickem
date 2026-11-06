import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProjections, fetchProjections } from '../shared/teamrankings.js';

const row = (slug, city, cells) => `<tbody><tr>
  <td><a href="/nba/team/${slug}/projections">${city}</a></td>
  ${cells.map((c) => `<td class="text-right nowrap">${c}</td>`).join('\n')}
</tr></tbody>`;
const html = `<table>
${row('philadelphia-76ers', 'Philadelphia', ['8', '1', '55.0', '27.0', '98.6%', '49.3%', '30.1%', '14.5%'])}
${row('los-angeles-clippers', 'LA Clippers', ['3', '5', '38.4', '43.6', '40.0%', '9.0%', '1.0%', '0.5%'])}
${row('boston-celtics', 'Boston', ['6', '2', '', '30.7', '94.5%', '10%', '5%', '2%'])}
${row('some-other-team', 'Elsewhere', ['1', '1', '41.0', '41.0', '50%', '5%', '2%', '1%'])}
</table>`;
const names = ['Philadelphia 76ers', 'LA Clippers', 'Boston Celtics'];

test('parseProjections reads projected wins by team link, mapping the Clippers alias and skipping bad rows', () => {
  assert.deepEqual(parseProjections(html, names), { 'Philadelphia 76ers': 55, 'LA Clippers': 38.4 });
});

test('fetchProjections returns the table, and rejects incomplete or failed responses so last good data is kept', async () => {
  const ok = async () => ({ ok: true, text: async () => html });
  await assert.rejects(fetchProjections(names, ok), /missing: Boston Celtics/);
  assert.deepEqual(await fetchProjections(['Philadelphia 76ers'], ok), { 'Philadelphia 76ers': 55 });
  await assert.rejects(fetchProjections([], async () => ({ ok: false, status: 503 })), /503/);
  let sent;
  await fetchProjections(['Philadelphia 76ers'], async (_url, init) => { sent = init.headers; return { ok: true, text: async () => html }; });
  assert.match(sent['user-agent'], /^nba-pickem/); // says who we are
});
