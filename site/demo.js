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
    { side: 'original', command: '/init', output: ['Branch: feature/checkout-tax', 'Mirror created: ~/ai-mirrors/shop-api-ai'], caption: 'A separate Git repository is created for the active branch.' },
    { side: 'mirror', command: 'codex', output: ['AI harness connected to the mirror', 'AGENTS-AIMP.md loaded'], caption: 'The AI starts inside the mirror. It has no reason to open the original.' },
    { side: 'mirror', command: 'edit checkout/tax.py', output: ['+ TAX_RATE = Decimal(\"0.11\")', '+ subtotal + (subtotal * TAX_RATE)', '2 files changed'], mirrorCode: 'changed', caption: 'The AI changes the mirror and adds a test. The original is still untouched.' },
    { side: 'mirror', command: 'cat AIMP_REPORT.md', output: ['Status: ready', 'Summary: Added an 11% tax calculation and unit tests.', 'Tests: pytest checkout/tests/test_tax.py'], caption: 'The report is the handoff: summary, commit message, tests, and notes.' },
    { side: 'original', command: '/status', output: ['Original: clean', 'AI pending: true', 'Changed paths: 2'], caption: 'From the original, you can see that only the mirror has pending work.' },
    { side: 'original', command: '/get-summary', output: ['Added an 11% tax calculation and unit tests.', 'Shipping remains exempt.'], caption: 'Read the AI summary before looking at the diff.' },
    { side: 'original', command: '/diff', output: ['modified  \"checkout/tax.py\"', 'added     \"checkout/tests/test_tax.py\"', '- return sum(item.price for item in items)', '+ return subtotal + (subtotal * TAX_RATE)'], caption: 'Review the exact paths and lines that would cross the boundary.' },
    { side: 'original', command: '/sync', output: ['2 paths ready to apply', 'Original remains uncommitted'], caption: 'Sync prepares the reviewed batch and asks for explicit approval.' },
    { side: 'original', command: 'y', output: ['Applying approved files...', 'Checkpoint AI: 4f2a... (synced)'], originalCode: 'changed', caption: 'Only after confirmation does the change move into the original project.' },
    { side: 'original', command: '/status', output: ['Original: dirty (2 files)', 'AI pending: false', 'Original HEAD: unchanged'], caption: 'The original now contains your reviewed change, ready for your tests.' },
    { side: 'mirror', command: 'git log -1', output: ['chore: Add checkout tax calculation (synced)', 'working tree clean'], caption: 'A local checkpoint keeps the AI-side trace. You commit the original yourself.' },
  ];

  const root = document.querySelector('[data-demo-section]') || document.querySelector('.demo-section');
  if (!root) return;
  const screens = {
    original: root.querySelector('[data-demo-screen="original"]'),
    mirror: root.querySelector('[data-demo-screen="mirror"]'),
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

  function resetView() {
    screens.original.textContent = '';
    screens.mirror.textContent = '';
    setCode('baseline', 'baseline');
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
      cancel();
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
