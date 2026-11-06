// Who to root for, and the daily/weekly "who is in the money" report. Pure functions, used by the browser and tests.
// Money is integer cents. Projected wins come from TeamRankings, or a team's own 82-game pace when they have none (see expectedWins).
import { computeBoard, expectedWins } from './logic.js';


/** Which side of a line a projected win total is on, or null with no projection. */
export const sideOf = (projected, line) => (Number.isFinite(projected) ? (projected > line ? 'over' : 'under') : null);

/**
 * For each of today's games, which team should `meId` root for?
 * Only bets that are ON count. A bet pulls toward its team winning (Over) or losing (Under),
 * weighted by what you would collect and by how close the team's projected wins are to the line (a bubble team matters more).
 *
 * @returns [{ id, home, away, state, detail, pick: team|null, against: team|null, swing, reasons[] }] biggest swing first
 */
export function rootingGuide({ lines, players, meId, wins = {}, games = {}, projections = {}, cents, schedule = [] }) {
  const board = computeBoard({ lines, players, wins: {}, cents });
  const proj = expectedWins(wins, games, projections);
  const lineOf = Object.fromEntries(lines.map((l) => [l.team, l.line]));
  const stake = {}; // team -> { side, weight, line, projected }
  for (const t of board.teams) {
    if (!t.on) continue;
    const side = t.over.includes(meId) ? 'over' : t.under.includes(meId) ? 'under' : null;
    if (!side) continue;
    const mine = side === 'over' ? t.over.length : t.under.length;
    const closeness = Number.isFinite(proj[t.team]) ? 1 / (1 + Math.abs(proj[t.team] - lineOf[t.team]) / 5) : 0.5;
    stake[t.team] = { side, line: lineOf[t.team], projected: proj[t.team] ?? null, weight: Math.floor(t.pool / mine), closeness };
  }
  const pull = (team) => {
    const s = stake[team];
    return s ? (s.side === 'over' ? 1 : -1) * s.weight * s.closeness : 0;
  };

  return schedule
    .filter((g) => g.state !== 'post')
    .map((g) => {
      const util = pull(g.home) - pull(g.away); // > 0: a home win helps you
      const reasons = [g.home, g.away].filter((t) => stake[t]).map((t) => ({ team: t, ...stake[t], ahead: sideOf(stake[t].projected, stake[t].line) }));
      return {
        id: g.id, home: g.home, away: g.away, state: g.state, detail: g.detail,
        pick: util > 0 ? g.home : util < 0 ? g.away : null,
        against: util > 0 ? g.away : util < 0 ? g.home : null,
        swing: Math.abs(util), reasons,
      };
    })
    .sort((a, b) => b.swing - a.swing || a.home.localeCompare(b.home));
}

/** One day's record for the report: each player's projected net, and which side each ON team is projected to land on. */
export function makeSnapshot({ lines, players, wins, games, projections = {}, cents }, date) {
  const board = computeBoard({ lines, players, wins: expectedWins(wins, games, projections), cents });
  return {
    date,
    nets: Object.fromEntries(board.players.map((p) => [p.id, p.net])),
    leaders: Object.fromEntries(board.teams.filter((t) => t.on && t.leader).map((t) => [t.team, t.leader])),
  };
}

const dayNum = (d) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

/**
 * Standings on projected wins, compared with the last daily snapshot and the one about a week back.
 * `history` is [{ date, nets, leaders }] oldest first; `today` is 'YYYY-MM-DD'.
 */
export function buildReport({ lines, players, wins, games, projections = {}, cents, history = [], today }) {
  const proj = expectedWins(wins, games, projections);
  const board = computeBoard({ lines, players, wins: proj, cents });
  const earlier = history.filter((h) => h.date < today);
  const day = earlier.at(-1) ?? null;
  const week = earlier.find((h) => dayNum(today) - dayNum(h.date) <= 7 && h.date !== day?.date) ?? null;
  const delta = (base, id) => (base && id in base.nets ? board.players.find((p) => p.id === id).net - base.nets[id] : null);

  return {
    ready: board.teams.some((t) => t.leader),
    dayFrom: day?.date ?? null,
    weekFrom: week?.date ?? null,
    players: board.players.map((p) => ({ id: p.id, name: p.name, net: p.net, day: delta(day, p.id), week: delta(week, p.id) })),
    teams: board.teams.filter((t) => t.on).map((t) => ({
      team: t.team, line: t.line, wins: wins[t.team] ?? null, games: games[t.team] ?? null,
      projected: proj[t.team] ?? null, leader: t.leader, over: t.over, under: t.under,
      flippedDay: !!(day && t.leader && day.leaders?.[t.team] && day.leaders[t.team] !== t.leader),
      flippedWeek: !!(week && t.leader && week.leaders?.[t.team] && week.leaders[t.team] !== t.leader),
    })).sort((a, b) => Number(b.flippedDay) - Number(a.flippedDay) || Math.abs((a.projected ?? a.line) - a.line) - Math.abs((b.projected ?? b.line) - b.line)),
  };
}
