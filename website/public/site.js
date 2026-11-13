(() => {
  const $ = id => document.getElementById(id);
  const basePath = new URL('.', document.currentScript.src).pathname;
  let report;
  let clientId = 'codex';
  let selectedPath;
  let toastTimer;
  const basename = value => value.replace(/\\/g, '/').split('/').pop();
  const statusNames = { active: 'Loaded', conditional: 'Conditional', shadowed: 'Shadowed', ignored: 'Not loaded', truncated: 'Truncated', invalid: 'Invalid' };
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
    document.querySelectorAll('[data-demo-client]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.demoClient === clientId)));
    document.querySelectorAll('[data-hero-client]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.heroClient === clientId)));
    const hero = document.querySelector('.hero');
    if (hero) hero.dataset.client = clientId;
    $('demo-sources').replaceChildren(...sources.map(source => {
      const button = node('button', undefined, `demo-source${source.path === selected.path ? ' selected' : ''}`);
      button.title = source.path + ' — ' + source.reason;
      button.append(node('span', source.order === null ? '—' : String(source.order).padStart(2, '0'), 'source-number'), node('span', basename(source.path), 'source-label'), node('span', undefined, `source-state-dot ${source.status}`));
      button.onclick = () => { selectedPath = source.path; renderDemo(); };
      return button;
    }));
    $('demo-file').textContent = basename(selected.path);
    $('demo-status').textContent = statusNames[selected.status];
    $('demo-status').className = `demo-status${['truncated', 'conditional'].includes(selected.status) ? ' warn' : ''}`;
    const text = selected.content || report.sources.find(source => source.id === selected.sourceId)?.preview || 'This source contributes no instruction content to this client.';
    $('demo-code').replaceChildren(...text.split('\n').slice(0, 7).map((line, index) => {
      const row = node('div', undefined, 'demo-code-line');
      row.append(node('span', String(selected.line + index)), node('span', line || ' '));
      return row;
    }));
    const clientNames = { codex: 'Codex', claude: 'Claude Code', copilot: 'Copilot' };
    $('demo-reason-title').textContent = selected.status === 'truncated' ? `Only ${selected.loadedBytes} of ${selected.bytes} bytes reach ${clientNames[clientId]}.` : selected.status === 'active' ? `This source reaches ${clientNames[clientId]}.` : `This source is ${statusNames[selected.status].toLowerCase()} for ${clientNames[clientId]}.`;
    $('demo-reason').textContent = selected.reason;
    if ($('hero-source')) {
      $('hero-source').textContent = basename(selected.path);
      $('hero-verdict').textContent = selected.status === 'truncated'
        ? `${selected.loadedBytes} of ${selected.bytes} bytes reach ${clientNames[clientId]}`
        : `${statusNames[selected.status]} for ${clientNames[clientId]}`;
    }
    document.dispatchEvent(new window.CustomEvent('sightline:client-change', { detail: { client: clientId } }));
  }
  if ($('demo-sources')) fetch(basePath + 'demo-report.json').then(response => response.json()).then(data => { report = data; renderDemo(); }).catch(() => {
    $('demo-reason').textContent = 'Open the full bundled demo to inspect source loading and configuration findings.';
  });
  document.querySelectorAll('[data-demo-client]').forEach(button => {
    button.onclick = () => { clientId = button.dataset.demoClient; selectedPath = null; if (report) renderDemo(); };
  });
  document.querySelectorAll('[data-hero-client]').forEach(button => {
    button.onclick = () => { clientId = button.dataset.heroClient; selectedPath = null; if (report) renderDemo(); };
  });
  const workflows = {
    trace: { image: basePath + 'images/instructions.png', alt: 'The instruction explorer shows a source file, its loading order and provenance', caption: 'Inspect a source, read its loaded content, and see why it applies to your target file.', link: basePath + 'demo/#view=effective&client=codex' },
    find: { image: basePath + 'images/finding.png', alt: 'A finding explains the issue, exact source and suggested resolution', caption: 'A finding connects the problem, its source location and the next step in one place.', link: basePath + 'demo/#view=findings' },
    compare: { image: basePath + 'images/compare.png', alt: 'Instruction paragraphs grouped by receiving clients with original source lines', caption: 'Find shared paragraphs across different files and follow each client to the original source lines.', link: basePath + 'demo/#view=compare' },
  };
  document.querySelectorAll('[data-workflow]').forEach(button => {
    button.onclick = () => {
      const selected = workflows[button.dataset.workflow];
      document.querySelectorAll('[data-workflow]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      $('workflow-image').src = selected.image;
      $('workflow-image').alt = selected.alt;
      $('workflow-caption').textContent = selected.caption;
      $('workflow-link').href = selected.link;
    };
  });
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.onclick = async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        $('site-toast').textContent = 'Copied to clipboard'; $('site-toast').hidden = false;
        clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('site-toast').hidden = true; }, 2000);
      } catch {
        const text = button.previousElementSibling;
        if (text) { const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
      }
    };
  });
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
