import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TEAMS, LINES_SOURCE, WINS_SOURCE_URL } from './shared/teams.js';
import { fetchWins as fetchEspnWins, fetchRaw as fetchEspnRaw } from './shared/espn.js';
import { parseLines, linesToText } from './shared/lines.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MAX_PLAYERS = 10;
const NAME_MAX = 24;
const STAKE_CENTS = Number(process.env.STAKE_CENTS) || 1000; // $10 per team, same for everyone
const HOUR = 3_600_000;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
};

export function createApp({
  dataFile = path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'state.json'),
  adminPassword = process.env.ADMIN_PASSWORD,
  stakeCents = STAKE_CENTS,
  fetchWins = () => fetchEspnWins(TEAMS.map((t) => t.team)),
  fetchRaw = () => fetchEspnRaw(),
  now = () => Date.now(),
} = {}) {
  let state = {
    players: [], lines: TEAMS, linesSource: LINES_SOURCE, phase: 'open', lockedAt: null,
    settings: { showPicks: true, seasonStarted: false, showGroup: false }, wins: {}, winsMeta: { updatedAt: null, lastAttempt: null, error: null },
  };
  try { state = { ...state, ...JSON.parse(fs.readFileSync(dataFile, 'utf8')) }; } catch { /* first run */ }
  state.settings = { showPicks: true, seasonStarted: false, showGroup: false, ...state.settings };
  // Older saves had a per-player lock; treat those players as ready for the group lock.
  for (const p of state.players) {
    if (p.ready === undefined) p.ready = !!p.lockedAt;
    delete p.lockedAt;
  }

  const clients = new Set();
  const teamNames = new Set(TEAMS.map((t) => t.team));

  function save() {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(dataFile + '.tmp', JSON.stringify(state));
    fs.renameSync(dataFile + '.tmp', dataFile);
  }
  function broadcast() {
    for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
  }
  function commit() { save(); broadcast(); }

  const byToken = (token) => (token ? state.players.find((p) => p.token === token) : undefined);

  // Everyone's picks are visible to joined players while picking if "show picks live" is on,
  // and to every joined player once the host locks. Visitors who haven't joined never see them.
  function publicState(viewer) {
    const canSee = viewer && (state.phase === 'locked' || state.settings.showPicks);
    return {
      lines: state.lines,
      linesSource: state.linesSource,
      winsSourceUrl: WINS_SOURCE_URL,
      // Win totals only count once the host says the regular season has started.
      wins: state.settings.seasonStarted ? state.wins : {},
      winsMeta: state.winsMeta,
      seasonStarted: state.settings.seasonStarted,
      showGroup: state.settings.showGroup,
      maxPlayers: MAX_PLAYERS,
      stakeCents,
      phase: state.phase,
      lockedAt: state.lockedAt,
      showPicks: state.settings.showPicks,
      players: state.players.map((p) => ({
        id: p.id, name: p.name, ready: p.ready, picked: Object.keys(p.picks).length,
      })),
      me: viewer ? { id: viewer.id, name: viewer.name, ready: viewer.ready, picks: viewer.picks } : null,
      everyone: canSee ? state.players.map((p) => ({ id: p.id, name: p.name, picks: p.picks })) : null,
    };
  }

  async function refreshWins({ force = false } = {}) {
    const t = now();
    const meta = state.winsMeta;
    if (!force) {
      if (meta.updatedAt && t - meta.updatedAt < 22 * HOUR) return;
      if (meta.lastAttempt && t - meta.lastAttempt < HOUR) return;
    }
    meta.lastAttempt = t;
    try {
      state.wins = await fetchWins();
      meta.updatedAt = t;
      meta.error = null;
    } catch (err) {
      meta.error = String(err.message || err).slice(0, 200); // keep last good wins
    }
    commit();
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 10_000) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); }
        catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
      });
    });
  }

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const fail = (status, message) => Object.assign(new Error(message), { status });


  function checkAdmin(req) {
    if (!adminPassword) throw fail(503, 'Admin is disabled: set ADMIN_PASSWORD on the server.');
    const given = Buffer.from(String(req.headers['x-admin-password'] ?? ''));
    const want = Buffer.from(adminPassword);
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) return new Promise((_, reject) => setTimeout(() => reject(fail(401, 'Wrong admin password.')), 400));
  }

  function gameStatus() {
    return {
      phase: state.phase, showPicks: state.settings.showPicks, seasonStarted: state.settings.seasonStarted, showGroup: state.settings.showGroup,
      ready: state.players.filter((p) => p.ready).length, total: state.players.length,
      notReady: state.players.filter((p) => !p.ready).map((p) => p.name),
    };
  }

  function lockGame() {
    if (state.phase === 'locked') throw fail(409, 'Already locked.');
    if (state.players.length < 2) throw fail(409, 'Need at least 2 players to lock in.');
    const notReady = state.players.filter((p) => !p.ready).map((p) => p.name);
    if (notReady.length) throw fail(409, `Waiting on ${notReady.join(', ')}.`);
    state.phase = 'locked';
    state.lockedAt = now();
    commit();
  }

  async function adminApi(req, res, url) {
    await checkAdmin(req);
    if (url.pathname === '/api/admin/lines') return adminLines(req, res);

    if (url.pathname === '/api/admin/players' && req.method === 'GET') {
      return send(res, 200, {
        players: state.players.map((p) => ({
          id: p.id, name: p.name, ready: p.ready, picked: Object.keys(p.picks).length, joinedAt: p.joinedAt,
        })),
        total: state.lines.length,
      });
    }
    if (url.pathname === '/api/admin/status' && req.method === 'GET') {
      return send(res, 200, gameStatus());
    }
    if (url.pathname === '/api/admin/settings' && req.method === 'PUT') {
      const body = await readJson(req);
      const keys = ['showPicks', 'seasonStarted', 'showGroup'].filter((k) => k in body);
      if (!keys.length || keys.some((k) => typeof body[k] !== 'boolean')) throw fail(400, 'Send showPicks, seasonStarted and/or showGroup as true or false.');
      for (const k of keys) state.settings[k] = body[k];
      commit();
      return send(res, 200, gameStatus());
    }
    if (url.pathname === '/api/admin/espn' && req.method === 'GET') {
      try { return send(res, 200, await fetchRaw()); }
      catch (err) { throw fail(502, `Could not read ESPN: ${String(err.message || err).slice(0, 160)}`); }
    }
    if (url.pathname === '/api/admin/lock' && req.method === 'POST') {
      lockGame();
      return send(res, 200, gameStatus());
    }
    if (url.pathname === '/api/admin/unlock' && req.method === 'POST') {
      state.phase = 'open';
      state.lockedAt = null;
      commit();
      return send(res, 200, gameStatus());
    }
    const del = url.pathname.match(/^\/api\/admin\/players\/([0-9a-f]+)$/);
    if (del && req.method === 'DELETE') {
      const i = state.players.findIndex((p) => p.id === del[1]);
      if (i < 0) throw fail(404, 'No such player.');
      const [gone] = state.players.splice(i, 1);
      commit();
      return send(res, 200, { deleted: gone.name });
    }
    throw fail(404, 'Not found.');
  }

  async function adminLines(req, res) {
    if (req.method === 'GET') {
      return send(res, 200, { text: linesToText(state.lines), source: state.linesSource, frozen: state.phase === 'locked' });
    }
    if (req.method === 'PUT') {
      const body = await readJson(req);
      if (state.phase === 'locked') throw fail(409, 'The game is locked, so the lines are frozen. Unlock it first.');
      const { lines, errors } = parseLines(body.text);
      if (errors.length) return send(res, 422, { error: 'Fix the lines below.', errors });
      state.lines = lines;
      state.linesSource = String(body.source ?? '').trim().slice(0, 60) || 'Custom';
      commit();
      return send(res, 200, { saved: lines.length, source: state.linesSource });
    }
    throw fail(405, 'Method not allowed.');
  }

  async function api(req, res, url) {
    if (url.pathname.startsWith('/api/admin/')) return adminApi(req, res, url);
    const token = req.headers['x-token'] || url.searchParams.get('token') || undefined;

    if (req.method === 'GET' && url.pathname === '/api/state') {
      return send(res, 200, publicState(byToken(token)));
    }

    if (req.method === 'POST' && url.pathname === '/api/join') {
      const body = await readJson(req);
      const name = String(body.name ?? '').trim().replace(/\s+/g, ' ').slice(0, NAME_MAX);
      if (!name) throw fail(400, 'Enter a name.');
      if (state.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) throw fail(409, 'That name is taken.');
      if (state.players.length >= MAX_PLAYERS) throw fail(409, `The board is full (${MAX_PLAYERS} players).`);
      const player = {
        id: crypto.randomBytes(6).toString('hex'), token: crypto.randomBytes(18).toString('hex'),
        name, picks: {}, ready: false, joinedAt: now(),
      };
      state.players.push(player);
      commit();
      return send(res, 201, { token: player.token });
    }

    const me = byToken(token);
    if (!me) throw fail(401, 'Join first.');

    if (req.method === 'PUT' && url.pathname === '/api/picks') {
      const { team, side } = await readJson(req);
      if (state.phase === 'locked') throw fail(403, 'Picks are locked.');
      if (!teamNames.has(team)) throw fail(400, 'Unknown team.');
      if (side === null) delete me.picks[team];
      else if (side === 'over' || side === 'under') me.picks[team] = side;
      else throw fail(400, 'Pick over or under.');
      me.ready = false; // changing a pick takes you off the ready list
      commit();
      return send(res, 200, publicState(me));
    }

    if (req.method === 'POST' && url.pathname === '/api/ready') {
      const { ready } = await readJson(req);
      if (typeof ready !== 'boolean') throw fail(400, 'ready must be true or false.');
      if (state.phase === 'locked') throw fail(403, 'Picks are locked.');
      if (ready && Object.keys(me.picks).length !== state.lines.length) throw fail(400, `Pick all ${state.lines.length} teams first.`);
      me.ready = ready;
      commit();
      return send(res, 200, publicState(me));
    }

    throw fail(404, 'Not found.');
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    if (rel === '/admin') rel = '/admin.html';
    const base = rel.startsWith('/shared/') ? ROOT : path.join(ROOT, 'public');
    const file = path.normalize(path.join(base, rel));
    if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); return res.end('Not found');
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
      }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      serveStatic(req, res, url);
    } catch (err) {
      send(res, err.status ?? 500, { error: err.status ? err.message : 'Server error.' });
    }
  });

  const ping = () => { for (const res of clients) res.write(': ping\n\n'); };
  return { server, refreshWins, ping, state: () => state };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.server.listen(port, () => console.log(`Pick'em on http://localhost:${port}`));
  if (process.env.DISABLE_ESPN !== '1') {
    app.refreshWins();
    setInterval(() => app.refreshWins(), HOUR).unref();
  }
  setInterval(app.ping, 25_000).unref();
}
