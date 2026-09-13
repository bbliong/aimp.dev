(() => {
  const originalCode = [
    'from decimal import Decimal',
    '',
    'def calculate_total(items):',
    '    return sum(item.price for item in items)',
  ].join('\n');
  const changedCode = [
    'from decimal import Decimal',
    '',
    'TAX_RATE = Decimal("0.11")',
    '',
    'def calculate_total(items):',
    '    subtotal = sum(item.price for item in items)',
    '    return subtotal + (subtotal * TAX_RATE)',
  ].join('\n');

  const steps = [
    { side: 'original', command: 'aimp', output: ['AIMP · AI Mirror Project', 'Original detected: ~/projects/shop-api'], caption: 'AIMP opens beside the original project.' },
    { side: 'original', command: '/help', output: ['/init  /reinit  /use  /status  /diff  /sync', '/sync-original-to-ai  /serialize  /recover  /doctor', '/migrate  /adopt-baseline  /adopt-policy', '/get-summary  /get-commit-message  /list  /log  /language  /exit'], caption: 'The same interface works with any AI harness or project.' },
    { side: 'original', command: '/language en', output: ['Language: en', 'Default interface selected'], caption: 'The interface can be switched before or after initialization.' },
    { side: 'original', command: '/init', output: ['Branch: feature/checkout-tax', 'Mirror created: ~/ai-mirrors/shop-api-ai', 'Created: AGENTS-AIMP.md', 'Created: AIMP_REPORT.md'], caption: 'A separate Git repository is created with two AIMP control files: rules for the AI and a report for your review.' },
    { side: 'original', command: '/status', output: ['Original: clean', 'AI pending: false', 'State: CLEAN'], caption: 'The original starts clean before any AI work.' },
    { side: 'original', command: '/list', output: ['feature/checkout-tax → ~/ai-mirrors/shop-api-ai'], caption: 'AIMP records the original branch and its paired mirror branch.' },
    { side: 'mirror', command: 'codex', output: ['AI harness connected to the mirror', 'AGENTS-AIMP.md loaded', 'Read and edit only this workspace'], caption: 'The AI reads AGENTS-AIMP.md and stays inside the mirror.' },
    { side: 'mirror', command: 'cat AGENTS-AIMP.md', output: ['This is the mirror for feature/checkout-tax', 'Complete AIMP_REPORT.md after each batch', 'Do not access the original project'], caption: 'The rules explain the boundary and ask the AI to complete the report.' },
    { side: 'mirror', command: 'edit checkout/tax.py', output: ['+ TAX_RATE = Decimal(\"0.11\")', '+ subtotal + (subtotal * TAX_RATE)', '2 files changed'], mirrorCode: 'changed', caption: 'The AI changes the mirror and adds a test. The original is still untouched.' },
    { side: 'mirror', command: 'git status --short', output: [' M checkout/tax.py', '?? checkout/tests/test_tax.py'], caption: 'Git shows exactly what the AI changed in its workspace.' },
    { side: 'mirror', command: 'edit AIMP_REPORT.md', output: ['Summary completed', 'Commit Message completed', 'Tests and Notes completed', 'Status: ready'], caption: 'The AI fills AIMP_REPORT.md so the user can review an explicit handoff.' },
    { side: 'mirror', command: 'git diff --stat', output: ['checkout/tax.py             | 5 ++++', 'checkout/tests/test_tax.py | 8 ++++++++'], caption: 'The mirror diff is small enough to inspect before leaving it.' },
    { side: 'original', command: '/status', output: ['Original: clean', 'AI pending: true', 'Changed paths: 2'], caption: 'From the original, only the mirror is pending.' },
    { side: 'original', command: '/get-summary', output: ['Added an 11% tax calculation and unit tests.', 'Shipping remains exempt.'], caption: 'Read the AI summary before looking at the diff.' },
    { side: 'original', command: '/get-commit-message', output: ['Add checkout tax calculation'], caption: 'The proposed commit subject is visible before approval.' },
    { side: 'original', command: '/diff', output: ['modified  \"checkout/tax.py\"', 'added     \"checkout/tests/test_tax.py\"', '- return sum(item.price for item in items)', '+ return subtotal + (subtotal * TAX_RATE)'], caption: 'Review the exact paths and lines that would cross the boundary.' },
    { side: 'original', command: '/sync --dry-run', output: ['2 paths ready to apply', 'No files written · no commit created'], caption: 'A dry run previews the transaction without touching either working tree.' },
    { side: 'original', command: '/sync', output: ['2 paths ready to apply', 'Original remains uncommitted', 'Awaiting confirmation...'], caption: 'Sync prepares the reviewed batch and asks for explicit approval.' },
    { side: 'original', command: 'y', output: ['Applying approved files...', 'Original files updated', 'Checkpoint AI: 4f2a... (synced)'], originalCode: 'changed', caption: 'Only after confirmation does the change move into the original project.' },
    { side: 'mirror', command: 'git log -1', output: ['chore: Add checkout tax calculation (synced)', 'Local mirror commit created', 'working tree clean'], caption: 'Every approved sync creates a new local commit in the mirror.' },
    { side: 'original', command: '/status', output: ['Original: dirty (2 files)', 'AI pending: false', 'Original HEAD: unchanged'], caption: 'The original now contains the reviewed change, still uncommitted.' },
    { side: 'original', command: 'pytest checkout/tests/test_tax.py', output: ['2 passed in 0.18s'], caption: 'Run the application tests in the original project with real project settings.' },
    { side: 'original', command: 'git commit -am \"Add checkout tax calculation\"', output: ['[feature/checkout-tax 8ab21c4] Add checkout tax calculation', '2 files changed'], caption: 'You create the original-project commit with your normal Git workflow.' },
    { side: 'original', command: '/sync-original-to-ai', output: ['Original commit detected: 8ab21c4', 'Mirror refreshed', 'Local checkpoint created'], caption: 'Later original commits can be refreshed into the mirror manually.' },
    { side: 'original', command: '/doctor', output: ['original: ok', 'pair: ok', 'recoveryRequired: false', 'AIMP is ready'], caption: 'The walkthrough ends with a health check and a clean two-way trace.' },
  ];

  const root = document.querySelector('[data-demo-section]') || document.querySelector('.demo-section');
  if (!root) return;
  const screens = {
    original: root.querySelector('[data-demo-screen="original"]'),
    mirror: root.querySelector('[data-demo-screen="mirror"]'),
  };
  const activeCommand = {
    original: root.querySelector('[data-demo-active="original"]'),
    mirror: root.querySelector('[data-demo-active="mirror"]'),
  };
  const code = {
    original: root.querySelector('[data-demo-code="original"]'),
    mirror: root.querySelector('[data-demo-code="mirror"]'),
  };
  const fileState = {
    original: root.querySelector('[data-demo-file-state="original"]'),
    mirror: root.querySelector('[data-demo-file-state="mirror"]'),
  };
  const caption = root.querySelector('[data-demo-caption]');
  const progress = root.querySelector('[data-demo-progress]');
  const toggle = root.querySelector('[data-demo-action="toggle"]');
  const next = root.querySelector('[data-demo-action="next"]');
  const replay = root.querySelector('[data-demo-action="replay"]');
  const speed = root.querySelector('[data-demo-speed]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let current = -1;
  let running = false;
  let runToken = 0;
  let rate = 1;
  let started = false;

  const wait = (ms, token) => new Promise(resolve => {
    window.setTimeout(() => resolve(token === runToken), ms / rate);
  });

  function addLine(side, text, type) {
    const line = document.createElement('div');
    line.className = 'demo-line ' + (type || 'output');
    line.textContent = text;
    screens[side].appendChild(line);
    screens[side].scrollTop = screens[side].scrollHeight;
  }

  function setCode(originalState, mirrorState) {
    code.original.textContent = originalState === 'changed' ? changedCode : originalCode;
    code.mirror.textContent = mirrorState === 'changed' ? changedCode : originalCode;
    fileState.original.textContent = originalState === 'changed' ? 'updated · uncommitted' : 'original';
    fileState.mirror.textContent = mirrorState === 'changed' ? 'AI edit' : 'baseline';
  }

  function setActiveCommand(side, command) {
    Object.keys(activeCommand).forEach(name => {
      activeCommand[name].textContent = name === side ? '[Active screen: ' + name + '] ' + command : '[Idle screen: ' + name + '] waiting';
      activeCommand[name].classList.toggle('is-active', name === side);
    });
  }

  function resetView() {
    screens.original.textContent = '';
    screens.mirror.textContent = '';
    setCode('baseline', 'baseline');
    setActiveCommand('', 'waiting');
    caption.textContent = 'AIMP starts from a clean original branch.';
    current = -1;
    progress.textContent = 'Step 1 / ' + steps.length;
    toggle.textContent = 'Play';
    next.disabled = false;
  }

  function applyStatic(until) {
    resetView();
    let originalState = 'baseline';
    let mirrorState = 'baseline';
    for (let i = 0; i <= until; i += 1) {
      const step = steps[i];
      addLine(step.side, '$ ' + step.command, 'command');
      step.output.forEach(line => addLine(step.side, line, line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : 'output'));
      if (step.originalCode) originalState = step.originalCode;
      if (step.mirrorCode) mirrorState = step.mirrorCode;
      setCode(originalState, mirrorState);
      setActiveCommand(step.side, step.command);
      caption.textContent = step.caption;
    }
    current = until;
    progress.textContent = 'Step ' + (current + 1) + ' / ' + steps.length;
    toggle.textContent = current >= steps.length - 1 ? 'Replay' : 'Play';
    next.disabled = current >= steps.length - 1;
  }

  async function playStep(index) {
    if (index >= steps.length) {
      running = false;
      toggle.textContent = 'Replay';
      next.disabled = true;
      return;
    }
    const token = runToken;
    current = index;
    const step = steps[index];
    progress.textContent = 'Step ' + (index + 1) + ' / ' + steps.length;
    setActiveCommand(step.side, step.command);
    root.querySelectorAll('.demo-terminal').forEach(panel => panel.classList.toggle('is-active', panel.dataset.demoTerminal === step.side));
    addLine(step.side, '$ ', 'command');
    for (const character of step.command) {
      if (!(await wait(32, token)) || token !== runToken) return;
      const last = screens[step.side].lastElementChild;
      if (last) last.textContent += character;
    }
    for (const line of step.output) {
      if (!(await wait(260, token)) || token !== runToken) return;
      addLine(step.side, line, line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-del' : line.includes('clean') ? 'success' : 'output');
    }
    if (step.originalCode) code.original.textContent = changedCode;
    if (step.mirrorCode) code.mirror.textContent = changedCode;
    if (step.originalCode) fileState.original.textContent = 'updated · uncommitted';
    if (step.mirrorCode) fileState.mirror.textContent = 'AI edit';
    caption.textContent = step.caption;
    if (index < steps.length - 1 && running && (await wait(950, token))) {
      await playStep(index + 1);
    } else if (index >= steps.length - 1) {
      running = false;
      toggle.textContent = 'Replay';
      next.disabled = true;
    }
  }

  function cancel() {
    runToken += 1;
    running = false;
    root.querySelectorAll('.demo-terminal').forEach(panel => panel.classList.remove('is-active'));
  }

  function start() {
    if (running) return;
    if (current >= steps.length - 1) resetView();
    running = true;
    toggle.textContent = 'Pause';
    next.disabled = false;
    playStep(current + 1);
  }

  toggle.addEventListener('click', () => {
    if (running) {
      const interrupted = current;
      cancel();
      applyStatic(interrupted - 1);
      toggle.textContent = 'Play';
    } else {
      start();
    }
  });
  next.addEventListener('click', () => {
    cancel();
    applyStatic(Math.min(current + 1, steps.length - 1));
  });
  replay.addEventListener('click', () => {
    cancel();
    resetView();
    if (!reducedMotion && started) start();
  });
  speed.addEventListener('change', () => { rate = Number(speed.value) || 1; });

  resetView();
  if (reducedMotion) {
    applyStatic(0);
  } else {
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting) && !started) {
        started = true;
        start();
        observer.disconnect();
      }
    }, { threshold: 0.25 });
    observer.observe(root);
  }
})();
