/* All configuration is inserted with textContent, never evaluated or interpreted as HTML. */
(() => {
  let report = JSON.parse(document.getElementById('report-data').textContent);
  let current = report.clients[0]?.client;
  const live = document.body.dataset.live === 'true';
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
  const badge = status => node('span', status, `status ${status}`);
  const short = path => path.startsWith(report.repository) ? path.slice(report.repository.length + 1).replace(/\\/g, '/') || '.' : path;
  function why(d) {
    $('why').replaceChildren(badge(d.status), node('h3', d.kind), node('p', `${d.path}:${d.line}`, 'path'), node('p', d.reason), node('p', `Scope: ${d.scope}. Load position: ${d.order ?? 'not loaded'}.`), node('p', `${d.loadedBytes} loaded bytes / ${d.bytes} source bytes. ~${d.estimatedTokens} tokens.`));
    if (d.importedFrom) $('why').append(node('p', `Imported from ${d.importedFrom.path}:${d.importedFrom.line}`, 'path'));
  }
  function effective() {
    const e = report.clients.find(c => c.client === current) ?? report.clients[0]; if (!e) return;
    $('clients').replaceChildren(...report.clients.map(c => { const b = node('button', c.client, `client ${c.client === e.client ? 'selected' : ''}`); b.onclick = () => { current = c.client; effective(); }; return b; }));
    const sources = [...e.decisions].sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999));
    $('sources').replaceChildren(...sources.map(d => { const b = node('button', undefined, 'source'); b.append(badge(d.status), node('div', `${d.order ?? '–'} ${short(d.path)}`)); b.onclick = () => { document.querySelectorAll('.source').forEach(n => n.classList.remove('selected')); b.classList.add('selected'); why(d); }; return b; }));
    $('effective-title').replaceChildren(node('h2', e.metadata.name), node('p', `${e.metadata.maturity} · rules ${e.metadata.ruleVersion} · ${e.instructionBytes} bytes · ~${e.estimatedTokens} tokens`, 'muted'));
    $('instructions').replaceChildren(...sources.filter(d => d.content && ['active', 'truncated', 'conditional'].includes(d.status) && ['instructions', 'rules'].includes(d.kind)).map(d => { const b = node('section', undefined, 'block'); b.append(badge(d.status), node('h3', `${short(d.path)}:${d.line}`), node('pre', d.content)); return b; }));
    if (!$('instructions').childNodes.length) $('instructions').append(node('p', 'No proven active instruction content.', 'muted'));
    $('settings').replaceChildren(...e.settings.map(s => { const b = node('div', undefined, 'setting'); b.append(badge(s.status), node('h3', s.key), node('pre', JSON.stringify(s.value, null, 2)), node('p', `${s.location.path}:${s.location.line}`, 'path'), node('p', s.reason, 'muted')); return b; }));
    $('extensions').replaceChildren(...e.extensions.map(x => { const b = node('div', undefined, 'extension'); b.append(badge(x.status), node('h3', `${x.kind} / ${x.name}`), node('pre', JSON.stringify(x.config, null, 2)), node('p', `${x.location.path}:${x.location.line}`, 'path'), node('p', x.reason, 'muted')); return b; }));
    if (sources.length) why(sources[0]);
    $('why').append(node('p', e.notes.join('\n')));
  }
  function findings() {
    const list = report.findings.filter(f => ($('severity').value === 'all' || f.severity === $('severity').value) && ($('finding-client').value === 'all' || f.client === $('finding-client').value));
    $('findings-list').replaceChildren(...list.map(f => { const b = node('article', undefined, 'finding'); b.append(badge(f.severity), node('span', ` ${f.client ?? 'cross-client'} / ${f.ruleId}`, 'rule'), node('h3', f.message), node('p', `${f.location.path}:${f.location.line}`, 'path'), node('p', f.why), node('p', `Next: ${f.suggestion}`, 'muted')); return b; }));
    if (!list.length) $('findings-list').append(node('p', 'No findings match these filters.', 'muted'));
  }
  function compare() {
    $('compare').replaceChildren(node('h2', 'Instruction content & recipients'));
    for (const d of report.diff) { const b = node('article', undefined, 'comparison'); b.append(node('h3', d.clients.length === report.clients.length ? 'Shared by all selected clients' : d.clients.join(' + ')), node('p', d.sources.map(s => `${s.path}:${s.line}`).join('\n'), 'path'), node('pre', d.content)); $('compare').append(b); }
    $('compare').append(node('h2', 'Extensions by client'));
    const grid = node('div', undefined, 'comparison-grid');
    for (const e of report.clients) { const col = node('div'); col.append(node('h3', e.metadata.name)); for (const x of e.extensions) { const b = node('div', undefined, 'extension'); b.append(badge(x.status), node('h3', `${x.kind} / ${x.name}`), node('pre', JSON.stringify(x.config, null, 2))); col.append(b); } grid.append(col); }
    $('compare').append(grid);
  }
  function render() {
    $('repository').textContent = report.repository;
    $('target').value = short(report.target);
    $('stats').replaceChildren(...[[report.clients.filter(c => c.detected).length, 'clients'], [report.sources.length, 'sources'], [report.findings.length, 'findings']].map(([n, label]) => { const s = node('span'); s.append(node('b', String(n)), node('span', label)); return s; }));
    $('finding-count').textContent = String(report.findings.length);
    $('finding-client').replaceChildren(node('option', 'All clients'));
    $('finding-client').firstChild.value = 'all';
    for (const c of report.clients) { const o = node('option', c.client); o.value = c.client; $('finding-client').append(o); }
    $('assumptions').replaceChildren(...report.assumptions.map(a => node('li', a)));
    $('report-data').textContent = JSON.stringify(report); effective(); findings(); compare();
  }
  for (const view of ['effective', 'compare', 'findings']) $(`${view}-tab`).onclick = () => {
    for (const v of ['effective', 'compare', 'findings']) { $(v).hidden = v !== view; $(`${v}-tab`).setAttribute('aria-pressed', String(v === view)); }
  };
  $('severity').onchange = findings; $('finding-client').onchange = findings;
  $('target-form').onsubmit = async event => {
    event.preventDefault(); if (!live) return; $('error').textContent = ''; $('inspect').disabled = true;
    try { const r = await fetch(`/api/scan?target=${encodeURIComponent($('target').value)}`); const data = await r.json(); if (!r.ok) throw new Error(data.error); report = data; render(); }
    catch (e) { $('error').textContent = e.message; } finally { $('inspect').disabled = false; }
  };
  $('export').onclick = async () => {
    if (live) { const a = node('a'); a.href = `/api/export?target=${encodeURIComponent($('target').value)}`; a.download = 'agent-sightline-report.html'; a.click(); return; }
    const text = '<!doctype html>\n' + document.documentElement.outerHTML;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' })); const a = node('a'); a.href = url; a.download = 'agent-sightline-report.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!live) { $('target').readOnly = true; $('inspect').disabled = true; }
  render();
})();
