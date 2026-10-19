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

// For the admin "Check ESPN" button: what did ESPN actually send? (Used to verify we read the right numbers.)
export async function fetchRaw(team = 'Boston Celtics', fetchImpl = fetch) {
  const res = await fetchImpl(ESPN_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
  const json = await res.json();
  const group = (json.children ?? [])[0]?.standings ?? {};
  let entry = null;
  for (const g of json.children ?? []) {
    entry = (g.standings?.entries ?? []).find((e) => e.team?.displayName === team) ?? entry;
  }
  return {
    url: ESPN_URL,
    topLevelKeys: Object.keys(json),
    seasonInfo: {
      seasonDisplayName: group.seasonDisplayName ?? null, season: group.season ?? null,
      seasonType: group.seasonType ?? null, links: undefined,
    },
    team: entry?.team?.displayName ?? null,
    stats: (entry?.stats ?? []).map((s) => ({ name: s.name, displayValue: s.displayValue ?? null, value: s.value ?? null })),
  };
}
