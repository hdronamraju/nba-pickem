const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(method, body) {
  const res = await fetch('/api/admin/lines', {
    method, headers: { 'content-type': 'application/json', 'x-admin-password': $('pw').value },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

function show(kind, html) {
  $('out').innerHTML = html ? `<div class="${kind === 'ok' ? 'app-lock__done' : 'app-error'}">${html}</div>` : '';
}

$('load').addEventListener('click', async () => {
  show('', '');
  const { status, data } = await call('GET');
  if (status !== 200) return show('err', esc(data.error || 'Could not load.'));
  $('text').value = data.text;
  $('source').value = data.source;
  show('ok', data.frozen ? 'Loaded. Someone has locked in, so these are frozen.' : 'Loaded.');
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const { status, data } = await call('PUT', { text: $('text').value, source: $('source').value });
  if (status === 200) return show('ok', `Saved ${data.saved} teams. Source: ${esc(data.source)}.`);
  const list = (data.errors ?? []).map((x) => `<li>${x.line ? `Line ${x.line}: ` : ''}${esc(x.message)}</li>`).join('');
  show('err', `${esc(data.error || 'Could not save.')}${list ? `<ul>${list}</ul>` : ''}`);
});
