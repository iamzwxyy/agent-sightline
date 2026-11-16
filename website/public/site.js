(() => {
  const $ = id => document.getElementById(id);
  const translations = JSON.parse($('site-translations')?.textContent ?? '{}');
  const translate = (text, values = {}) => (translations[text] ?? text).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match);
  const basePath = new URL('.', document.currentScript.src).pathname;
  let report;
  let clientId = 'codex';
  let selectedPath;
  let toastTimer;
  let copyTrigger;
  const basename = value => value.replace(/\\/g, '/').split('/').pop();
  const statusNames = Object.fromEntries(Object.entries({ active: 'Loaded', conditional: 'Conditional', shadowed: 'Shadowed', ignored: 'Not loaded', truncated: 'Truncated', invalid: 'Invalid' }).map(([status, label]) => [status, translate(label)]));
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function renderDemo() {
    const client = report.clients.find(item => item.client === clientId);
    const instructions = client.decisions.filter(source => ['instructions', 'rules'].includes(source.kind));
    const sources = [...instructions].sort((left, right) => (left.order ?? 99999) - (right.order ?? 99999)).slice(0, 7);
    const selected = sources.find(source => source.path === selectedPath) ?? sources.find(source => source.status === 'truncated') ?? sources.find(source => source.status === 'active') ?? sources[0];
    if (!selected) return;
    selectedPath = selected.path;
    document.querySelectorAll('[data-demo-client]').forEach(button => {
      const selected = button.dataset.demoClient === clientId;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $('demo-panel').setAttribute('aria-labelledby', `demo-tab-${clientId}`);
    document.querySelectorAll('[data-hero-client]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.heroClient === clientId)));
    const hero = document.querySelector('.hero');
    if (hero) hero.dataset.client = clientId;
    const focusedSource = document.activeElement?.dataset.demoSource;
    const sourceButtons = sources.map(source => {
      const button = node('button', undefined, `demo-source${source.path === selected.path ? ' selected' : ''}`);
      button.type = 'button';
      button.lang = 'en';
      button.dataset.demoSource = source.path;
      button.setAttribute('aria-pressed', String(source.path === selected.path));
      button.title = source.path + ' — ' + source.reason;
      button.append(node('span', source.order === null ? '—' : String(source.order).padStart(2, '0'), 'source-number'), node('span', basename(source.path), 'source-label'), node('span', undefined, `source-state-dot ${source.status}`));
      button.onclick = () => { selectedPath = source.path; renderDemo(); };
      return button;
    });
    $('demo-sources').replaceChildren(...sourceButtons);
    sourceButtons.find(button => button.dataset.demoSource === focusedSource)?.focus({ preventScroll: true });
    const repositoryPrefix = report.repository.replace(/\\/g, '/') + '/';
    const normalizedPath = selected.path.replace(/\\/g, '/');
    const sourcePath = normalizedPath.startsWith(repositoryPrefix) ? normalizedPath.slice(repositoryPrefix.length) : normalizedPath;
    const selection = new URLSearchParams({ view: 'effective', client: clientId, source: sourcePath, line: String(selected.line) });
    document.querySelectorAll('[data-inspector-link]').forEach(link => { link.href = basePath + 'demo/#' + selection; });
    $('demo-file').textContent = basename(selected.path);
    $('demo-status').textContent = statusNames[selected.status];
    $('demo-status').className = `demo-status${['truncated', 'conditional'].includes(selected.status) ? ' warn' : ''}`;
    const sourceText = selected.content || report.sources.find(source => source.id === selected.sourceId)?.preview;
    const text = sourceText || translate('This source contributes no instruction content to this client.');
    $('demo-code').lang = sourceText ? 'en' : document.documentElement.lang;
    $('demo-code').replaceChildren(...text.split('\n').slice(0, 7).map((line, index) => {
      const row = node('div', undefined, 'demo-code-line');
      row.append(node('span', String(selected.line + index)), node('span', line || ' '));
      return row;
    }));
    const clientNames = { codex: 'Codex', claude: 'Claude Code', copilot: 'Copilot' };
    const details = { loaded: selected.loadedBytes, total: selected.bytes, client: clientNames[clientId], status: statusNames[selected.status].toLowerCase() };
    $('demo-reason-title').textContent = selected.status === 'truncated' ? translate('Only {loaded} of {total} bytes reach {client}.', details) : selected.status === 'active' ? translate('This source reaches {client}.', details) : translate('This source is {status} for {client}.', details);
    $('demo-reason').textContent = selected.reason;
    $('demo-reason').lang = 'en';
    if ($('hero-source')) {
      $('hero-source').textContent = basename(selected.path);
      $('hero-verdict').textContent = selected.status === 'truncated'
        ? translate('{loaded} of {total} bytes reach {client}', details)
        : translate('{status} for {client}', { ...details, status: statusNames[selected.status] });
    }
    document.dispatchEvent(new window.CustomEvent('sightline:client-change', { detail: { client: clientId } }));
  }
  if ($('demo-sources')) fetch(basePath + 'demo-report.json').then(response => response.json()).then(data => { report = data; renderDemo(); }).catch(() => {
    $('demo-reason').textContent = translate('Open the full bundled demo to inspect source loading and configuration findings.');
  });
  document.querySelectorAll('[data-demo-client], [data-hero-client]').forEach(button => {
    button.onclick = () => {
      clientId = button.dataset.demoClient ?? button.dataset.heroClient;
      selectedPath = null;
      const selection = new URLSearchParams({ view: 'effective', client: clientId });
      document.querySelectorAll('[data-inspector-link]').forEach(link => { link.href = basePath + 'demo/#' + selection; });
      if (report) renderDemo();
    };
  });
  const workflows = {
    trace: { image: basePath + 'images/instructions.png', alt: 'The instruction explorer shows a source file, its loading order and provenance', caption: 'Inspect a source, read its loaded content, and see why it applies to your target file.', link: basePath + 'demo/#view=effective&client=codex' },
    find: { image: basePath + 'images/finding.png', alt: 'A finding explains the issue, exact source and suggested resolution', caption: 'A finding connects the problem, its source location and the next step in one place.', link: basePath + 'demo/#view=findings' },
    compare: { image: basePath + 'images/compare.png', alt: 'Instruction paragraphs grouped by receiving clients with original source lines', caption: 'Find shared paragraphs across different files and follow each client to the original source lines.', link: basePath + 'demo/#view=compare' },
  };
  document.querySelectorAll('[data-workflow]').forEach(button => {
    button.onclick = () => {
      const selected = workflows[button.dataset.workflow];
      document.querySelectorAll('[data-workflow]').forEach(item => {
        item.setAttribute('aria-selected', String(item === button));
        item.tabIndex = item === button ? 0 : -1;
      });
      $('workflow-panel').setAttribute('aria-labelledby', button.id);
      $('workflow-image').src = selected.image;
      $('workflow-image').alt = translate(selected.alt);
      $('workflow-caption').textContent = translate(selected.caption);
      $('workflow-link').href = selected.link;
    };
  });
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        $('site-toast').textContent = translate('Copied to clipboard'); $('site-toast').hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('site-toast').hidden = true; }, 2000);
      } catch {
        copyTrigger = button;
        $('copy-command-text').value = button.dataset.copy;
        $('copy-command-dialog').showModal();
        $('copy-command-text').focus();
        $('copy-command-text').select();
      }
    };
  });
  $('close-copy-command').onclick = () => $('copy-command-dialog').close();
  $('copy-command-dialog').addEventListener('close', () => copyTrigger?.focus({ preventScroll: true }));
  function updateLanguageLinks() {
    const fragment = document.getElementById(location.hash.slice(1)) ? location.hash : '';
    document.querySelectorAll('[data-language]').forEach(link => { link.hash = fragment; });
  }
  updateLanguageLinks();
  window.addEventListener('hashchange', updateLanguageLinks);
  document.querySelectorAll('[role="tablist"]').forEach(list => {
    list.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const index = tabs.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      event.preventDefault(); tabs[next].focus(); tabs[next].click();
    });
  });
})();
