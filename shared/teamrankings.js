// TeamRankings' projected final standings -> { [teamDisplayName]: projectedWins }.
// There is no official API, so this reads their public HTML table; keep it isolated, like espn.js.
// robots.txt allows the page (Crawl-delay: 10); the server fetches it about once a day.
export const TR_URL = 'https://www.teamrankings.com/nba/projections/standings/';
const USER_AGENT = 'nba-pickem/1.0 (friends win-total league; one fetch a day)';

const slug = (n) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const ALIAS = { 'los-angeles-clippers': 'la-clippers' }; // TeamRankings spells it out; ESPN and our list say "LA"

/** Rows look like: <a href="/nba/team/<slug>/projections">City</a> then cells: W, L, projected W, projected L, ... */
export function parseProjections(html, teamNames) {
  const bySlug = Object.fromEntries(teamNames.map((n) => [slug(n), n]));
  const out = {};
  const rows = String(html).matchAll(/<tr>\s*<td><a href="\/nba\/team\/([a-z0-9-]+)\/projections">[^<]*<\/a><\/td>([\s\S]*?)<\/tr>/g);
  for (const m of rows) {
    const name = bySlug[ALIAS[m[1]] ?? m[1]];
    if (!name) continue;
    const cells = [...m[2].matchAll(/<td[^>]*>\s*([^<]*?)\s*<\/td>/g)].map((c) => c[1]);
    const w = Number(cells[2]);
    if (cells.length >= 4 && cells[2] !== '' && Number.isFinite(w) && w >= 0 && w <= 82) out[name] = w;
  }
  return out;
}

export async function fetchProjections(expectedTeams, fetchImpl = fetch) {
  const res = await fetchImpl(TR_URL, { headers: { 'user-agent': USER_AGENT, accept: 'text/html' } });
  if (!res.ok) throw new Error(`TeamRankings responded ${res.status}`);
  const proj = parseProjections(await res.text(), expectedTeams);
  const missing = expectedTeams.filter((t) => !(t in proj));
  if (missing.length) throw new Error(`TeamRankings projections missing: ${missing.join(', ')}`);
  return proj;
}
