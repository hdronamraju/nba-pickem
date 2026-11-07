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

// Games played per team (wins + losses), used to project a full-season pace.
export function parseGames(json) {
  const games = {};
  for (const group of json?.children ?? []) {
    for (const entry of group?.standings?.entries ?? []) {
      const name = entry?.team?.displayName;
      const stats = entry?.stats ?? [];
      const w = stats.find((s) => s.name === 'wins');
      const l = stats.find((s) => s.name === 'losses');
      if (name && w && l && Number.isFinite(Number(w.value)) && Number.isFinite(Number(l.value))) {
        games[name] = Number(w.value) + Number(l.value);
      }
    }
  }
  return games;
}

export async function fetchStandings(expectedTeams, fetchImpl = fetch) {
  const res = await fetchImpl(ESPN_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
  const json = await res.json();
  const wins = parseStandings(json);
  const missing = expectedTeams.filter((t) => !(t in wins));
  if (missing.length) throw new Error(`ESPN standings missing: ${missing.join(', ')}`);
  return { wins, games: parseGames(json) };
}

export async function fetchWins(expectedTeams, fetchImpl = fetch) {
  return (await fetchStandings(expectedTeams, fetchImpl)).wins;
}

// ESPN scoreboard -> today's games: [{ id, state: 'pre'|'in'|'post', detail, home, away, homeScore, awayScore }].
export const ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard';

export function parseScoreboard(json) {
  const games = [];
  for (const ev of json?.events ?? []) {
    const comp = ev?.competitions?.[0];
    const home = (comp?.competitors ?? []).find((c) => c.homeAway === 'home');
    const away = (comp?.competitors ?? []).find((c) => c.homeAway === 'away');
    const h = home?.team?.displayName;
    const a = away?.team?.displayName;
    if (!h || !a) continue;
    const type = ev?.status?.type ?? comp?.status?.type ?? {};
    const state = ['pre', 'in', 'post'].includes(type.state) ? type.state : 'pre';
    const score = (c) => (c?.score !== undefined && Number.isFinite(Number(c.score)) ? Number(c.score) : null);
    games.push({
      id: String(ev.id ?? `${a}@${h}`), state, detail: String(type.shortDetail ?? type.detail ?? ''),
      home: h, away: a, homeScore: score(home), awayScore: score(away),
    });
  }
  return games;
}

export async function fetchScoreboard(fetchImpl = fetch) {
  const res = await fetchImpl(ESPN_SCOREBOARD_URL, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`ESPN responded ${res.status}`);
  return parseScoreboard(await res.json());
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
