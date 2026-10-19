const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(method, body, path = '/api/admin/lines') {
  const res = await fetch(path, {
    method, headers: { 'content-type': 'application/json', 'x-admin-password': $('pw').value },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function show(kind, html) {
  $('out').innerHTML = html ? `<div class="${kind === 'ok' ? 'app-lock__done' : 'app-error'}">${html}</div>` : '';
}

async function loadPlayers() {
  const { status, data } = await call('GET', undefined, '/api/admin/players');
  if (status !== 200) return;
  const rows = data.players.map((p) => `<div class="c99-option admin-player">
      <span class="c99-option__label">${esc(p.name)}</span>
      <span class="c99-option__value ${p.locked ? 'is-on' : 'is-off'}">${p.locked ? 'Locked' : `${p.picked}/${data.total}`}</span>
      <button class="c99-round c99-round--cancel" type="button" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-locked="${p.locked}" aria-label="Delete ${esc(p.name)}"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5 L15 15 M15 5 L5 15"/></svg></button>
    </div>`).join('');
  $('players').innerHTML = rows || '<p class="app-note">Nobody has joined yet.</p>';
}

$('players').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  const { id, name, locked } = b.dataset;
  const warn = locked === 'true'
    ? `Delete ${name}? They have LOCKED IN. Their picks vanish from every pool and the lines unfreeze if they were the only one. This cannot be undone.`
    : `Delete ${name} and their picks? This cannot be undone.`;
  if (!confirm(warn)) return;
  const { status, data } = await call('DELETE', undefined, `/api/admin/players/${id}`);
  $('players-out').innerHTML = status === 200
    ? `<div class="app-lock__done">Deleted ${esc(data.deleted)}.</div>`
    : `<div class="app-error">${esc(data.error || 'Could not delete.')}</div>`;
  loadPlayers();
});

$('load').addEventListener('click', async () => {
  show('', '');
  const { status, data } = await call('GET');
  if (status !== 200) return show('err', esc(data.error || 'Could not load.'));
  $('text').value = data.text;
  $('source').value = data.source;
  show('ok', data.frozen ? 'Loaded. Someone has locked in, so these are frozen.' : 'Loaded.');
  loadPlayers();
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { status, data } = await call('PUT', { text: $('text').value, source: $('source').value });
  if (status === 200) return show('ok', `Saved ${data.saved} teams. Source: ${esc(data.source)}.`);
  const list = (data.errors ?? []).map((x) => `<li>${x.line ? `Line ${x.line}: ` : ''}${esc(x.message)}</li>`).join('');
  show('err', `${esc(data.error || 'Could not save.')}${list ? `<ul>${list}</ul>` : ''}`);
});
