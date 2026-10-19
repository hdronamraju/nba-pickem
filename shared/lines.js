// Parse the admin's plain-text list of win totals into [{ team, line }].
// One team per line: "Oklahoma City Thunder, 61.5", "Thunder 61.5", "Thunder: 61.5", or a pasted table row.
import { TEAMS } from './teams.js';

const NICKNAMES = {
  'Oklahoma City Thunder': ['Thunder', 'OKC'], 'San Antonio Spurs': ['Spurs'], 'New York Knicks': ['Knicks'],
  'Boston Celtics': ['Celtics'], 'Philadelphia 76ers': ['76ers', 'Sixers'], 'Detroit Pistons': ['Pistons'],
  'Denver Nuggets': ['Nuggets'], 'Cleveland Cavaliers': ['Cavaliers', 'Cavs'],
  'Minnesota Timberwolves': ['Timberwolves', 'Wolves'], 'Houston Rockets': ['Rockets'],
  'Toronto Raptors': ['Raptors'], 'Miami Heat': ['Heat'], 'Los Angeles Lakers': ['Lakers', 'LA Lakers'],
  'Indiana Pacers': ['Pacers'], 'Atlanta Hawks': ['Hawks'], 'Orlando Magic': ['Magic'],
  'Portland Trail Blazers': ['Trail Blazers', 'Blazers'], 'Phoenix Suns': ['Suns'],
  'Golden State Warriors': ['Warriors'], 'Charlotte Hornets': ['Hornets'], 'Utah Jazz': ['Jazz'],
  'Washington Wizards': ['Wizards'], 'Dallas Mavericks': ['Mavericks', 'Mavs'], 'Chicago Bulls': ['Bulls'],
  'Memphis Grizzlies': ['Grizzlies'], 'LA Clippers': ['Clippers', 'Los Angeles Clippers'],
  'New Orleans Pelicans': ['Pelicans'], 'Milwaukee Bucks': ['Bucks'], 'Brooklyn Nets': ['Nets'],
  'Sacramento Kings': ['Kings'],
};

const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_KEY = new Map();
for (const { team } of TEAMS) {
  for (const name of [team, ...(NICKNAMES[team] ?? [])]) BY_KEY.set(key(name), team);
}

export function parseLines(text) {
  const errors = [];
  const found = new Map(); // team -> line
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const n = i + 1;
    const cleaned = raw.replace(/[|*\t]/g, ' ').trim();
    if (!cleaned || cleaned.startsWith('#')) return;
    const m = cleaned.match(/^(.*?)[\s:,=-]*(\d+(?:\.\d+)?)\s*$/);
    if (!m || !m[1].trim()) { errors.push({ line: n, message: `Couldn't read "${raw.trim()}". Use "Team, 41.5".` }); return; }
    const team = BY_KEY.get(key(m[1]));
    if (!team) { errors.push({ line: n, message: `Unknown team "${m[1].trim()}".` }); return; }
    const line = Number(m[2]);
    if (!(line > 0 && line < 83) || line % 1 !== 0.5) { errors.push({ line: n, message: `${team}: the line must end in .5 (got ${m[2]}).` }); return; }
    if (found.has(team)) { errors.push({ line: n, message: `${team} is listed twice.` }); return; }
    found.set(team, line);
  });
  const missing = TEAMS.map((t) => t.team).filter((t) => !found.has(t));
  if (missing.length) errors.push({ line: null, message: `Missing ${missing.length} ${missing.length === 1 ? 'team' : 'teams'}: ${missing.join(', ')}.` });
  if (errors.length) return { lines: null, errors };
  const lines = [...found].map(([team, line]) => ({ team, line }))
    .sort((a, b) => b.line - a.line || a.team.localeCompare(b.team));
  return { lines, errors: [] };
}

export const linesToText = (lines) => lines.map((l) => `${l.team}, ${l.line}`).join('\n');
