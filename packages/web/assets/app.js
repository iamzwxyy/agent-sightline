/* Configuration content is rendered as text. A report never executes source code. */
(() => {
  let report = JSON.parse(document.getElementById('report-data').textContent);
  const live = document.body.dataset.live === 'true';
  const originalDocument = document.documentElement.outerHTML;
  let exportDocument = live ? JSON.parse(document.getElementById('export-data').textContent) : '<!doctype html>\n' + originalDocument;
  const names = { codex: 'Codex', claude: 'Claude Code', copilot: 'GitHub Copilot', gemini: 'Gemini CLI', cursor: 'Cursor', opencode: 'OpenCode' };
  const initials = { codex: 'C', claude: '✳', copilot: 'G', gemini: 'G', cursor: '↗', opencode: 'O' };
  const viewLabels = { overview: 'Overview', effective: 'Instructions', configuration: 'Settings', compare: 'Compare clients', extensions: 'Extensions', findings: 'Findings' };
  const state = {
    view: 'overview',
    client: report.clients.find(client => client.detected)?.client ?? report.clients[0]?.client,
    source: null,
    sourceFilter: 'relevant',
    instructionView: 'sources',
    extensionKind: 'all',
    compareClients: new Set(report.clients.filter(client => client.detected).slice(0, 3).map(client => client.client)),
    highlightLine: null,
    request: 0,
  };
  let toastTimer;
  let scanController;
  let targetTimer;
  let targetController;
  let targetRequest = 0;
  let targetItems = [];
  let targetIndex = -1;
  const $ = id => document.getElementById(id);
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const short = value => value.startsWith(report.repository) ? value.slice(report.repository.length).replace(/^[/\\]/, '').replace(/\\/g, '/') || '.' : value.replace(/\\/g, '/');
  const initialTarget = short(report.target);
  const basename = value => value.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'Workspace';
  const selectedClient = () => report.clients.find(client => client.client === state.client) ?? report.clients[0];
  const statusNames = { active: 'Loaded', conditional: 'Conditional', shadowed: 'Shadowed', ignored: 'Not loaded', truncated: 'Truncated', invalid: 'Invalid' };
  const badge = status => node('span', statusNames[status] ?? status, `status ${status}`);
  const avatar = client => {
    const element = node('span', initials[client] ?? client[0].toUpperCase(), `client-avatar ${client}`);
    element.title = names[client] ?? client;
    element.setAttribute('aria-label', names[client] ?? client);
    return element;
  };
  const button = (label, onClick, className = 'button') => {
    const element = node('button', label, className);
    element.type = 'button';
    element.onclick = onClick;
    return element;
  };
  function empty(title, description, action) {
    const element = node('div', undefined, 'empty-state');
    element.append(node('h3', title), node('p', description));
    if (action) element.append(action);
    return element;
  }
  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2400);
  }
  async function copy(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      toast(label ?? 'Copied to clipboard');
    } catch {
      const content = node('div', undefined, 'dialog-content');
      const title = node('h2', 'Copy this text'); title.id = 'detail-title';
      const field = node('textarea', undefined, 'copy-text');
      field.value = text; field.readOnly = true; field.rows = Math.min(12, Math.max(3, text.split('\n').length + 1));
      field.setAttribute('aria-label', 'Text to copy');
      content.append(title, node('p', 'Press ⌘C or Ctrl+C to copy the selected text.'), field);
      $('detail-category').textContent = 'Clipboard';
      $('detail-body').replaceChildren(content);
      if (!$('detail-dialog').open) $('detail-dialog').showModal();
      field.focus(); field.select();
    }
  }
  function closeTargetPicker() {
    if (!live) return;
    clearTimeout(targetTimer); targetController?.abort(); targetRequest++;
    $('target-picker').hidden = true; $('target').setAttribute('aria-expanded', 'false');
    $('target').removeAttribute('aria-activedescendant'); targetIndex = -1;
  }
  function chooseTarget(value) {
    $('target').value = value; closeTargetPicker(); void refresh(value);
  }
  function searchTargetFiles(immediate = false) {
    if (!live) return;
    clearTimeout(targetTimer); targetController?.abort();
    const request = ++targetRequest;
    const query = $('target').value;
    targetItems = []; targetIndex = -1;
    $('target').removeAttribute('aria-activedescendant');
    $('target').setAttribute('aria-expanded', 'true'); $('target-picker').hidden = false;
    $('target-options').replaceChildren(); $('target-search-status').textContent = 'Searching repository…';
    const search = async () => {
      targetController = new AbortController();
      try {
        const parameters = new URLSearchParams({ q: query === '.' ? '' : query, limit: '40' });
        const response = await fetch(`/api/targets?${parameters}`, { signal: targetController.signal });
        if (!response.ok) throw new Error('File search failed.');
        const data = await response.json();
        if (request !== targetRequest || $('target-picker').hidden || query !== $('target').value) return;
        targetItems = Array.isArray(data.paths) ? data.paths : [];
        $('target-options').replaceChildren(...targetItems.map((value, index) => {
          const option = node('li', undefined, 'target-option');
          option.id = `target-option-${index}`; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', 'false');
          const label = node('div');
          label.append(node('strong', value === '.' ? 'Repository root' : basename(value)), node('span', value, 'target-option-path'));
          const icon = node('span', value.endsWith('/') || value === '.' ? '▱' : '▤', 'target-option-icon'); icon.setAttribute('aria-hidden', 'true');
          option.append(icon, label);
          option.onpointerdown = event => event.preventDefault();
          option.onclick = () => chooseTarget(value);
          return option;
        }));
        let status = 'No matching files. You can enter a repository-relative path.';
        if (targetItems.length) status = `${targetItems.length} results${data.hasMore ? ' · Keep typing to narrow the list' : ''}`;
        if (data.truncated) status = 'Suggestions are partial. You can enter a path directly.';
        $('target-search-status').textContent = status;
      } catch (error) {
        if (error.name !== 'AbortError' && request === targetRequest) $('target-search-status').textContent = 'File suggestions are unavailable. Enter a path to inspect it.';
      }
    };
    if (immediate) void search(); else targetTimer = setTimeout(search, 180);
  }
  function moveTargetSelection(direction) {
    if (!targetItems.length) return;
    if (targetIndex === -1) targetIndex = direction > 0 ? 0 : targetItems.length - 1;
    else targetIndex = (targetIndex + direction + targetItems.length) % targetItems.length;
    [...$('target-options').children].forEach((option, index) => option.setAttribute('aria-selected', String(index === targetIndex)));
    const option = $(`target-option-${targetIndex}`);
    $('target').setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
  }
  function groupFindings() {
    const groups = new Map();
    for (const finding of report.findings) {
      const key = JSON.stringify([finding.ruleId, finding.severity, finding.message, finding.location, finding.why, finding.suggestion, finding.related]);
      if (!groups.has(key)) groups.set(key, { ...finding, clients: [], originals: [] });
      const group = groups.get(key);
      group.originals.push(finding);
      if (finding.client && !group.clients.includes(finding.client)) group.clients.push(finding.client);
    }
    return [...groups.values()];
  }
  function navigate(view, client, source) {
    if (client) state.client = client;
    if (source) { state.source = source; state.instructionView = 'sources'; }
    state.view = view;
    document.body.classList.remove('nav-open');
    $('navigation-scrim').hidden = true;
    $('mobile-menu').setAttribute('aria-expanded', 'false');
    const hash = new URLSearchParams({ view });
    if (view === 'effective') {
      hash.set('client', state.client);
      if (state.source) hash.set('source', short(state.source));
      if (state.instructionView === 'document') hash.set('text', 'effective');
    }
    const nextHash = '#' + hash.toString();
    if (location.hash !== nextHash) history.pushState(null, '', nextHash);
    renderNavigation();
    if (view === 'effective') renderInstructions();
    if (view === 'configuration') renderSettings();
    if (view === 'compare') renderCompare();
    if (view === 'extensions') renderExtensions();
    if (view === 'findings') renderFindings();
  }
  function renderNavigation() {
    for (const [view, label] of Object.entries(viewLabels)) {
      $(view).hidden = state.view !== view;
      const tab = $(`${view}-tab`);
      tab.setAttribute('aria-current', state.view === view ? 'page' : 'false');
      tab.setAttribute('aria-pressed', String(state.view === view));
      if (state.view === view) $('view-label').textContent = label;
    }
    const clients = report.clients.filter(client => client.detected);
    $('clients').replaceChildren(...(clients.length ? clients : report.clients).map(client => {
      const element = button('', () => {
        state.source = null;
        state.highlightLine = null;
        navigate('effective', client.client);
      }, `client ${client.client === state.client && state.view === 'effective' ? 'selected' : ''}`);
      element.append(avatar(client.client), node('span', names[client.client]));
      const actionable = report.findings.filter(finding => finding.client === client.client && finding.severity !== 'info').length;
      if (actionable) element.append(node('span', String(actionable), 'client-status'));
      element.setAttribute('aria-label', `Inspect ${names[client.client]} instructions`);
      return element;
    }));
  }
  function issueRow(finding) {
    const element = button('', () => showFinding(finding), 'finding');
    const severity = node('span', finding.severity === 'error' ? '!' : finding.severity === 'warn' ? '!' : 'i', `severity-icon ${finding.severity}`);
    severity.setAttribute('aria-label', finding.severity);
    const title = node('div');
    title.append(node('h3', finding.message), node('span', `${short(finding.location.path)} · line ${finding.location.line}, column ${finding.location.column}`, 'finding-location'));
    const recipients = node('span', undefined, 'finding-clients');
    finding.clients.forEach(client => recipients.append(avatar(client)));
    element.append(severity, title, recipients, node('span', '›', 'row-arrow'));
    return element;
  }
  function renderOverview() {
    const findings = groupFindings();
    const errors = findings.filter(finding => finding.severity === 'error');
    const warnings = findings.filter(finding => finding.severity === 'warn');
    const actionable = [...errors, ...warnings];
    const detected = report.clients.filter(client => client.detected);
    $('overview-heading').textContent = actionable.length ? `${actionable.length} configuration issues found.` : 'No configuration issues found.';
    $('overview-description').textContent = `We traced ${report.sources.length} sources across ${detected.length} clients. ${actionable.length ? 'Start with a finding, or follow a client’s instruction chain.' : 'Choose a client to see its loaded instructions and configuration sources.'}`;
    const incomplete = report.discovery?.complete === false;
    const noConfiguration = !report.sources.length && !incomplete;
    if (noConfiguration) {
      $('overview-heading').textContent = 'Your first configuration starts here.';
      $('overview-description').textContent = 'No agent configuration was discovered in this scan. Explore the sample workspace, or add an instruction file in a supported location.';
    }
    if (incomplete) {
      $('overview-heading').textContent = 'Configuration discovery is incomplete.';
      $('overview-description').textContent = 'Some locations could not be fully inspected. Review discovery findings and scan scope before relying on these results.';
    }
    const starting = $('getting-started');
    starting.hidden = incomplete || !noConfiguration && (!live || short(report.target) !== '.');
    starting.replaceChildren();
    if (!starting.hidden) {
      const description = node('div');
      description.append(node('h2', noConfiguration ? 'See how a configuration issue looks' : 'Choose the file your agent is working on'), node('p', noConfiguration ? 'The sample includes missing imports, instruction overrides and a byte limit you can trace to the exact source.' : 'Loading rules depend on the target’s directory and file type. Pick a source file to inspect its instruction chain.'));
      const actions = node('div', undefined, 'getting-started-actions');
      if (live && !noConfiguration) actions.append(button('Choose a target file', () => { $('target').focus(); $('target').select(); }, 'button button-primary'));
      if (live) { const demo = node('a', 'Explore sample workspace →', 'button'); demo.href = '/demo/'; actions.append(demo); }
      actions.append(button('Copy demo command', () => copy('agent-sightline demo --ui', 'Demo command copied'), 'button'));
      starting.append(description, actions);
    }
    $('review-findings').hidden = !actionable.length;
    const stats = [
      { label: 'Errors', value: errors.length, note: 'Configuration needs a fix', className: 'error', action: () => { $('severity').value = 'error'; navigate('findings'); } },
      { label: 'Warnings', value: warnings.length, note: 'Behavior worth checking', className: 'warn', action: () => { $('severity').value = 'warn'; navigate('findings'); } },
      { label: 'Sources discovered', value: report.sources.length, note: 'Across project and user scope', action: () => { state.sourceFilter = 'all'; navigate('effective'); } },
      { label: 'Clients configured', value: detected.length, note: 'With versioned loading rules', action: () => navigate('compare') },
    ];
    $('stats').replaceChildren(...stats.map(stat => {
      const element = button('', stat.action, `stat ${stat.className ?? ''}`);
      element.append(node('span', stat.label, 'stat-label'), node('strong', String(stat.value), 'stat-value'), node('small', stat.note));
      return element;
    }));
    $('priority-findings').replaceChildren(...actionable.slice(0, 5).map(issueRow));
    if (!actionable.length && incomplete) $('priority-findings').append(empty('Review discovery limits', 'The displayed findings may be filtered. Open scan scope for the inspection budgets.', button('Review scan scope', () => $('scope-dialog').showModal(), 'button')));
    if (!actionable.length && !incomplete) $('priority-findings').append(empty(noConfiguration ? 'No configuration to diagnose yet' : 'No errors or warnings found', noConfiguration ? 'Codex reads AGENTS.md, Claude Code reads CLAUDE.md, and Copilot reads .github/copilot-instructions.md. Refresh after adding your configuration.' : 'You can still inspect information notices and source loading decisions.'));
    $('client-overview').replaceChildren(...detected.map(client => {
      const element = button('', () => { state.source = null; navigate('effective', client.client); }, 'client-card');
      const heading = node('div', undefined, 'client-card-heading');
      heading.append(avatar(client.client), node('h3', names[client.client]), node('span', '↗', 'row-arrow'));
      const loaded = client.decisions.filter(source => ['active', 'truncated'].includes(source.status) && ['rules', 'instructions'].includes(source.kind));
      const conditional = client.decisions.filter(source => source.status === 'conditional').length;
      element.append(heading, node('p', `${loaded.length} instruction sources · ~${client.estimatedTokens.toLocaleString()} tokens${conditional ? ` · ${conditional} conditional` : ''}`), node('div', loaded.map(source => basename(source.path)).join(' → ') || 'No instructions loaded', 'chain-preview'));
      return element;
    }));
    const conditional = report.clients.some(client => client.decisions.some(source => source.status === 'conditional'));
    $('trust-notice').hidden = !conditional;
    $('trust-notice').replaceChildren(node('span', 'Some sources depend on workspace trust or approval. '), button('Review scan assumptions', () => $('scope-dialog').showModal(), 'text-button'));
  }
  function showFinding(finding) {
    $('detail-category').textContent = finding.ruleId;
    const content = node('div', undefined, 'dialog-content');
    content.append(badge(finding.severity), node('h2', finding.message), node('p', `${short(finding.location.path)} · line ${finding.location.line}, column ${finding.location.column}`, 'path'));
    content.querySelector('h2').id = 'detail-title';
    content.append(node('h3', 'Why this happens'), node('p', finding.why), node('h3', 'How to resolve it'), node('p', finding.suggestion, 'fix-suggestion'));
    const related = [...new Map(finding.originals.flatMap(item => item.related).map(location => [JSON.stringify(location), location])).values()];
    if (related.length) {
      content.append(node('h3', 'Related sources'));
      const list = node('ul', undefined, 'related-list');
      related.forEach(location => {
        const label = `${short(location.path)} · line ${location.line}, column ${location.column}`;
        const row = node('li');
        row.append(sourceClient(location) ? button(label, () => inspectSourceLocation(location), 'source-link') : node('span', label));
        list.append(row);
      });
      content.append(list);
    }
    const actions = node('div', undefined, 'dialog-actions');
    const client = sourceClient(finding.location, finding.clients[0]);
    if (client) actions.append(button('Inspect source →', () => inspectSourceLocation(finding.location, client), 'button button-primary'));
    actions.append(button('Copy location', () => copy(`${finding.location.path}:${finding.location.line}:${finding.location.column}`), 'button'));
    content.append(actions);
    $('detail-body').replaceChildren(content);
    if (!$('detail-dialog').open) $('detail-dialog').showModal();
  }
  function renderFindings() {
    const groups = groupFindings();
    const severity = $('severity').value;
    const client = $('finding-client').value;
    const query = $('finding-search').value.trim().toLowerCase();
    const visible = groups.filter(finding => {
      const matchesSeverity = severity === 'all' || severity === 'actionable' && finding.severity !== 'info' || finding.severity === severity;
      const matchesClient = client === 'all' || finding.clients.includes(client);
      const matchesQuery = !query || [finding.message, finding.ruleId, finding.location.path, finding.why].join(' ').toLowerCase().includes(query);
      return matchesSeverity && matchesClient && matchesQuery;
    });
    $('findings-summary').textContent = `${groups.length} distinct findings. Repeated findings across clients are grouped at their source.`;
    $('findings-list').replaceChildren(...visible.map(issueRow));
    if (!visible.length) $('findings-list').append(empty('No findings match your filters', 'Try another severity, client or search term.', button('Reset filters', () => {
      $('severity').value = 'all'; $('finding-client').value = 'all'; $('finding-search').value = ''; renderFindings();
    }, 'button button-small')));
    $('filter-summary').textContent = `${visible.length} of ${groups.length} findings shown`;
  }
  function decisions() {
    const client = selectedClient();
    if (!client) return [];
    return [...client.decisions].sort((left, right) => (left.order ?? 99999) - (right.order ?? 99999));
  }
  function renderInstructions() {
    const client = selectedClient();
    if (!client) return;
    $('effective-title').textContent = `${names[client.client]}’s instructions`;
    $('effective-summary').textContent = `${client.instructionBytes.toLocaleString()} loaded bytes · ~${client.estimatedTokens.toLocaleString()} estimated tokens · rules ${client.metadata.ruleVersion}`;
    $('copy-effective').onclick = () => copy(client.instructions, 'Effective instructions copied');
    $('copy-effective').disabled = !client.instructions;
    document.querySelectorAll('[data-instruction-view]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.instructionView === state.instructionView)));
    $('instruction-explorer').hidden = state.instructionView !== 'sources';
    $('effective-document').hidden = state.instructionView !== 'document';
    if (state.instructionView === 'document') renderEffectiveDocument(client);
    const sources = decisions();
    const selected = sources.find(source => source.path === state.source) ?? sources.find(source => ['active', 'truncated'].includes(source.status) && ['instructions', 'rules'].includes(source.kind)) ?? sources[0];
    state.source = selected?.path ?? null;
    renderSourceList();
    if (selected) renderSource(selected);
    else {
      $('instructions').replaceChildren(empty('No configuration discovered', 'Create an instruction file in this client’s supported location, then refresh the scan.'));
      $('why').replaceChildren(node('p', client.metadata.limitations.join(' ')));
    }
    renderNavigation();
  }
  function renderEffectiveDocument(client) {
    const origins = node('div', undefined, 'effective-origins');
    client.decisions.filter(source => ['active', 'truncated'].includes(source.status) && source.content && ['instructions', 'rules'].includes(source.kind)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(source => {
      origins.append(button(`${source.order} · ${short(source.path)}`, () => {
        state.instructionView = 'sources'; state.sourceFilter = 'all';
        navigate('effective', client.client, source.path);
      }, 'source-origin'));
    });
    const content = node('article', undefined, 'effective-document');
    const conditional = client.decisions.filter(source => source.status === 'conditional' && ['instructions', 'rules'].includes(source.kind));
    if (conditional.length) content.append(node('div', `${conditional.length} instruction sources depend on trust, approval or a session condition. Review their loading decisions in Trace sources.`, 'code-note'));
    content.append(origins);
    if (client.instructions) content.append(node('pre', client.instructions, 'effective-text'));
    else content.append(empty('No proven active instruction text', 'Review the source chain and workspace trust assumptions for this client.'));
    $('effective-document').replaceChildren(content);
  }
  function renderSourceList() {
    const query = $('source-search').value.toLowerCase();
    const sources = decisions().filter(source => (state.sourceFilter === 'all' || source.status !== 'ignored' || source.path === state.source) && short(source.path).toLowerCase().includes(query));
    $('source-count').textContent = String(sources.length);
    document.querySelectorAll('[data-source-filter]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.sourceFilter === state.sourceFilter)));
    let previousGroup;
    const elements = [];
    for (const source of sources) {
      const group = source.order !== null ? 'Load order' : 'Not in the active chain';
      if (group !== previousGroup) { elements.push(node('div', group, 'source-group-label')); previousGroup = group; }
      const element = button('', () => {
        state.source = source.path;
        state.highlightLine = null;
        navigate('effective', state.client, source.path);
      }, `source ${source.path === state.source ? 'selected' : ''}`);
      element.setAttribute('aria-label', `${basename(source.path)}, ${statusNames[source.status]}, ${short(source.path)}`);
      element.title = `${short(source.path)} — ${source.reason}`;
      const text = node('span');
      text.append(node('span', basename(source.path), 'source-name'), node('span', short(source.path).replace(/\/[^/]+$/, '') || 'Repository root', 'source-dir'));
      element.append(node('span', source.order === null ? '—' : String(source.order).padStart(2, '0'), 'source-order'), text, node('span', undefined, `source-dot ${source.status}`));
      elements.push(element);
    }
    $('sources').replaceChildren(...elements);
    if (!sources.length) $('sources').append(empty('No matching sources', 'Clear the filter to see the full source list.'));
  }
  function sourceText(source) {
    const preview = report.sources.find(candidate => candidate.id === source.sourceId)?.preview;
    if (preview !== undefined) return { text: preview, firstLine: 1, label: 'Source preview' };
    if (source.content) return { text: source.content, firstLine: source.line, label: source.status === 'truncated' ? 'Loaded prefix' : 'Loaded instruction content' };
    const client = selectedClient();
    const settings = client.settings.filter(setting => setting.location.path === source.path);
    const extensions = client.extensions.filter(extension => extension.location.path === source.path);
    if (settings.length || extensions.length) return { text: JSON.stringify({ settings: settings.map(setting => ({ key: setting.key, value: setting.value })), extensions: extensions.map(extension => ({ kind: extension.kind, name: extension.name, config: extension.config })) }, null, 2), firstLine: null, label: 'Parsed configuration' };
    return { text: '', firstLine: null, label: 'Source unavailable' };
  }
  function renderSource(source) {
    const client = selectedClient();
    $('source-title').textContent = short(source.path);
    $('source-status').replaceChildren(badge(source.status));
    const preview = sourceText(source);
    const content = [];
    if (source.status === 'truncated') content.push(node('div', `Only ${source.loadedBytes} of ${source.bytes} bytes reach this client. The code below shows the ${preview.label === 'Source preview' ? 'source file' : 'loaded prefix'}.`, 'code-note'));
    if (source.status === 'ignored' || source.status === 'shadowed' || source.status === 'conditional') content.push(node('div', source.reason, 'code-note'));
    const code = node('div', undefined, 'code-view');
    code.setAttribute('aria-label', preview.label);
    let bytesRead = 0;
    let cutoffShown = false;
    const showByteLimit = source.status === 'truncated' && preview.label === 'Source preview';
    if (preview.text) preview.text.split('\n').forEach((line, index) => {
      const lineNumber = preview.firstLine === null ? '' : preview.firstLine + index;
      const encoder = new TextEncoder();
      const lineBytes = encoder.encode(line);
      const beyondLimit = showByteLimit && bytesRead >= source.loadedBytes;
      const row = node('div', undefined, `code-line${/^#+\s/.test(line) ? ' heading' : ''}${lineNumber === state.highlightLine ? ' highlight' : ''}${beyondLimit ? ' unloaded' : ''}`);
      const text = node('span', line || ' ', 'line-text');
      if (showByteLimit && !beyondLimit && bytesRead + lineBytes.length > source.loadedBytes) {
        let loadedLength = 0;
        let loadedBytes = 0;
        for (const character of line) {
          const characterBytes = encoder.encode(character).length;
          if (loadedBytes + characterBytes > source.loadedBytes - bytesRead) break;
          loadedBytes += characterBytes;
          loadedLength += character.length;
        }
        text.replaceChildren(node('span', line.slice(0, loadedLength)), node('span', line.slice(loadedLength), 'unloaded-text'));
      }
      row.append(node('span', String(lineNumber), 'line-number'), text);
      code.append(row);
      bytesRead += lineBytes.length + 1;
      if (showByteLimit && bytesRead >= source.loadedBytes && !cutoffShown) {
        cutoffShown = true;
        code.append(node('div', 'Byte limit reached · content below is not loaded', 'byte-limit-marker'));
      }
    });
    else code.append(empty('No source preview available', source.bytes === 0 ? 'This configuration file is empty.' : source.status === 'invalid' ? 'Correct the syntax at the reported location and rescan to view a redacted preview.' : 'This report includes the source’s loading decision and provenance in Source details.'));
    content.push(code);
    $('instructions').replaceChildren(...content);
    $('copy-source').disabled = !preview.text;
    $('copy-source').onclick = () => copy(preview.text, 'Source content copied');
    const settings = client.settings.filter(setting => setting.location.path === source.path);
    $('settings').replaceChildren(...settings.map(setting => {
      const element = node('div', undefined, 'setting');
      const key = node('div', undefined, 'setting-key');
      key.append(node('span', setting.key), badge(setting.status));
      element.append(key, node('pre', JSON.stringify(setting.value, null, 2)), node('p', setting.reason));
      if (setting.overrides.length) element.append(node('p', `Overrides ${setting.overrides.map(location => short(location.path) + ':' + location.line).join(', ')}`));
      return element;
    }));
    $('settings').parentElement.hidden = !settings.length;
    const why = [badge(source.status), node('h3', basename(source.path)), node('p', short(source.path), 'path'), node('p', source.reason)];
    const metadata = node('dl', undefined, 'detail-meta');
    for (const [label, value] of [['Scope', source.scope], ['Load position', source.order ?? 'Outside chain'], ['Source size', `${source.bytes} bytes`], ['Loaded size', `${source.loadedBytes} bytes`], ['Token estimate', `~${source.estimatedTokens}`], ['Starts at', `Line ${source.line}`]]) {
      const pair = node('div'); pair.append(node('dt', label), node('dd', String(value))); metadata.append(pair);
    }
    why.push(metadata);
    if (source.importedFrom) why.push(node('p', `Imported from ${short(source.importedFrom.path)}:${source.importedFrom.line}`, 'path'));
    why.push(button('Copy source path', () => copy(source.path), 'text-button'));
    const related = groupFindings().filter(finding => finding.location.path === source.path && (!finding.clients.length || finding.clients.includes(state.client)));
    if (related.length) {
      const list = node('div', undefined, 'why-findings'); list.append(node('h3', `${related.length} related findings`));
      related.forEach(finding => list.append(button(finding.message, () => showFinding(finding), 'text-button')));
      why.push(list);
    }
    $('why').replaceChildren(...why);
  }
  function showSetting(setting, client) {
    $('detail-category').textContent = `${names[client]} / setting`;
    const content = node('div', undefined, 'dialog-content');
    const title = node('h2', setting.key); title.id = 'detail-title';
    content.append(badge(setting.status), title, node('pre', JSON.stringify(setting.value, null, 2)), node('h3', 'Why this value applies'), node('p', setting.reason));
    const origins = node('div', undefined, 'setting-origins');
    origins.append(node('h3', 'Selected definition'), button(`${short(setting.location.path)} · line ${setting.location.line}`, () => inspectSourceLocation(setting.location, client), 'source-link'));
    if (setting.overrides.length) {
      origins.append(node('h3', 'Replaces these definitions'));
      setting.overrides.forEach(location => origins.append(button(`${short(location.path)} · line ${location.line}`, () => inspectSourceLocation(location, client), 'source-link')));
    }
    content.append(origins);
    const actions = node('div', undefined, 'dialog-actions');
    actions.append(button('Inspect source →', () => inspectSourceLocation(setting.location, client), 'button button-primary'), button('Copy value', () => copy(JSON.stringify(setting.value, null, 2))));
    content.append(actions); $('detail-body').replaceChildren(content);
    if (!$('detail-dialog').open) $('detail-dialog').showModal();
  }
  function sourceClient(location, preferred) {
    const clients = report.clients.filter(client => client.decisions.some(source => source.path === location.path));
    return clients.find(client => client.client === preferred)?.client
      ?? clients.find(client => client.decisions.some(source => source.path === location.path && source.status !== 'ignored'))?.client
      ?? clients[0]?.client;
  }
  function inspectSourceLocation(location, preferred) {
    const client = sourceClient(location, preferred);
    if (!client) return;
    $('detail-dialog').close(); state.sourceFilter = 'all'; $('source-search').value = ''; state.highlightLine = location.line;
    navigate('effective', client, location.path);
  }
  function renderSettings() {
    const selected = $('setting-client').value;
    const query = $('setting-search').value.trim().toLowerCase();
    const settings = report.clients.filter(client => selected === 'all' || selected === client.client).flatMap(client => client.settings.map(setting => ({ setting, client: client.client })));
    const visible = settings.filter(({ setting }) => ($('include-shadowed').checked || setting.status !== 'shadowed') && (!query || [setting.key, JSON.stringify(setting.value), short(setting.location.path)].join(' ').toLowerCase().includes(query)));
    const table = node('table', undefined, 'coverage-table settings-table');
    const head = node('thead'); const header = node('tr');
    ['Setting', 'Resolved value', 'Client', 'Source'].forEach(label => header.append(node('th', label))); head.append(header); table.append(head);
    const body = node('tbody');
    for (const { setting, client } of visible) {
      const row = node('tr');
      const name = node('td'); name.append(button(setting.key, () => showSetting(setting, client), 'source-link setting-name'), badge(setting.status));
      const value = node('td'); value.append(node('code', JSON.stringify(setting.value), 'setting-value'));
      const owner = node('td'); const identity = node('span', undefined, 'setting-client'); identity.append(avatar(client), node('span', names[client])); owner.append(identity);
      const source = node('td'); source.append(button(`${short(setting.location.path)}:${setting.location.line}`, () => inspectSourceLocation(setting.location, client), 'source-link'));
      row.append(name, value, owner, source); body.append(row);
    }
    table.append(body);
    const reset = () => { $('setting-search').value = ''; $('setting-client').value = 'all'; $('include-shadowed').checked = false; renderSettings(); };
    $('setting-list').replaceChildren(visible.length ? table : empty(settings.length ? 'No settings match your filters' : 'No structured settings discovered', settings.length ? 'Try another key, value, client or source path.' : 'Structured settings appear here when a supported configuration file is discovered.', button('Reset filters', reset, 'button button-small')));
    $('setting-summary').textContent = `${visible.length} of ${settings.length} setting definitions shown. Select a key to inspect its precedence and replaced origins.`;
  }
  function renderCompare() {
    const clients = report.clients.filter(client => state.compareClients.has(client.client));
    $('compare-clients').replaceChildren(...report.clients.map(client => {
      const element = button('', () => {
        if (state.compareClients.has(client.client)) {
          if (state.compareClients.size === 1) { toast('Keep at least one client selected'); return; }
          state.compareClients.delete(client.client);
        } else state.compareClients.add(client.client);
        renderCompare();
      }, 'compare-chip');
      element.append(avatar(client.client), node('span', names[client.client]));
      element.setAttribute('aria-pressed', String(state.compareClients.has(client.client)));
      return element;
    }));
    $('comparison-text').replaceChildren(...clients.map(client => {
      const panel = node('article', undefined, 'comparison-document');
      const heading = node('div', undefined, 'comparison-document-heading');
      const title = node('h3'); title.append(avatar(client.client), node('span', names[client.client]));
      heading.append(title, button('Copy text', () => copy(client.instructions, `${names[client.client]} instructions copied`), 'button button-small'));
      const loaded = client.decisions.filter(source => ['active', 'truncated'].includes(source.status) && source.content && ['instructions', 'rules'].includes(source.kind));
      const conditional = client.decisions.filter(source => source.status === 'conditional' && ['instructions', 'rules'].includes(source.kind)).length;
      panel.append(heading, node('p', `${client.instructionBytes.toLocaleString()} bytes · ${loaded.length} ${loaded.length === 1 ? 'source' : 'sources'} loaded${conditional ? ` · ${conditional} conditional` : ''}`, 'comparison-document-meta'));
      if (client.instructions) { const text = node('pre', client.instructions, 'comparison-document-text'); text.tabIndex = 0; text.setAttribute('aria-label', `${names[client.client]} effective instructions`); panel.append(text); }
      else panel.append(node('p', 'No proven active instruction text for this target.', 'comparison-document-text subtle'));
      panel.append(button('Trace this instruction chain →', () => { state.source = null; state.instructionView = 'sources'; navigate('effective', client.client); }, 'text-button'));
      return panel;
    }));
    const sources = report.sources.filter(source => ['instructions', 'rules'].includes(source.kind));
    const table = node('table', undefined, 'coverage-table');
    const head = node('thead'); const header = node('tr'); header.append(node('th', 'Instruction source'));
    clients.forEach(client => header.append(node('th', names[client.client]))); head.append(header); table.append(head);
    const body = node('tbody');
    let count = 0;
    for (const source of sources) {
      const decisions = clients.map(client => client.decisions.find(decision => decision.sourceId === source.id));
      if ($('differences-only').checked && new Set(decisions.map(decision => JSON.stringify([decision?.status ?? 'ignored', decision?.loadedBytes ?? 0, decision?.content ?? '']))).size <= 1) continue;
      const row = node('tr'); const label = node('td');
      label.append(button(basename(source.path), () => { state.sourceFilter = 'all'; navigate('effective', clients[0].client, source.path); }, 'source-link'), node('span', short(source.path), 'source-path')); row.append(label);
      decisions.forEach((decision, index) => {
        const cell = node('td');
        const action = button('', () => { state.sourceFilter = 'all'; navigate('effective', clients[index].client, source.path); }, 'source-link');
        action.append(badge(decision?.status ?? 'ignored')); action.title = decision?.reason ?? 'This client does not load this source.'; cell.append(action); row.append(cell);
      });
      body.append(row); count++;
    }
    table.append(body); $('comparison-matrix').replaceChildren(count ? table : empty('No instruction differences', 'The selected clients have the same loading status for every discovered instruction source.'));
    const extensionNames = [...new Set(clients.flatMap(client => client.extensions.map(extension => extension.kind + '|' + extension.name)))];
    const extensionTable = node('table', undefined, 'coverage-table');
    const extensionHead = node('thead'); const extensionHeader = node('tr'); extensionHeader.append(node('th', 'Extension'));
    clients.forEach(client => extensionHeader.append(node('th', names[client.client]))); extensionHead.append(extensionHeader); extensionTable.append(extensionHead);
    const extensionBody = node('tbody');
    for (const key of extensionNames) {
      const [kind, name] = key.split('|');
      const definitions = clients.map(client => client.extensions.filter(extension => extension.kind === kind && extension.name === name && ['active', 'conditional'].includes(extension.status)));
      if ($('differences-only').checked && new Set(definitions.map(items => JSON.stringify(items.map(item => item.config)))).size <= 1) continue;
      const row = node('tr'); const nameCell = node('td'); nameCell.append(node('strong', name), node('span', kind, 'source-path')); row.append(nameCell);
      definitions.forEach((items, index) => {
        const cell = node('td');
        if (items.length) cell.append(button(extensionSummary(items[0], clients[index].client), () => showExtension(items[0], clients[index].client), 'source-link'));
        else cell.append(node('span', '—', 'subtle'));
        row.append(cell);
      });
      extensionBody.append(row);
    }
    extensionTable.append(extensionBody);
    const wrapper = node('div', undefined, 'table-scroll'); wrapper.append(extensionTable);
    $('comparison-extensions').replaceChildren(extensionBody.children.length ? wrapper : empty('No extension differences', 'Try selecting another client or turning off Differences only.'));
  }
  function extensionSummary(extension, client) {
    if (extension.kind === 'mcp') {
      if (client === 'claude' && ['http', 'streamable-http', 'sse', 'ws'].includes(extension.config.type)) return extension.config.url || 'No endpoint configured';
      return extension.config.command ?? extension.config.url ?? 'Invalid definition';
    }
    if (extension.kind === 'hook') return extension.config.command ?? extension.config.bash ?? extension.config.powershell ?? extension.config.type ?? 'Hook';
    if (extension.kind === 'permission') return extension.config.action;
    return extension.config.description ?? 'No description';
  }
  function showExtension(extension, client) {
    $('detail-category').textContent = `${names[client]} / ${extension.kind}`;
    const content = node('div', undefined, 'dialog-content');
    const title = node('h2', extension.name); title.id = 'detail-title';
    const ignored = report.findings.filter(finding => finding.client === client && finding.ruleId === 'mcp.unsupported-field' && finding.location.path === extension.location.path && extension.location.key && finding.location.key?.startsWith(extension.location.key + '.'));
    content.append(badge(extension.status), title, node('p', extension.reason), node('p', `${short(extension.location.path)} · line ${extension.location.line}`, 'path'), node('h3', client === 'claude' && extension.kind === 'mcp' ? 'Declared configuration' : 'Configuration'), node('pre', JSON.stringify(extension.config, null, 2)));
    if (extension.origins?.length) {
      const origins = node('div', undefined, 'extension-origins setting-origins');
      origins.append(node('h3', 'Field definitions'));
      const mappings = [...report.pathMappings ?? []].filter(mapping => !mapping.replacement.startsWith('<repo>')).sort((a, b) => b.path.length - a.path.length);
      for (const origin of extension.origins) {
        const filename = origin.location.path;
        const mapping = mappings.find(mapping => filename === mapping.path || filename.startsWith(mapping.path + '/') || filename.startsWith(mapping.path + '\\'));
        const label = mapping ? mapping.replacement + filename.slice(mapping.path.length).replace(/\\/g, '/') : short(filename);
        const link = button('', () => inspectSourceLocation(origin.location, client), 'source-link');
        link.title = `${filename}:${origin.location.line}`;
        const unused = ignored.some(finding => origin.location.key === finding.location.key || origin.location.key?.startsWith(finding.location.key + '.'));
        link.append(node('span', origin.key + (unused ? ' (ignored) ·' : ' ·')), node('span', `${label}:${origin.location.line}`));
        origins.append(link);
      }
      content.append(origins);
    }
    const actions = node('div', undefined, 'dialog-actions');
    actions.append(button('Inspect source →', () => { $('detail-dialog').close(); state.sourceFilter = 'all'; state.highlightLine = extension.location.line; navigate('effective', client, extension.location.path); }, 'button button-primary'), button('Copy definition', () => copy(JSON.stringify(extension.config, null, 2))));
    content.append(actions); $('detail-body').replaceChildren(content); if (!$('detail-dialog').open) $('detail-dialog').showModal();
  }
  function renderExtensions() {
    const kind = state.extensionKind;
    const clientFilter = $('extension-client').value;
    const extensions = report.clients.filter(client => clientFilter === 'all' || client.client === clientFilter).flatMap(client => client.extensions.filter(extension => kind === 'all' || extension.kind === kind).map(extension => ({ extension, client: client.client })));
    document.querySelectorAll('[data-kind]').forEach(element => element.setAttribute('aria-pressed', String(element.dataset.kind === kind)));
    const list = node('div', undefined, 'issue-list');
    for (const { extension, client } of extensions) {
      const row = button('', () => showExtension(extension, client), 'extension-row');
      const label = node('div'); label.append(node('strong', extension.name), node('span', extensionSummary(extension, client), 'extension-command'));
      row.append(avatar(client), label, node('span', extension.kind === 'mcp' ? 'MCP server' : extension.kind, 'extension-kind'), badge(extension.status), node('span', '›', 'row-arrow')); list.append(row);
    }
    $('extension-list').replaceChildren(extensions.length ? list : empty('No extensions in this view', 'Choose another type or client to see its discovered definitions.'));
  }
  function renderScope() {
    const notes = [...report.assumptions];
    if (report.discovery) {
      const entryUnit = report.discovery.repositoryEntries === 1 ? 'entry' : 'entries';
      notes.push(`Repository discovery examined ${report.discovery.repositoryEntries.toLocaleString()} filesystem ${entryUnit} with a budget of ${report.discovery.repositoryEntryLimit.toLocaleString()}.`);
      if (!report.assumptions.includes('User configuration: excluded.')) notes.push(`User configuration discovery allows ${report.discovery.userFileLimit.toLocaleString()} matching files per root.`);
      if (!report.discovery.complete) notes.push('Run the CLI with --severity warn to review skipped locations and discovery limits.');
    }
    $('assumptions').replaceChildren(...notes.map(assumption => node('li', assumption)));
    $('adapter-details').replaceChildren(...report.clients.map(client => {
      const details = node('details', undefined, 'adapter-detail');
      details.append(node('summary', `${names[client.client]} · ${client.metadata.maturity === 'verified' ? 'Fixture verified' : 'Experimental'} · ${client.metadata.ruleVersion}`));
      const list = node('ul'); client.metadata.limitations.forEach(limit => list.append(node('li', limit))); details.append(list);
      client.metadata.evidence.forEach(url => { const link = node('a', url); link.href = url; link.target = '_blank'; link.rel = 'noreferrer'; details.append(link); });
      return details;
    }));
  }
  function render() {
    const project = basename(report.repository);
    $('tool-version').textContent = report.tool.version;
    $('project-name').textContent = project === '<repo>' ? 'Shared report' : project;
    $('workspace-name').textContent = project === '<repo>' ? 'Shared report' : project;
    $('repository').textContent = report.repository;
    $('target').value = short(report.target);
    $('codex-profile').value = report.inputs?.codexProfile ?? '';
    $('profile-form').hidden = !live || !report.clients.some(client => client.client === 'codex') || report.assumptions.includes('User configuration: excluded.');
    $('footer-target').textContent = short(report.target);
    const groups = groupFindings();
    $('finding-count').textContent = String(groups.length);
    $('overview-count').textContent = String(groups.filter(finding => finding.severity !== 'info').length);
    $('extension-count').textContent = String(report.clients.reduce((count, client) => count + client.extensions.filter(extension => extension.status === 'active' || extension.status === 'conditional').length, 0));
    $('setting-count').textContent = String(report.clients.reduce((count, client) => count + client.settings.filter(setting => setting.status !== 'shadowed').length, 0));
    for (const id of ['finding-client', 'extension-client', 'setting-client']) {
      const previous = $(id).value;
      $(id).replaceChildren();
      const all = node('option', 'All clients'); all.value = 'all'; $(id).append(all);
      report.clients.forEach(client => { const option = node('option', names[client.client]); option.value = client.client; $(id).append(option); });
      $(id).value = [...$(id).options].some(option => option.value === previous) ? previous : 'all';
    }
    renderNavigation(); renderOverview(); renderScope();
    if (state.view === 'effective') renderInstructions();
    if (state.view === 'configuration') renderSettings();
    if (state.view === 'findings') renderFindings();
    if (state.view === 'compare') renderCompare();
    if (state.view === 'extensions') renderExtensions();
  }
  function renderScanStatus(succeeded = true) {
    const incomplete = report.discovery?.complete === false;
    const completedLabel = incomplete ? 'Discovery incomplete' : 'Scan complete';
    const label = succeeded ? completedLabel : 'Scan failed';
    $('scan-status').classList.remove('scanning');
    $('scan-status').classList.toggle('failed', !succeeded);
    $('scan-status').classList.toggle('partial', succeeded && incomplete);
    $('scan-status').replaceChildren(node('span', undefined, 'connection'), node('span', label));
  }
  async function refresh(target = short(report.target)) {
    if (!live) return;
    const request = ++state.request;
    scanController?.abort(); scanController = new AbortController();
    $('error').hidden = true; $('inspect').disabled = true; $('refresh').disabled = true;
    $('scan-status').classList.remove('failed', 'partial'); $('scan-status').classList.add('scanning');
    $('scan-status').replaceChildren(node('span', undefined, 'connection'), node('span', 'Inspecting…'));
    let succeeded = false;
    try {
      const query = new URLSearchParams({ target, trust: $('trust').value, profile: $('codex-profile').value.trim(), include: 'html' });
      const response = await fetch(`/api/scan?${query}`, { signal: scanController.signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (request !== state.request) return;
      report = data.report;
      exportDocument = data.html;
      if (!report.sources.some(source => source.path === state.source)) state.source = null;
      state.highlightLine = null;
      const address = new URL(location.href);
      address.searchParams.set('target', short(report.target)); address.searchParams.set('trust', $('trust').value); address.searchParams.set('profile', report.inputs?.codexProfile ?? '');
      history.replaceState(null, '', address);
      render(); toast('Configuration updated');
      succeeded = true;
    } catch (error) {
      if (error.name !== 'AbortError' && request === state.request) { $('error').textContent = error.message; $('error').hidden = false; }
    } finally {
      if (request === state.request) {
        $('inspect').disabled = false; $('refresh').disabled = false;
        renderScanStatus(succeeded);
      }
    }
  }
  document.querySelectorAll('[data-view]').forEach(element => { element.onclick = () => navigate(element.dataset.view); });
  document.querySelector('.brand').onclick = event => { event.preventDefault(); navigate('overview'); };
  document.querySelectorAll('[data-instruction-view]').forEach(element => { element.onclick = () => { state.instructionView = element.dataset.instructionView; navigate('effective', state.client); }; });
  document.querySelectorAll('[data-go]').forEach(element => { element.onclick = () => navigate(element.dataset.go); });
  document.querySelectorAll('[data-source-filter]').forEach(element => { element.onclick = () => { state.sourceFilter = element.dataset.sourceFilter; renderSourceList(); }; });
  document.querySelectorAll('[data-kind]').forEach(element => { element.onclick = () => { state.extensionKind = element.dataset.kind; renderExtensions(); }; });
  document.querySelectorAll('[data-close-dialog]').forEach(element => { element.onclick = () => element.closest('dialog').close(); });
  document.querySelectorAll('dialog').forEach(dialog => { dialog.onclick = event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } }; });
  $('mobile-menu').onclick = () => { const open = document.body.classList.toggle('nav-open'); $('mobile-menu').setAttribute('aria-expanded', String(open)); $('navigation-scrim').hidden = !open; };
  $('navigation-scrim').onclick = () => { document.body.classList.remove('nav-open'); $('mobile-menu').setAttribute('aria-expanded', 'false'); $('navigation-scrim').hidden = true; $('mobile-menu').focus(); };
  $('source-search').oninput = renderSourceList;
  $('finding-search').oninput = renderFindings;
  $('severity').onchange = renderFindings;
  $('finding-client').onchange = renderFindings;
  $('setting-search').oninput = renderSettings;
  $('setting-client').onchange = renderSettings;
  $('include-shadowed').onchange = renderSettings;
  $('extension-client').onchange = renderExtensions;
  $('differences-only').onchange = renderCompare;
  $('review-findings').onclick = () => { $('severity').value = 'actionable'; navigate('findings'); };
  $('scope-button').onclick = () => $('scope-dialog').showModal();
  $('help-button').onclick = () => $('help-dialog').showModal();
  $('target-form').onsubmit = event => { event.preventDefault(); closeTargetPicker(); void refresh($('target').value.trim() || '.'); };
  $('target').onfocus = () => searchTargetFiles(true);
  $('target').oninput = () => searchTargetFiles();
  $('target').onblur = () => closeTargetPicker();
  $('target').onkeydown = event => {
    if (!live || event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeTargetPicker(); }
    if (event.key === 'Tab') closeTargetPicker();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if ($('target-picker').hidden) searchTargetFiles(true); else moveTargetSelection(event.key === 'ArrowDown' ? 1 : -1);
    }
    if (event.key === 'Enter' && !$('target-picker').hidden && targetIndex >= 0) { event.preventDefault(); chooseTarget(targetItems[targetIndex]); }
  };
  document.addEventListener('pointerdown', event => { if (!$('target-form').contains(event.target)) closeTargetPicker(); });
  $('refresh').onclick = () => void refresh();
  $('trust').onchange = () => void refresh();
  $('profile-form').onsubmit = event => { event.preventDefault(); void refresh(); };
  $('export').onclick = () => {
    const url = URL.createObjectURL(new Blob([exportDocument], { type: 'text/html' }));
    const anchor = node('a'); anchor.href = url; anchor.download = 'sightline-report.html'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('nav-open')) $('navigation-scrim').click();
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); if (live) { if (document.activeElement === $('target')) searchTargetFiles(true); else $('target').focus(); $('target').select(); } else toast('This report is a snapshot. Open the local CLI to inspect another file.'); }
    if (event.key === '?' && !editing && !document.querySelector('dialog[open]')) $('help-dialog').showModal();
    if (event.key === '/' && !editing && !document.querySelector('dialog[open]')) { event.preventDefault(); navigate('effective'); $('source-search').focus(); }
    if (['ArrowUp', 'ArrowDown'].includes(event.key) && document.activeElement.classList.contains('source')) {
      event.preventDefault(); const items = [...document.querySelectorAll('.source')]; const index = items.indexOf(document.activeElement);
      items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    }
  });
  function readLocation() {
    const hash = new URLSearchParams(location.hash.slice(1));
    state.view = viewLabels[hash.get('view')] ? hash.get('view') : 'overview';
    if (report.clients.some(client => client.client === hash.get('client'))) state.client = hash.get('client');
    state.instructionView = hash.get('text') === 'effective' ? 'document' : 'sources';
    const sourcePath = hash.get('source');
    state.source = sourcePath ? report.sources.find(source => short(source.path) === sourcePath)?.path ?? null : null;
  }
  readLocation();
  window.addEventListener('popstate', () => {
    if (location.hash === '#main-content') return;
    readLocation();
    if (live) {
      const params = new URLSearchParams(location.search);
      const target = params.get('target') ?? initialTarget;
      const trust = params.get('trust') ?? initialTrust;
      const profile = params.get('profile') ?? initialProfile;
      if (target !== short(report.target) || trust !== $('trust').value || profile !== (report.inputs?.codexProfile ?? '')) { $('trust').value = trust; $('codex-profile').value = profile; void refresh(target); return; }
    }
    render();
  });
  if (state.compareClients.size < 2) report.clients.slice(0, 3).forEach(client => state.compareClients.add(client.client));
  const trustAssumption = report.assumptions.find(assumption => assumption.startsWith('Trust:')) ?? '';
  if (trustAssumption.includes('trusted;')) $('trust').value = 'trusted';
  if (trustAssumption.includes('untrusted;')) $('trust').value = 'untrusted';
  const initialTrust = $('trust').value;
  const initialProfile = report.inputs?.codexProfile ?? '';
  $('codex-profile').value = initialProfile;
  if (!live) {
    $('target').readOnly = true; $('inspect').hidden = true; $('refresh').hidden = true;
    ['role', 'aria-autocomplete', 'aria-controls', 'aria-expanded'].forEach(attribute => $('target').removeAttribute(attribute));
    $('target-shortcut').hidden = true; $('trust-control').hidden = true; $('snapshot-label').hidden = false;
    $('mode-label').textContent = 'Report snapshot'; $('project-caption').textContent = 'Shared configuration report';
  }
  renderScanStatus();
  render();
})();
