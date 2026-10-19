// Pure pick'em rules. Used by the server (validation, tests) and the browser (dollar estimates).
// Money is integer cents throughout.

export const MAX_CENTS = 1_000_000;

/** "5", "$5", "2.50" -> cents. Anything unparseable or negative -> null. */
export function parseDollars(input) {
  const s = String(input ?? '').trim().replace(/^\$/, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents <= MAX_CENTS ? cents : null;
}

export function formatMoney(cents, { signed = false } = {}) {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const body = `$${whole}${frac ? '.' + String(frac).padStart(2, '0') : ''}`;
  if (!signed) return body;
  return cents > 0 ? `+${body}` : cents < 0 ? `-${body}` : body;
}

/**
 * Work out every team's bet and every player's projected result.
 *
 * @param lines   [{ team, line }]
 * @param players locked players only: [{ id, name, picks: { [team]: 'over'|'under' } }]
 * @param wins    { [team]: number } current win totals (a missing team has no winner yet)
 * @param cents   buy-in per team, per player
 */
export function computeBoard({ lines, players, wins = {}, cents }) {
  const byPlayer = Object.fromEntries(
    players.map((p) => [p.id, { id: p.id, name: p.name, staked: 0, won: 0, net: 0 }]),
  );

  const teams = lines.map(({ team, line }) => {
    const over = [];
    const under = [];
    for (const p of players) {
      const side = p.picks?.[team];
      if (side === 'over') over.push(p);
      else if (side === 'under') under.push(p);
    }
    const on = over.length > 0 && under.length > 0;
    const pool = on ? cents * (over.length + under.length) : 0;
    const w = wins[team];
    const leader = on && Number.isFinite(w) ? (w > line ? 'over' : 'under') : null;
    const payouts = {};

    if (leader) {
      const winners = (leader === 'over' ? over : under)
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      const share = Math.floor(pool / winners.length);
      const extra = pool - share * winners.length; // leftover cents go to the first names alphabetically
      winners.forEach((p, i) => { payouts[p.id] = share + (i < extra ? 1 : 0); });
      for (const p of [...over, ...under]) {
        const row = byPlayer[p.id];
        row.staked += cents;
        row.won += payouts[p.id] ?? 0;
      }
    }

    return {
      team, line, wins: Number.isFinite(w) ? w : null, on, pool, leader, payouts,
      over: over.map((p) => p.id), under: under.map((p) => p.id),
    };
  });

  for (const row of Object.values(byPlayer)) row.net = row.won - row.staked;

  return {
    teams,
    players: Object.values(byPlayer).sort((a, b) => b.net - a.net || a.name.localeCompare(b.name)),
    totalPool: teams.reduce((n, t) => n + t.pool, 0),
    teamsOn: teams.filter((t) => t.on).length,
  };
}
