import { stepStatus, statusLabels, workbenchDirections } from '/domain.mjs';

export function createWorkbenchUI({ getState, isDemo, mutate, refresh, focusDirection, escape: esc, readLocal, saveLocal, showError }) {
  const root = document.createElement('section'); root.id = 'workbench-root'; root.setAttribute('aria-label', 'Codex 协作工作区');
  root.innerHTML = `<nav class="wb-directions" aria-label="工作方向"></nav><section class="wb-console"><header class="wb-console-header"></header><div class="wb-surface"></div><footer class="wb-footer"><span><i></i> 进度与结论由你手动记录</span><span class="wb-key-hint">Shift + Enter 换行 · Enter 提交</span><button data-wb="bottom" disabled title="滚到最新输出并聚焦终端，可直接回答 Codex 的提问">回到底部 ↓</button></footer></section>`;
  const q = s => root.querySelector(s);
  q('.wb-console').insertAdjacentHTML('afterbegin', '<div class="wb-drop-hint">Codex 工作区 <span>← 将左侧方向拖到这里</span></div><div class="wb-drop-overlay">松开，打开这个方向的 Codex 工作区</div>');
  const terminals = new Map();
  const mountPaneResizer = createPaneResizer({ readLocal, saveLocal });
  let pinned = new Set();
  try { const saved = JSON.parse(readLocal('precision-pinned-directions')); if (Array.isArray(saved)) pinned = new Set(saved.filter(id => typeof id === 'string')); } catch {}
  let draggedDirection;
  const dragType = 'application/x-precision-direction';
  let metadata = new Map(), token, bootstrapPromise, projects = [], selected = readLocal('precision-direction'), mode = readLocal('precision-view') || 'cli', active = true;
  let navSignature = '', headerSignature = '', emptySignature = '';
  let appliedTheme;
  function terminalTheme() {
    const styles = getComputedStyle(document.documentElement);
    const color = name => styles.getPropertyValue(`--terminal-${name}`).trim();
    const palette = document.documentElement.dataset.theme === 'light'
      ? { black: '#1d2a3b', red: '#b42332', green: '#237743', yellow: '#8a6400', blue: '#245dba', magenta: '#8f3b9e', cyan: '#087e95', white: '#627185', brightBlack: '#627185', brightRed: '#b42332', brightGreen: '#237743', brightYellow: '#8a6400', brightBlue: '#245dba', brightMagenta: '#8f3b9e', brightCyan: '#087e95', brightWhite: '#1d2a3b' }
      : { black: '#1d2a3b', red: '#ef7b85', green: '#7bd99e', yellow: '#e9ca72', blue: '#85b4ff', magenta: '#d99ce5', cyan: '#70d5e5', white: '#dbe5f2', brightBlack: '#95a3b8', brightRed: '#ff9ca5', brightGreen: '#9cedb9', brightYellow: '#f8dc8a', brightBlue: '#abcaff', brightMagenta: '#efb8f8', brightCyan: '#a0ebf5', brightWhite: '#ffffff' };
    return { ...palette, background: color('bg'), foreground: color('fg'), cursor: color('accent'), cursorAccent: color('bg'), selectionBackground: color('selection'), selectionInactiveBackground: color('selection'), selectionForeground: color('fg'), scrollbarSliderBackground: color('scrollbar') };
  }
  function syncTerminalTheme() {
    const theme = document.documentElement.dataset.theme;
    if (theme === appliedTheme) return;
    appliedTheme = theme;
    const colors = terminalTheme();
    for (const t of terminals.values()) t.term.options.theme = colors;
  }
  const settings = document.createElement('dialog'); settings.id = 'workspace-settings'; settings.className = 'wb-dialog'; document.body.append(settings);
  const filesDialog = document.createElement('dialog'); filesDialog.id = 'workspace-files'; filesDialog.className = 'wb-dialog wb-files-dialog'; document.body.append(filesDialog);
  const allDirections = () => workbenchDirections(getState());
  const directionPath = d => [d.task.title, d.parent?.title].filter(Boolean).join(' / ');
  const visibleDirections = () => allDirections().filter(({ step }) => stepStatus(step) === 'active' || pinned.has(step.id) || ['running', 'stopping'].includes(metadata.get(step.id)?.status));
  const chosen = () => visibleDirections().find(({ step }) => step.id === selected);
  const activityClass = info => info?.status === 'running' ? ({ completed: 'is-complete', working: 'is-working', failed: 'is-failed' }[info.activity?.state] || 'live') : '';
  const label = info => info?.status === 'running'
    ? ({ completed: '本轮已完成', working: 'AI 工作中', idle: '等待输入', failed: '本轮出错', interrupted: '本轮已中断' }[info.activity?.state] || '终端运行中')
    : ({ stopping: '正在退出', exited: '终端已退出' }[info?.status] || '尚未启动');
  const handleError = error => showError(error.message || String(error));
  const safe = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(handleError);
  async function bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    bootstrapPromise = fetch('/api/workbench/bootstrap').then(r => { if (!r.ok) throw new Error('无法连接工作台服务'); return r.json(); }).then(data => {
      token = data.token; projects = data.projects; metadata = new Map(data.terminals.map(t => [t.stepId, t])); return data;
    }).finally(() => { bootstrapPromise = null; });
    return bootstrapPromise;
  }
  async function api(path, payload) {
    if (!token) await bootstrap();
    const response = await fetch(`/api/workbench/${path}`, { method: payload === undefined ? 'GET' : 'POST', headers: { 'X-Precision-Token': token, ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }), signal: AbortSignal.timeout(90000) });
    const result = await response.json();
    if (!response.ok) { if (response.status === 403) token = null; throw new Error(result.error || '请求失败'); }
    return result;
  }
  function setMode(next) { mode = next; saveLocal('precision-view', mode); mount(); }
  function markSelection() {
    for (const row of document.querySelectorAll('[data-step-id], [data-substep-id]')) row.classList.toggle('wb-current-direction', active && (row.dataset.substepId || row.dataset.stepId) === selected);
  }
  function openDirection(stepId) {
    if (isDemo() || !allDirections().some(d => d.step.id === stepId)) return;
    pinned.add(stepId); saveLocal('precision-pinned-directions', JSON.stringify([...pinned]));
    selected = stepId; saveLocal('precision-direction', stepId); setMode('cli');
    terminals.get(stepId)?.term.focus();
    if (matchMedia('(max-width: 1050px)').matches) root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function mount() {
    active = mode === 'cli' && !isDemo();
    document.documentElement.dataset.workbench = active ? 'cli' : 'progress';
    const columns = document.querySelector('.workspace-columns');
    if (!columns) return;
    if (!root.isConnected) document.querySelector('.task-workspace').after(root);
    mountPaneResizer(columns);
    if (!document.querySelector('.wb-manager-hint')) {
      const hint = document.createElement('p'); hint.className = 'wb-manager-hint';
      hint.textContent = '方向与子方向均可独立会话 · 点击卡片右下角打开，或拖动 ⠿';
      document.querySelector('.task-workspace .list-heading').after(hint);
    }
    syncTerminalTheme();
    let modes = document.querySelector('.wb-view-switch');
    if (!modes) {
      modes = document.createElement('div'); modes.className = 'wb-view-switch'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '切换工作视图');
      document.querySelector('.page-heading').after(modes);
      modes.innerHTML = '<button data-wb-mode="cli">⌘ &nbsp; Codex 协作</button><button data-wb-mode="progress">☷ &nbsp; 手动进度</button>';
      modes.onclick = e => { const button = e.target.closest('[data-wb-mode]'); if (button) setMode(button.dataset.wbMode); };
    }
    for (const b of modes.querySelectorAll('button')) { b.classList.toggle('selected', b.dataset.wbMode === (active ? 'cli' : 'progress')); b.setAttribute('aria-pressed', String(b.classList.contains('selected'))); }
    document.querySelector('.page-heading h1').textContent = active ? '研究工作台' : '每日工作台';
    if (active) document.querySelector('.page-heading p').textContent = '左侧梳理进度，右侧继续研究。方向与会话始终对应。';
    if (active) render();
    markSelection();
  }
  function render() {
    const directions = visibleDirections();
    const allCompleted = allDirections().length > 0 && allDirections().every(({ step }) => stepStatus(step) === 'done');
    if (directions.length && !directions.some(d => d.step.id === selected)) selected = (directions.find(d => stepStatus(d.step) === 'active') || directions[0]).step.id;
    const current = chosen(), info = current ? metadata.get(selected) : undefined;
    const nav = JSON.stringify([selected, [...pinned], allCompleted, directions.map(d => [d.task.id, directionPath(d), d.step.id, d.step.title, stepStatus(d.step), d.step.substeps?.filter(c => c.status === 'active').length, d.step.workspace?.cwd, d.step.workspace?.sessionId, metadata.get(d.step.id)?.status, metadata.get(d.step.id)?.activity?.state])]);
    if (nav !== navSignature) {
      navSignature = nav;
      function renderGroups(items) {
        const groups = new Map();
        for (const entry of items) {
          const { task } = entry;
          if (!groups.has(task.id)) groups.set(task.id, { task, steps: [] });
          groups.get(task.id).steps.push(entry);
        }
        return [...groups.values()].map(({ task, steps }) => `<div class="wb-project"><h3>任务 · ${esc(task.title)}</h3>${steps.map(({ step, parent }) => `<button class="wb-direction ${step.id === selected ? 'selected' : ''} ${activityClass(metadata.get(step.id))}" data-direction="${esc(step.id)}" title="${esc([task.title, parent?.title, step.title].filter(Boolean).join(' / '))}"><span class="wb-direction-path">${parent ? `子方向 · ${esc(parent.title)}` : '方向'}</span><span class="wb-direction-title">${esc(step.title)}</span><small><i></i>${stepStatus(step) !== 'active' ? `${statusLabels[stepStatus(step)]} · ` : ''}${['running', 'stopping'].includes(metadata.get(step.id)?.status) ? label(metadata.get(step.id)) : step.workspace?.sessionId ? '会话已绑定' : step.workspace?.cwd ? '目录已关联' : '等待关联'}</small></button>`).join('')}</div>`).join('');
      }
      const ongoing = directions.filter(({ step }) => stepStatus(step) === 'active');
      const manual = directions.filter(({ step }) => stepStatus(step) !== 'active' && pinned.has(step.id));
      const finishing = directions.filter(({ step }) => stepStatus(step) !== 'active' && !pinned.has(step.id));
      q('.wb-directions').innerHTML = `<div class="wb-nav-heading"><span>进行中的方向</span><span>${ongoing.length}</span></div><div class="wb-ongoing">${renderGroups(ongoing)}</div>${!ongoing.length ? '<p class="wb-nav-caption">暂无进行中的方向，也可以从左侧拖入。</p>' : ''}${manual.length ? `<div class="wb-manual"><div class="wb-nav-heading"><span>手动加入</span><span>${manual.length}</span></div>${renderGroups(manual)}</div>` : ''}${finishing.length ? `<div class="wb-finishing"><div class="wb-nav-heading"><span>其他运行中的终端</span><span>${finishing.length}</span></div>${renderGroups(finishing)}</div>` : ''}`;
    }
    const head = JSON.stringify([current && directionPath(current), current?.step.id, current?.step.title, current?.step.workspace, current?.step.substeps, pinned.has(selected), info]);
    if (head !== headerSignature) {
      headerSignature = head;
      q('.wb-console-header').innerHTML = current ? `<div class="wb-console-title"><div><span class="wb-eyebrow">${esc(current.task.title)}</span><h2>${esc(current.step.title)}</h2></div><span class="wb-status ${activityClass(info)}" title="显示绑定会话最近一轮回复的状态；绿色不代表研究任务已完成">${label(info)}</span></div><div class="wb-location" title="${esc(current.step.workspace?.cwd || '')}">⌁ &nbsp; ${esc(current.step.workspace?.cwd || '尚未关联工作目录')} ${current.step.workspace?.sessionId ? `<span>SESSION ${esc(current.step.workspace.sessionId.slice(0, 8))}</span>` : ''}</div><div class="wb-tools"><button data-wb="settings">关联设置</button><button data-wb="files" ${!current.step.workspace?.cwd ? 'disabled' : ''}>相关文件</button><button data-wb="progress">记录进度</button><span></span>${info?.status === 'running' ? '<button data-wb="reconnect">重新连接</button><button data-wb="stop" class="wb-stop">结束终端</button>' : `<button data-wb="new" ${!current.step.workspace?.cwd ? 'disabled' : ''}>新建会话</button><button class="wb-primary" data-wb="resume" ${!current.step.workspace?.sessionId ? 'disabled' : ''}>恢复会话 ↗</button>`}</div>` : '<div class="wb-console-title"><h2>准备开始你的下一项工作</h2></div>';
      if (current) {
        const children = (current.step.substeps || []).filter(c => c.status === 'active');
        if (children.length) q('.wb-console-title').insertAdjacentHTML('afterend', `<p class="wb-child-context">进行中的子方向：${children.map(c => esc(c.title)).join(' · ')}</p>`);
        q('.wb-console-title .wb-eyebrow').textContent = directionPath(current);
        if (current.parent) q('.wb-console-title').insertAdjacentHTML('afterend', '<p class="wb-child-context">子方向 · 独立会话</p>');
        q('.wb-tools').insertAdjacentHTML('beforeend', `<button data-wb="pin" title="固定只影响工作台入口，不改变进度">${pinned.has(selected) ? '取消固定' : '固定方向'}</button>`);
      }
    }
    for (const [id, t] of terminals) t.element.hidden = !current || id !== selected;
    let local = current ? terminals.get(selected) : undefined;
    if (local && info && local.id !== info.id) { local.socket?.close(); local.term.dispose(); local.observer.disconnect(); local.element.remove(); terminals.delete(selected); local = null; }
    if (info && !local && active) local = connect(info);
    const emptyKey = JSON.stringify([current?.step.id, Boolean(local), current?.step.workspace, allCompleted]);
    if (emptySignature !== emptyKey) {
      emptySignature = emptyKey; q('.wb-empty')?.remove();
      if (!local) {
        const empty = document.createElement('div'); empty.className = 'wb-empty';
        empty.innerHTML = `<div class="wb-terminal-mark">&gt;_</div><span class="wb-eyebrow">YOUR PERSISTENT WORKSPACE</span><h3>${current?.step.workspace?.cwd ? '从上次停下的地方继续' : '给这个方向一个工作现场'}</h3><p>${current?.step.workspace?.cwd ? '恢复已绑定的会话，或为新的研究阶段建立会话。<br>文件留在原来的目录，进度由你亲自整理。' : '关联研究目录和 Codex 会话。<br>下次回来，直接继续这个方向。'}</p>${current ? `<button class="wb-primary" data-wb="${current.step.workspace?.sessionId ? 'resume' : current.step.workspace?.cwd ? 'new' : 'settings'}">${current.step.workspace?.sessionId ? '恢复已绑定的会话 ↗' : current.step.workspace?.cwd ? '新建 Codex 会话 ↗' : '关联目录与会话 ↗'}</button>` : '<button class="wb-primary" data-wb="progress">开始记录任务</button>'}<div class="wb-empty-flow"><span><b>01</b> 关联目录</span><span><b>02</b> 继续会话</span><span><b>03</b> 手动整理</span></div>`;
        if (!current) empty.innerHTML = `<div class="wb-terminal-mark">&gt;_</div><h3>${allCompleted ? '当前方向均已完成' : '暂无进行中的方向'}</h3><p>有子进度进行中时，方向会自动出现在这里。<br>也可以从左侧拖入任意方向，继续对应的研究。</p><button class="wb-primary" data-wb="progress">查看手动进度</button>`;
        q('.wb-surface').append(empty);
      }
    }
    if (local) { local.element.hidden = false; requestAnimationFrame(() => fit(local)); }
    q('[data-wb="bottom"]').disabled = !local;
    markSelection();
  }
  function fit(t) { if (!active || t.element.hidden || !t.element.isConnected) return; try { t.fit.fit(); } catch {} }
  function connect(info) {
    const element = document.createElement('div'); element.className = 'wb-terminal'; element.dataset.step = info.stepId; q('.wb-surface').append(element);
    const term = new window.Terminal({ cursorBlink: true, fontSize: 14, fontFamily: '"Cascadia Code", Consolas, "Microsoft YaHei", monospace', lineHeight: 1.25, scrollback: 3000, theme: terminalTheme() });
    const fitAddon = new window.FitAddon.FitAddon(); term.loadAddon(fitAddon); term.open(element);
    const t = { id: info.id, stepId: info.stepId, element, term, fit: fitAddon, socket: null, ready: false, readonly: false, retry: null };
    t.observer = new ResizeObserver(() => fit(t)); t.observer.observe(element);
    terminals.set(info.stepId, t);
    const transmit = value => { if (t.ready && !t.readonly && t.socket?.readyState === WebSocket.OPEN) t.socket.send(JSON.stringify(value)); };
    element.addEventListener('paste', event => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return;
      event.preventDefault(); event.stopImmediatePropagation();
      // ConPTY does not preserve bracketed paste for this CLI. Encode each
      // pasted line break as the same non-submitting key used below.
      transmit({ type: 'input', data: text.replace(/\r\n?|\n/g, '\x1b\r') });
      term.scrollToBottom();
    }, true);
    term.onData(data => transmit({ type: 'input', data }));
    term.onResize(({ cols, rows }) => transmit({ type: 'resize', cols, rows }));
    term.attachCustomKeyEventHandler(event => {
      // xterm's legacy mapping sends CR for both Enter and Shift+Enter.
      // Use the Alt+Enter encoding for Codex's newline action through ConPTY.
      if (event.key === 'Enter' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        if (event.isComposing || event.keyCode === 229) return true;
        event.preventDefault(); event.stopPropagation();
        if (event.type === 'keydown') { transmit({ type: 'input', data: '\x1b\r' }); term.scrollToBottom(); }
        return false;
      }
      // Let the browser emit a paste event; sending Ctrl+V itself invokes
      // Codex's native image-paste action instead of pasting the selected text.
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyV') {
        return false;
      }
      if (event.shiftKey && !event.ctrlKey && !event.altKey && event.key === 'Insert') {
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.code === 'KeyC') {
        const selection = term.getSelection();
        // A selected Ctrl+C is always a copy, even if clipboard access fails.
        // Only plain Ctrl+C with no selection may reach the CLI as an interrupt.
        if (selection || event.shiftKey || event.metaKey) {
          event.preventDefault(); event.stopPropagation();
          if (event.type === 'keydown' && selection) {
            Promise.resolve().then(() => navigator.clipboard.writeText(selection)).catch(() => {
              handleError(new Error('复制失败，请允许浏览器访问剪贴板后重试；未向终端发送中断信号。'));
            });
          }
          return false;
        }
      }
      return true;
    });
    openSocket(t); return t;
  }
  async function openSocket(t) {
    clearTimeout(t.retry);
    if (!token) await bootstrap();
    t.ready = false; t.readonly = false;
    if (t.socket) { t.socket.onclose = null; t.socket.close(); }
    const ws = new WebSocket(`ws://${location.host}/api/workbench/attach?stepId=${encodeURIComponent(t.stepId)}&id=${encodeURIComponent(t.id)}&token=${encodeURIComponent(token)}`); t.socket = ws;
    ws.onmessage = event => {
      const m = JSON.parse(event.data);
      if (m.type === 'snapshot') { termReset(t, m.data); metadata.set(t.stepId, m.terminal); t.ready = true; fit(t); ws.send(JSON.stringify({ type: 'resize', cols: t.term.cols, rows: t.term.rows })); if (selected === t.stepId && active) t.term.focus(); }
      else if (m.type === 'output') t.term.write(m.data);
      else if (m.type === 'status') { metadata.set(t.stepId, m.terminal); render(); }
      else if (m.type === 'readonly') { t.readonly = true; t.term.write('\r\n\x1b[33m此会话已在另一个网页中接管；此处仅查看。\x1b[0m\r\n'); }
    };
    ws.onclose = () => {
      t.ready = false;
      if (t.readonly || metadata.get(t.stepId)?.status !== 'running') return;
      t.retry = setTimeout(async () => { try { await bootstrap(); const current = metadata.get(t.stepId); if (current?.id === t.id && current.status === 'running') await openSocket(t); else { t.term.write('\r\n终端服务已重启，请恢复会话。\r\n'); render(); } } catch { t.retry = setTimeout(() => openSocket(t).catch(handleError), 5000); } }, 2000);
    };
  }
  function termReset(t, data) { t.term.reset(); t.term.write(data); }
  async function start(mode) {
    const current = chosen(); if (!current) return;
    if (mode === 'new' && current.step.workspace?.sessionId && !confirm('为这个方向新建会话？原会话会保留在历史会话中。')) return;
    for (const button of root.querySelectorAll('[data-wb="new"], [data-wb="resume"]')) button.disabled = true;
    q('.wb-status').textContent = '正在启动 Codex…';
    try {
      const result = await api('start', { stepId: current.step.id, mode });
      metadata.set(current.step.id, result.terminal); await refresh();
    } finally { headerSignature = ''; render(); }
  }
  async function openSettings() {
    const current = chosen(); if (!current) return;
    const stepId = current.step.id, taskId = current.task.id, workspace = current.step.workspace || {};
    if (!token) await bootstrap();
    let draft; try { draft = JSON.parse(readLocal(`precision-binding-${stepId}`)); } catch {}
    const inherited = !workspace.cwd && current.parent?.workspace;
    const source = draft || (inherited ? { cwd: inherited.cwd, files: [...(inherited.files || [])], sessionId: '' } : workspace);
    settings.innerHTML = `<form id="workspace-binding-form"><div class="wb-dialog-top"><span class="wb-eyebrow">WORKSPACE CONNECTION</span><button type="button" class="wb-close" aria-label="关闭关联设置">×</button></div><h2>关联目录与会话</h2><p class="wb-dialog-intro">${esc(current.step.title)}</p><label for="wb-cwd">工作目录</label><input id="wb-cwd" name="cwd" required placeholder="例如 D:\\workflow\\research\\strategies\\…" list="wb-project-paths" value="${esc(source.cwd || '')}"><datalist id="wb-project-paths">${projects.map(p => `<option value="${esc(p.path)}">${esc(p.name)}</option>`).join('')}</datalist><p class="wb-field-hint">使用项目已有目录；终端会在这个目录中继续工作。</p><label for="wb-session">Codex 会话 ID <small>选填</small></label><div class="wb-input-row"><input id="wb-session" name="sessionId" placeholder="选择已有会话，或暂时留空" value="${esc(source.sessionId || '')}"><button type="button" id="wb-load-sessions">浏览会话</button></div><div id="wb-session-picker" hidden><input type="search" id="wb-session-search" aria-label="搜索会话" placeholder="按标题、目录或 ID 筛选"><div id="wb-session-list"></div><button type="button" id="wb-more-sessions" hidden>加载更多</button></div>${workspace.history?.length ? `<details class="wb-history"><summary>历史会话 · ${workspace.history.length}</summary>${workspace.history.map(h => `<button type="button" data-session-history="${esc(h.sessionId)}" data-cwd="${esc(h.cwd)}">${esc(h.sessionId)}<small>${esc(h.cwd)}</small></button>`).join('')}</details>` : ''}<label for="wb-pins">关键文件 <small>每行一个相对路径，选填</small></label><textarea id="wb-pins" name="files" rows="3" placeholder="README.md&#10;docs/STATUS.md">${esc(Array.isArray(source.files) ? source.files.join('\n') : source.files || '')}</textarea><p class="wb-field-hint">集中查看研究入口、状态和报告；不会自动发送给 AI。</p><div class="wb-dialog-error" role="alert"></div><div class="wb-dialog-actions"><button type="button" class="wb-cancel">取消</button><button type="submit" class="wb-primary">保存关联</button></div></form>`;
    const form = settings.querySelector('form');
    if (current.parent) {
      settings.querySelector('.wb-dialog-intro').textContent = `${directionPath(current)} / ${current.step.title}`;
      settings.querySelector('.wb-field-hint').textContent = inherited ? '已预填父方向目录和关键文件，可改为自己的子目录。此方向单独绑定会话，留空会话 ID 后可新建。' : '这个子方向拥有独立会话，可以与父方向共用目录，也可以使用自己的子目录。';
    }
    const values = () => ({ cwd: form.elements.cwd.value.trim(), sessionId: form.elements.sessionId.value.trim(), files: form.elements.files.value.split('\n').map(v => v.trim()).filter(Boolean) });
    form.oninput = () => saveLocal(`precision-binding-${stepId}`, JSON.stringify(values()));
    settings.querySelector('.wb-close').onclick = settings.querySelector('.wb-cancel').onclick = () => settings.close();
    form.onsubmit = async event => {
      event.preventDefault(); const button = form.querySelector('[type=submit]'); button.disabled = true;
      try { if (await mutate({ type: 'bind-workspace', taskId, stepId, ...values() }, '工作目录与会话已关联')) { saveLocal(`precision-binding-${stepId}`, null); settings.close(); render(); } else settings.querySelector('.wb-dialog-error').textContent = document.querySelector('#toast')?.textContent || '关联未保存，请检查路径后重试。'; } finally { button.disabled = false; }
    };
    for (const button of settings.querySelectorAll('[data-session-history]')) button.onclick = () => { form.elements.sessionId.value = button.dataset.sessionHistory; form.elements.cwd.value = button.dataset.cwd; form.oninput(); };
    let rows = [], nextCursor;
    const renderSessions = () => {
      const query = settings.querySelector('#wb-session-search').value.toLowerCase();
      const cwd = form.elements.cwd.value.toLowerCase().replaceAll('/', '\\').replace(/\\$/, '');
      const sorted = [...rows].sort((a,b) => Number(b.cwd?.toLowerCase().replaceAll('/', '\\') === cwd) - Number(a.cwd?.toLowerCase().replaceAll('/', '\\') === cwd));
      settings.querySelector('#wb-session-list').innerHTML = sorted.filter(s => `${s.title} ${s.cwd} ${s.id}`.toLowerCase().includes(query)).map(s => `<button type="button" class="wb-session-option" data-session="${esc(s.id)}"><strong>${esc(s.title.slice(0, 160))}</strong><small>${esc(s.cwd)} · ${esc(s.id.slice(0, 8))}</small></button>`).join('') || '<p class="wb-field-hint">没有匹配会话，可加载更多或粘贴完整 ID。</p>';
      for (const button of settings.querySelectorAll('[data-session]')) button.onclick = () => { const session = rows.find(s => s.id === button.dataset.session); form.elements.sessionId.value = session.id; if (!form.elements.cwd.value) form.elements.cwd.value = session.cwd; form.oninput(); settings.querySelector('#wb-session-picker').hidden = true; };
    };
    async function loadSessions(more = false) {
      const button = settings.querySelector('#wb-load-sessions'); button.disabled = true; button.textContent = '读取中…';
      try {
        const result = await api(`sessions${more && nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : ''}`);
        rows = more ? [...rows, ...result.sessions] : result.sessions; nextCursor = result.nextCursor;
        settings.querySelector('#wb-session-picker').hidden = false; settings.querySelector('#wb-more-sessions').hidden = !nextCursor; renderSessions();
      } catch (error) { settings.querySelector('.wb-dialog-error').textContent = error.message; }
      finally { button.disabled = false; button.textContent = '浏览会话'; }
    }
    settings.querySelector('#wb-load-sessions').onclick = () => loadSessions();
    settings.querySelector('#wb-more-sessions').onclick = () => loadSessions(true);
    settings.querySelector('#wb-session-search').oninput = renderSessions;
    settings.showModal();
  }
  async function openFiles() {
    const current = chosen(); if (!current?.step.workspace?.cwd) return;
    const stepId = current.step.id, taskId = current.task.id;
    filesDialog.innerHTML = `<div class="wb-dialog-top"><span class="wb-eyebrow">PROJECT FILES</span><button class="wb-close" aria-label="关闭文件预览">×</button></div><h2>相关文件</h2><p class="wb-dialog-intro">${esc(current.step.workspace.cwd)}</p><div class="wb-file-pins">${(current.step.workspace.files || []).map(p => `<button data-file="${esc(p)}">◇ ${esc(p)}</button>`).join('')}</div><div class="wb-file-toolbar"><button id="wb-file-up">↑ 上一级</button><code id="wb-file-path">/</code><button id="wb-pin-file" hidden>固定此文件</button><button id="wb-copy-file" hidden>复制路径</button></div><div class="wb-file-content"></div>`;
    filesDialog.querySelector('.wb-close').onclick = () => filesDialog.close();
    let path = '', requestId = 0;
    async function browse(next) {
      const generation = ++requestId; path = next;
      filesDialog.querySelector('#wb-file-path').textContent = path || '/';
      filesDialog.querySelector('#wb-file-up').disabled = !path;
      const content = filesDialog.querySelector('.wb-file-content'); content.textContent = '正在读取…';
      try {
        const result = await api(`files?stepId=${encodeURIComponent(stepId)}&path=${encodeURIComponent(path)}`);
        if (generation !== requestId) return;
        filesDialog.querySelector('#wb-pin-file').hidden = filesDialog.querySelector('#wb-copy-file').hidden = result.kind === 'directory';
        if (result.kind === 'directory') {
          content.innerHTML = `<div class="wb-file-list">${result.entries.map(e => `<button data-entry="${esc(e.name)}"><span>${e.directory ? '▸' : '·'}</span>${esc(e.name)}<small>${e.link ? '链接' : e.directory ? '文件夹' : '文件'}</small></button>`).join('') || '<p class="wb-field-hint">空文件夹</p>'}</div>${result.truncated ? '<p>仅显示前 400 项</p>' : ''}`;
          for (const b of content.querySelectorAll('[data-entry]')) b.onclick = () => browse(path ? `${path}/${b.dataset.entry}` : b.dataset.entry);
        } else if (result.kind === 'image') { content.innerHTML = `<img class="wb-preview-image" alt="${esc(path)}" src="data:${result.mime};base64,${result.data}">`; }
        else { content.innerHTML = '<pre class="wb-preview-text"></pre>'; content.querySelector('pre').textContent = result.text; }
      } catch (error) { if (generation === requestId) content.textContent = error.message; }
    }
    filesDialog.querySelector('#wb-file-up').onclick = () => browse(path.split(/[\\/]/).slice(0,-1).join('/'));
    filesDialog.querySelector('#wb-copy-file').onclick = safe(() => navigator.clipboard.writeText(`${current.step.workspace.cwd}\\${path.replaceAll('/', '\\')}`));
    filesDialog.querySelector('#wb-pin-file').onclick = safe(async () => {
      const latest = allDirections().find(d => d.step.id === stepId)?.step.workspace;
      if (!latest) throw new Error('方向已不存在');
      if (await mutate({ type: 'bind-workspace', taskId, stepId, ...latest, files: [...new Set([...(latest.files || []), path])] }, '关键文件已固定')) filesDialog.close();
    });
    for (const b of filesDialog.querySelectorAll('[data-file]')) b.onclick = () => browse(b.dataset.file);
    filesDialog.showModal(); await browse('');
  }
  root.addEventListener('click', safe(async event => {
    const direction = event.target.closest('[data-direction]');
    if (direction) { selected = direction.dataset.direction; saveLocal('precision-direction', selected); render(); terminals.get(selected)?.term.focus(); return; }
    const action = event.target.closest('[data-wb]')?.dataset.wb;
    if (action === 'bottom') { const terminal = terminals.get(selected)?.term; terminal?.scrollToBottom(); terminal?.focus(); }
    if (action === 'settings') await openSettings();
    if (action === 'files') await openFiles();
    if (action === 'progress') { if (chosen()) focusDirection(selected); else setMode('progress'); }
    if (action === 'pin' && chosen()) {
      pinned.has(selected) ? pinned.delete(selected) : pinned.add(selected);
      saveLocal('precision-pinned-directions', JSON.stringify([...pinned])); render();
    }
    if (action === 'resume' || action === 'new') await start(action);
    if (action === 'reconnect') { const t = terminals.get(selected); if (t) await openSocket(t); }
    if (action === 'stop') {
      const info = metadata.get(selected);
      if (info && confirm('结束这个终端？正在执行的工作会中断，已保存的会话可以之后恢复。')) { const r = await api('stop', { stepId: selected, id: info.id }); metadata.set(selected, r.terminal); render(); }
    }
  }));
  const clearDrag = () => { draggedDirection = undefined; root.classList.remove('wb-drag-over'); document.documentElement.classList.remove('wb-dragging'); };
  document.addEventListener('dragstart', event => {
    const handle = event.target.closest('[data-workbench-drag]');
    if (!handle) return;
    if (isDemo() || handle.disabled || document.querySelector('#app[aria-busy=true]')) { event.preventDefault(); return; }
    draggedDirection = handle.dataset.workbenchDrag;
    event.dataTransfer.setData(dragType, draggedDirection);
    event.dataTransfer.effectAllowed = 'copy';
    document.documentElement.classList.add('wb-dragging');
  });
  document.addEventListener('dragenter', event => {
    if (draggedDirection && event.target.closest('[data-wb-mode="cli"]') && !active) setMode('cli');
  });
  root.addEventListener('dragover', event => {
    if (!draggedDirection || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; root.classList.add('wb-drag-over');
  }, true);
  root.addEventListener('dragleave', event => { if (!root.contains(event.relatedTarget)) root.classList.remove('wb-drag-over'); });
  root.addEventListener('drop', event => {
    if (!draggedDirection || !event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const stepId = event.dataTransfer.getData(dragType);
    if (stepId === draggedDirection) openDirection(stepId);
    clearDrag();
  }, true);
  document.addEventListener('dragend', clearDrag);
  document.addEventListener('drop', clearDrag);
  let polling = false;
  setInterval(async () => {
    if (document.hidden || isDemo() || !token || polling) return;
    polling = true;
    try {
      const r = await api('status'); metadata = new Map(r.terminals.map(t => [t.stepId, t]));
    } catch {
      // Do not leave a stale completion indication after a failed status read.
      metadata = new Map([...metadata].map(([id, t]) => [id, t.status === 'running' ? { ...t, activity: { state: 'unknown' } } : t]));
    } finally { polling = false; if (active) render(); }
  }, 5000);
  bootstrap().then(() => { if (active) render(); }).catch(() => {});
  return { mount, markSelection, open: openDirection, progress() { setMode('progress'); } };
}

// Keep the divider and width preference across the app's full-page renders.
function createPaneResizer({ readLocal, saveLocal }) {
  const storageKey = 'precision-workbench-left-width';
  const saved = Number(readLocal(storageKey));
  let preferredWidth = Number.isFinite(saved) && saved > 0 ? saved : null;
  const html = document.documentElement, desktop = matchMedia('(min-width: 1051px)');
  const handle = document.createElement('div'); handle.id = 'wb-pane-resizer'; handle.tabIndex = 0;
  handle.setAttribute('role', 'separator'); handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', '调整进度区与 Codex 工作区宽度');
  handle.setAttribute('aria-controls', 'workbench-root');
  handle.title = '左右拖动调整宽度；双击恢复默认；左右方向键微调';
  let columns, pane, drag, frame;
  const enabled = () => columns?.isConnected && desktop.matches && html.dataset.workbench === 'cli';
  const widthNow = () => pane.getBoundingClientRect().width;
  function limits() {
    const width = columns.clientWidth, gap = parseFloat(getComputedStyle(columns).columnGap) || 0;
    const reserved = 380 + gap + (html.dataset.insights === 'collapsed' ? 38 + gap : 0);
    const min = Math.min(300, width * .4);
    return { min, max: Math.max(min, width - reserved) };
  }
  function describe() {
    if (!enabled()) return;
    const { min, max } = limits(), width = Math.round(widthNow());
    handle.setAttribute('aria-valuemin', String(Math.round(min)));
    handle.setAttribute('aria-valuemax', String(Math.round(max)));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `进度区 ${width} 像素`);
  }
  function apply(width) {
    preferredWidth = width;
    if (width === null) columns.style.removeProperty('--wb-left-width');
    else columns.style.setProperty('--wb-left-width', `${width}px`);
    describe();
  }
  function clamp(width) { const { min, max } = limits(); return Math.max(min, Math.min(max, width)); }
  function update() { frame = null; if (drag) apply(clamp(drag.width)); }
  function finish(cancel) {
    if (!drag) return;
    cancelAnimationFrame(frame); frame = null;
    const previous = drag; drag = null;
    if (cancel || !previous.moved) apply(previous.preference);
    else { apply(clamp(previous.width)); saveLocal(storageKey, String(preferredWidth)); }
    if (html.dataset.resizing === 'workbench') delete html.dataset.resizing;
    if (handle.hasPointerCapture(previous.pointerId)) handle.releasePointerCapture(previous.pointerId);
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !enabled() || html.dataset.resizing) return;
    event.preventDefault();
    drag = { pointerId: event.pointerId, x: event.clientX, start: widthNow(), width: widthNow(), preference: preferredWidth, moved: false };
    html.dataset.resizing = 'workbench';
    handle.setPointerCapture(event.pointerId); handle.focus({ preventScroll: true });
  });
  function move(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.width = drag.start + event.clientX - drag.x;
    drag.moved ||= Math.abs(event.clientX - drag.x) > 1;
  }
  handle.addEventListener('pointermove', event => { move(event); if (drag && !frame) frame = requestAnimationFrame(update); });
  handle.addEventListener('pointerup', event => { if (drag?.pointerId === event.pointerId) { move(event); finish(false); } });
  handle.addEventListener('pointercancel', () => finish(true));
  handle.addEventListener('lostpointercapture', () => finish(true));
  window.addEventListener('blur', () => finish(true));
  handle.addEventListener('dblclick', () => { if (enabled()) { finish(true); apply(null); saveLocal(storageKey, null); } });
  handle.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); event.stopPropagation(); finish(true); return; }
    if (!enabled() || drag || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const { min, max } = limits();
    apply(clamp(event.key === 'Home' ? min : event.key === 'End' ? max : widthNow() + (event.key === 'ArrowLeft' ? -16 : 16)));
    saveLocal(storageKey, String(preferredWidth));
  });
  // CSS clamps the displayed width as the viewport/sidebar changes, without
  // overwriting the user's preference. xterm's existing observer refits it.
  const observer = new ResizeObserver(describe);
  desktop.addEventListener('change', () => { finish(true); describe(); });
  return nextColumns => {
    if (columns !== nextColumns) {
      finish(true); observer.disconnect(); columns = nextColumns;
      pane = columns.querySelector('.task-workspace'); columns.append(handle);
      observer.observe(columns); observer.observe(pane);
    } else if (!enabled()) finish(true);
    apply(preferredWidth);
  };
}
