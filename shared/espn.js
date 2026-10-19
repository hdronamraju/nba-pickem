// ESPN standings -> { [teamDisplayName]: wins }. ESPN has no official API, so keep this isolated.
export const ESPN_URL = 'https://site.api.espn.com/apis/v2/sports/basketball/nba/standings';

export function parseStandings(json) {
  const wins = {};
  for (const group of json?.children ?? []) {
    for (const entry of group?.standings?.entries ?? []) {
      const name = entry?.team?.displayName;
      const stat = (entry?.stats ?? []).find((s) => s.name === 'wins');
      if (name && stat && Number.isFinite(Number(stat.value))) wins[name] = Number(stat.value);
    }
  }
  return wins;
}

export async function fetchWins(expectedTeams, fetchImpl = fetch) {
  const res = await fetchImpl(ESPN_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
  const wins = parseStandings(await res.json());
  const missing = expectedTeams.filter((t) => !(t in wins));
  if (missing.length) throw new Error(`ESPN standings missing: ${missing.join(', ')}`);
  return wins;
}
