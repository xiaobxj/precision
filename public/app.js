import { localDay, tasksOnDay, taskStatus, stepStatus, progressItems, statusLabels, applyCommand, emptyState, findResult } from '/domain.mjs';
import { createNotesUI } from '/notes.js';
import { createImageUI } from '/images.js';
import { renderBold, mountBoldEditors, boldValues, validateBoldEditors } from '/bold.js';
import { createStatusUI } from '/status.js';
import { createWorkbenchUI } from '/workbench.js';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const paths = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
  left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', up: '<path d="m6 15 6-6 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L20 8a3 3 0 0 0-4-4L5 15l-1 5Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  moon: '<path d="M20.5 13A8.5 8.5 0 0 1 11 3a9 9 0 1 0 9.5 10Z"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  flag: '<path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0"/>',
  book: '<path d="M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4V4ZM12 6v15"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  record: '<path d="M14 3H5v18h14V8l-5-5ZM14 3v5h5M8 12h8M8 16h5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const iconButton = (action, label, name, attributes = '') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${escape(label)}" title="${escape(label)}" ${attributes}>${icon(name)}</button>`;
const pad = n => String(n).padStart(2, '0');
const shiftDay = (day, n) => { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); };
const shortDay = day => `${Number(day.slice(5, 7))} 月 ${Number(day.slice(8))} 日`;
const time = value => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
const dateTime = value => `${shortDay(localDay(new Date(value)))} ${time(value)}`;
const readLocal = key => { try { return localStorage.getItem(key); } catch { return null; } };
const saveLocal = (key, value) => { try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* The server remains the source of saved data. */ } };
document.documentElement.dataset.theme = readLocal('procision-theme') || 'dark';
document.documentElement.dataset.sidebar = readLocal('procision-sidebar') === 'collapsed' ? 'collapsed' : 'expanded';
document.documentElement.dataset.insights = readLocal('procision-insights') === 'expanded' ? 'expanded' : 'collapsed';
const storedSidebarWidth = Number(readLocal('procision-sidebar-width'));
if (storedSidebarWidth >= 200 && storedSidebarWidth <= 360) document.documentElement.style.setProperty('--sidebar-expanded-width', `${storedSidebarWidth}px`);

let state = emptyState();
let selectedDay = localDay();
let calendarMonth = selectedDay.slice(0, 7);
let view = 'day';
let filter = 'all';
let query = '';
let collapsed = new Set();
const collapsedDirections = new Set();
const collapsedResults = new Set();
const foldedSteps = new Set();
try {
  const saved = JSON.parse(readLocal('procision-folded-directions'));
  if (Array.isArray(saved)) saved.filter(key => typeof key === 'string').forEach(key => foldedSteps.add(key));
} catch { /* Ignore invalid local view preferences. */ }
const foldKey = stepId => `${demo ? 'demo' : 'real'}:${stepId}`;
function setStepFolded(stepId, folded) {
  folded ? foldedSteps.add(foldKey(stepId)) : foldedSteps.delete(foldKey(stepId));
  saveLocal('procision-folded-directions', JSON.stringify([...foldedSteps]));
}
let busy = false;
let demo = new URLSearchParams(location.search).has('demo');
let connected = false;
let loaded = false;
let toastTimer;
let formContext;
const editorPanel = $('#editor');
let inlineFocus;
let insightsToggleVersion = 0;
const columnScrollPositions = new Map();
const separateColumns = matchMedia('(min-width: 1051px)');

function rememberColumnScroll() {
  if (!separateColumns.matches) return;
  for (const column of document.querySelectorAll('[data-scroll-key]')) {
    if (column.classList.contains('insights') && document.documentElement.dataset.insights === 'collapsed') continue;
    columnScrollPositions.set(column.dataset.scrollKey, column.scrollTop);
  }
}

function mountColumnScroll() {
  const mode = demo ? 'demo' : 'real';
  const columns = [
    { element: $('.task-workspace'), key: `${mode}:tasks:${view}:${view === 'day' ? selectedDay : 'all'}`, label: '任务列表' },
    { element: $('.insights'), key: `${mode}:insights`, label: '思考与进度参考' },
  ];
  for (const { element, key, label } of columns) {
    element.dataset.scrollKey = key;
    element.setAttribute('aria-label', label);
    element.tabIndex = separateColumns.matches ? 0 : -1;
    if (separateColumns.matches) element.scrollTop = columnScrollPositions.get(key) || 0;
    element.addEventListener('scroll', () => {
      if (element.classList.contains('insights') && document.documentElement.dataset.insights === 'collapsed') return;
      if (separateColumns.matches) columnScrollPositions.set(key, element.scrollTop);
    }, { passive: true });
  }
}

separateColumns.addEventListener('change', () => {
  for (const column of document.querySelectorAll('[data-scroll-key]')) {
    column.tabIndex = separateColumns.matches ? 0 : -1;
    column.scrollTop = separateColumns.matches ? (columnScrollPositions.get(column.dataset.scrollKey) || 0) : 0;
  }
  if (separateColumns.matches) window.scrollTo(0, 0);
});

const imagesUI = createImageUI({ escape, icon, isDemo: () => demo, showError });
const statusUI = createStatusUI({ escape, icon, showError });
const notesUI = createNotesUI({ getState: () => state, isDemo: () => demo, isBusy: () => busy, mutate, escape, icon, readLocal, saveLocal, dateTime, imagesUI, showError, focusResult });
const workbenchUI = createWorkbenchUI({ getState: () => state, isDemo: () => demo, mutate, refresh: () => load(), focusDirection, escape, readLocal, saveLocal, showError });

function focusDirection(stepId) {
  const task = state.tasks.find(task => task.steps.some(step => step.id === stepId || step.substeps?.some(child => child.id === stepId)));
  if (!task) return;
  const parent = task.steps.find(step => step.id === stepId || step.substeps?.some(child => child.id === stepId));
  view = 'all'; filter = 'all'; query = ''; collapsed.delete(task.id); setStepFolded(parent.id, false); collapsedDirections.delete(parent.id);
  render();
  requestAnimationFrame(() => {
    const target = $(`[data-step-id="${stepId}"], [data-substep-id="${stepId}"]`), panel = $('.task-workspace');
    if (!target || !panel) return;
    if (separateColumns.matches || document.documentElement.dataset.workbench === 'cli') {
      panel.scrollTo({ top: panel.scrollTop + target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 12, behavior: 'smooth' });
      if (!separateColumns.matches) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

function focusResult(resultId) {
  const found = findResult(state, resultId);
  if (!found) return showError('来源结果已不存在');
  closeEditor();
  view = 'all'; filter = 'all'; query = '';
  collapsed.delete(found.task.id);
  setStepFolded(found.step.id, false);
  collapsedResults.delete(found.step.id);
  render();
  const target = [...document.querySelectorAll('[data-result-id]')].find(element => element.dataset.resultId === resultId);
  target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
  target.classList.add('source-highlight');
  setTimeout(() => target.classList.remove('source-highlight'), 2400);
}

function makeDemo() {
  let sample = emptyState();
  const run = (command, hour = 10) => { sample = applyCommand(sample, command, `${localDay()}T${pad(hour)}:20:00+08:00`); };
  run({ type: 'create-task', title: '搭建我的 AI 协作工作台', description: '让分散在不同对话里的需求，回到一个清晰的工作流。', date: localDay() }, 9);
  const first = sample.tasks[0].id;
  run({ type: 'create-step', taskId: first, title: '梳理需求与参考样式', content: '已确认核心流程：创建任务 → 记录每一步 → 跟踪完成情况。\n视觉参考 Archify，采用深色画布和清晰的状态色。', status: 'done' }, 9);
  run({ type: 'create-step', taskId: first, title: '完成每日工作台的界面设计', content: '任务列表、日期导航和进度概览已就绪。正在检查交互细节与窄屏适配。', status: 'active' }, 10);
  run({ type: 'create-step', taskId: first, title: '验证保存与跨天延续', content: '检查刷新后数据是否保留，以及昨天未完成的任务能否延续到今天。', status: 'todo' }, 10);
  run({ type: 'create-task', title: '整理本周的研究资料', description: '收集 AI 给出的结论，并逐项核对证据。', date: shiftDay(localDay(), -1) }, 9);
  const second = sample.tasks[1].id;
  run({ type: 'create-step', taskId: second, title: '汇总资料与初步结论', content: '已将三份资料整理为统一的对照表。', status: 'done' }, 9);
  run({ type: 'create-step', taskId: second, title: '核对引用来源', content: '有两处引用需要补充原始链接，等待进一步确认。', status: 'waiting' }, 11);
  run({ type: 'create-task', title: '优化日常文件整理流程', description: '把重复的手动操作交给脚本。', date: localDay() }, 8);
  const third = sample.tasks[2].id;
  run({ type: 'create-step', taskId: third, title: '完成脚本并验证输出', content: '已完成测试，输出目录与命名均符合预期。', status: 'done' }, 9);
  return sample;
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = `visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 6500 : 3000);
}

function showError(message) {
  if (!$('#editor').open) return toast(message, true);
  let error = $('#form-error');
  if (!error) {
    error = document.createElement('p');
    error.id = 'form-error';
    error.className = 'form-error';
    error.setAttribute('role', 'alert');
    $('#editor .dialog-footer').before(error);
  }
  error.textContent = message;
}

async function request(path, options = {}) {
  const response = await fetch(path, { ...options, signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 409 && result.state) { state = result.state; render(); }
    throw new Error(result.error || '暂时无法完成操作');
  }
  return result;
}

async function load({ quiet = false } = {}) {
  if (busy) return;
  if (demo) { state = makeDemo(); loaded = true; render(); return; }
  try {
    const next = await request('/api/state');
    const changed = next.revision !== state.revision || !connected || !loaded;
    state = next; connected = true; loaded = true;
    if (changed || !quiet) render();
  } catch {
    connected = false;
    render();
    if (!quiet) toast('无法连接本地服务。请运行“启动工作台.cmd”后点击重新连接。', true);
  }
}

async function mutate(command, success) {
  if (busy) return false;
  busy = true;
  $('#app').setAttribute('aria-busy', 'true');
  try {
    if (demo) state = applyCommand(state, command);
    else state = await request('/api/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, command }) });
    connected = true;
    render();
    if (success) toast(demo ? `${success}（仅在示例中）` : success);
    return true;
  } catch (error) {
    showError(error.name === 'TypeError' || error.name === 'TimeoutError' ? '暂时无法保存。请检查本地服务后重试，输入内容已保留。' : error.message);
    return false;
  } finally {
    busy = false;
    $('#app').removeAttribute('aria-busy');
  }
}

function scopedTasks() { return view === 'all' ? [...state.tasks] : tasksOnDay(state.tasks, selectedDay); }
function filteredTasks() {
  return scopedTasks().filter(task => {
    const status = taskStatus(task);
    const matches = filter === 'all' || (filter === 'open' ? status !== 'done' : status === filter);
    return matches && [task.title, task.description, ...task.steps.flatMap(step => [step.title, step.content, ...(step.substeps || []).flatMap(child => [child.title, child.content]), ...(step.results || []).flatMap(result => [result.title, result.content])])].join(' ').toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => Number(taskStatus(a) === 'done') - Number(taskStatus(b) === 'done') || b.date.localeCompare(a.date) || a.createdAt.localeCompare(b.createdAt));
}

function calendar() {
  const [year, month] = calendarMonth.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const offset = (start.getUTCDay() + 6) % 7;
  const total = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const today = localDay();
  let days = '<span></span>'.repeat(offset);
  for (let day = 1; day <= total; day++) {
    const key = `${calendarMonth}-${pad(day)}`;
    const hasTask = state.tasks.some(task => task.date === key || (task.completedAt && localDay(new Date(task.completedAt)) === key));
    days += `<button class="calendar-day ${key === selectedDay && view === 'day' ? 'selected' : ''} ${key === today ? 'today' : ''} ${hasTask ? 'has-task' : ''}" data-action="date" data-date="${key}" aria-label="${key}" ${key === selectedDay && view === 'day' ? 'aria-current="date"' : ''}>${day}</button>`;
  }
  return `<div class="calendar-title"><span>${year} 年 ${pad(month)} 月</span><div>${iconButton('prev-month', '上个月', 'left')}${iconButton('next-month', '下个月', 'right')}</div></div><div class="calendar-grid weekdays">${'一二三四五六日'.split('').map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-grid">${days}</div>`;
}

function sidebar() {
  const pending = tasksOnDay(state.tasks, localDay()).filter(task => taskStatus(task) !== 'done').length;
  return `<aside class="sidebar"><a href="/" class="brand" aria-label="Procision 首页"><img src="/favicon.svg" alt=""/><span>procision<span class="brand-dot">.</span></span></a><div class="workspace-name"><span class="workspace-avatar">P</span><div>我的工作空间<small>PERSONAL WORKSPACE</small></div><span class="local-tag">本地</span></div><div class="section-label">工作台 <span>WORKSPACE</span></div><nav aria-label="工作台导航"><button class="nav-item ${view === 'day' ? 'active' : ''}" data-action="today">${icon('grid')}<span>每日任务</span><b>${pending}</b></button><button class="nav-item ${view === 'all' ? 'active' : ''}" data-action="all">${icon('layers')}<span>全部任务</span><b>${state.tasks.length}</b></button></nav><div class="sidebar-divider"></div><div class="section-label calendar-label">日期导航 ${icon('calendar')}</div><div id="calendar">${calendar()}</div><button class="back-today" data-action="today">回到今天 ${icon('arrow')}</button><div class="sidebar-note">${icon('spark')}<p>每一小步，都有迹可循。<br><span>专注协作，进度留在这里。</span></p></div><div class="sidebar-bottom"><span class="connection"><i class="${connected || demo ? '' : 'offline'}"></i>${demo ? '示例体验中' : connected ? '已保存到本机' : '服务未连接'}</span>${iconButton('theme', '切换明暗主题', document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}</div><div class="sidebar-version">PROCISION <span>v1.1 / 为专注而造</span></div></aside>`;
}

function renderSidebarToggle() {
  const collapsed = document.documentElement.dataset.sidebar === 'collapsed';
  const label = collapsed ? '展开日历栏' : '收起日历栏';
  $('.sidebar').id = 'workspace-sidebar';
  $('.sidebar [data-action="today"]').setAttribute('aria-label', '每日任务');
  $('.sidebar [data-action="today"]').title = '每日任务';
  $('.sidebar [data-action="all"]').setAttribute('aria-label', '全部任务');
  $('.sidebar [data-action="all"]').title = '全部任务';
  let toggle = $('.sidebar-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sidebar-toggle';
    toggle.dataset.action = 'toggle-sidebar';
    toggle.setAttribute('aria-controls', 'workspace-sidebar');
    $('.breadcrumbs').prepend(toggle);
  }
  toggle.innerHTML = `${icon('panel')}<span>${label}</span>`;
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  let edgeToggle = $('#sidebar-edge-toggle');
  if (!edgeToggle) {
    edgeToggle = document.createElement('button');
    edgeToggle.id = 'sidebar-edge-toggle';
    edgeToggle.type = 'button';
    edgeToggle.dataset.action = 'toggle-sidebar';
    edgeToggle.setAttribute('aria-controls', 'workspace-sidebar');
    document.body.append(edgeToggle);
  }
  const edgeLabel = collapsed ? '展开日历' : '收起日历';
  edgeToggle.innerHTML = icon(collapsed ? 'right' : 'left');
  edgeToggle.title = edgeLabel;
  edgeToggle.setAttribute('aria-label', edgeLabel);
  edgeToggle.setAttribute('aria-expanded', String(!collapsed));
  mountSidebarResizer();
}

function setSidebarWidth(width) {
  const root = document.documentElement;
  const collapsed = width < 160;
  if (!collapsed) {
    width = Math.max(200, Math.min(360, Math.floor(innerWidth * .38), width));
    root.style.setProperty('--sidebar-expanded-width', `${width}px`);
    saveLocal('procision-sidebar-width', String(width));
  }
  root.dataset.sidebar = collapsed ? 'collapsed' : 'expanded';
  root.style.removeProperty('--sidebar-width');
  saveLocal('procision-sidebar', root.dataset.sidebar);
  renderSidebarToggle();
}

function renderInsightsToggle() {
  const panel = $('.insights');
  panel.id = 'workspace-insights';
  const collapsed = document.documentElement.dataset.insights === 'collapsed';
  let toggle = panel.querySelector('.insights-toggle');
  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'insights-toggle';
    toggle.dataset.action = 'toggle-insights';
    toggle.setAttribute('aria-controls', 'workspace-insights');
    panel.append(toggle);
  }
  const label = collapsed ? '展开右栏' : '收起右栏';
  toggle.innerHTML = `${icon(collapsed ? 'left' : 'right')}<span>${collapsed ? '思考与结论' : label}</span>`;
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = label;
}

function mountSidebarResizer() {
  if ($('#sidebar-resizer')) return;
  const handle = document.createElement('div');
  handle.id = 'sidebar-resizer';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', '拖动调整日历栏宽度');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-controls', 'workspace-sidebar');
  handle.setAttribute('aria-valuemin', '60');
  handle.setAttribute('aria-valuemax', '360');
  handle.title = '左右拖动调整宽度；向左拖到底收起，双击收起或展开';
  document.body.append(handle);
  let drag;
  let frame;
  const root = document.documentElement;
  const widthNow = () => Math.round($('.sidebar').getBoundingClientRect().width);
  const maxWidth = () => Math.min(360, Math.floor(innerWidth * .38));
  const update = () => {
    frame = null;
    if (!drag) return;
    const width = Math.max(60, Math.min(maxWidth(), drag.x));
    root.style.setProperty('--sidebar-width', `${width}px`);
    root.dataset.sidebar = width < 160 ? 'collapsed' : 'expanded';
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
  };
  const finish = cancel => {
    if (!drag) return;
    cancelAnimationFrame(frame);
    const saved = drag; drag = null;
    delete root.dataset.resizing;
    if (cancel) {
      root.dataset.sidebar = saved.mode;
      root.style.removeProperty('--sidebar-width');
      renderSidebarToggle();
    } else setSidebarWidth(Math.max(60, Math.min(maxWidth(), saved.x)));
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    drag = { x: widthNow(), mode: root.dataset.sidebar };
    root.style.setProperty('--sidebar-width', `${drag.x}px`);
    root.dataset.resizing = 'sidebar';
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
  });
  handle.addEventListener('pointermove', event => {
    if (!drag) return;
    drag.x = event.clientX;
    if (!frame) frame = requestAnimationFrame(update);
  });
  handle.addEventListener('pointerup', event => {
    if (!drag) return;
    drag.x = event.clientX; finish(false);
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  });
  handle.addEventListener('pointercancel', () => finish(true));
  handle.addEventListener('lostpointercapture', () => finish(true));
  handle.addEventListener('dblclick', () => setSidebarWidth(root.dataset.sidebar === 'collapsed' ? (Number(readLocal('procision-sidebar-width')) || 224) : 60));
  handle.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); finish(true); return; }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const width = root.dataset.sidebar === 'collapsed' ? 60 : (Number(readLocal('procision-sidebar-width')) || widthNow());
    setSidebarWidth(event.key === 'Home' ? 60 : event.key === 'End' ? maxWidth() : event.key === 'ArrowLeft' ? (width <= 200 ? 60 : width - 16) : (width < 200 ? 200 : width + 16));
  });
  const updateValue = () => handle.setAttribute('aria-valuenow', String(widthNow()));
  updateValue();
  document.addEventListener('transitionend', event => { if (event.target.matches('.sidebar')) updateValue(); });
  window.addEventListener('resize', updateValue);
}

function render() {
  statusUI.close(false);
  parkInlineEditor();
  const pageScroll = { left: window.scrollX, top: window.scrollY };
  rememberColumnScroll();
  const tasks = scopedTasks();
  const done = tasks.filter(task => taskStatus(task) === 'done').length;
  const waiting = tasks.filter(task => taskStatus(task) === 'waiting').length;
  const steps = tasks.flatMap(progressItems);
  const doneSteps = steps.filter(step => step.status === 'done').length;
  const percent = steps.length ? Math.round(doneSteps / steps.length * 100) : 0;
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'long', timeZone: 'Asia/Shanghai' }).format(new Date(`${selectedDay}T12:00:00+08:00`));
  $('#app').innerHTML = `${sidebar()}<div class="main-shell"><header class="topbar"><div class="breadcrumbs">我的工作空间 ${icon('right')} <span>${view === 'day' ? '每日任务' : '全部任务'}</span></div><div class="topbar-actions"><button class="text-button" data-action="demo">${icon('book')}${demo ? '退出示例' : '查看示例'}</button><a class="text-button ${demo ? 'disabled' : ''}" href="/api/export" ${demo ? 'aria-disabled="true" tabindex="-1"' : 'download'}>${icon('download')}导出备份</a><span class="profile-avatar">我</span></div></header><main><div class="page-heading"><div><div class="eyebrow"><span></span> YOUR DAILY MOMENTUM</div><h1>${view === 'day' ? '每日工作台' : '全部任务'}</h1><p>把想法交给 AI，把每一步进展留在这里。</p></div><button class="button primary" data-action="new-task">${icon('plus')}新建任务 <kbd>N</kbd></button></div>${demo ? '<div class="notice demo-notice">正在体验示例 · 可自由尝试，示例内容不会保存到你的工作空间。<button data-action="demo">开始使用 →</button></div>' : ''}${!connected && !demo ? '<div class="notice error-notice">本地服务未连接，当前内容可能不是最新。<button data-action="reload">重新连接</button></div>' : ''}<section class="overview" aria-label="进度概览"><div class="overview-date"><div class="date-icon">${icon('calendar')}</div><div><strong>${view === 'all' ? '所有工作记录' : shortDay(selectedDay)}</strong><span>${view === 'all' ? '让每件事都有始有终' : `${selectedDay === localDay() ? '今天 · ' : ''}${weekday} · ${selectedDay.slice(0, 4)}`}</span></div>${view === 'day' ? `<div class="date-arrows">${iconButton('prev-day', '前一天', 'left')}${iconButton('next-day', '后一天', 'right')}</div>` : ''}</div><div class="metric"><span>任务总数</span><strong>${pad(tasks.length)}<small>项任务</small></strong></div><div class="metric accent"><span><i></i>尚未完成</span><strong>${pad(tasks.length - done)}<small>继续推进</small></strong></div><div class="metric"><span>已完成</span><strong>${pad(done)}<small>项任务</small></strong></div><div class="metric amber"><span><i></i>待跟进</span><strong>${pad(waiting)}<small>需要关注</small></strong></div></section><div class="workspace-columns"><section class="task-workspace" aria-label="任务列表"><div class="list-heading"><div><h2>任务进度</h2><span id="task-count">${tasks.length} 项任务</span></div><label class="search">${icon('search')}<input id="search" type="search" placeholder="搜索任务或进度…" aria-label="搜索任务或进度" value="${escape(query)}"><kbd>/</kbd></label></div><div class="filter-row"><div id="filters"></div><button class="text-button collapse-button" data-action="collapse-all">${icon('layers')}折叠全部</button></div><div id="task-list"></div><div class="list-footnote">${icon('clock')} 未完成任务自动延续，完成的记录始终保留。</div></section><aside class="insights"><section class="insight-panel"><div class="panel-heading"><h2>进度一览</h2><span class="mono">${view === 'all' ? 'ALL TIME' : 'DAILY VIEW'}</span></div><div class="progress-summary"><div class="progress-ring" style="--progress:${percent}%"><div><strong>${percent}<small>%</small></strong><span>进度完成率</span></div></div><p>每完成一步，离目标更近一点。</p></div><div class="progress-numbers"><div><strong>${doneSteps}<span> / ${steps.length}</span></strong><small>已完成进度</small></div><div><strong>${steps.length - doneSteps}</strong><small>待推进进度</small></div></div><div class="legend"><span><i class="active"></i>进行中</span><span><i class="waiting"></i>待跟进</span><span><i class="done"></i>已完成</span></div></section>${followupPanel(tasks)}<section class="insight-panel activity-panel"><div class="panel-heading"><h2>最近动态</h2>${icon('clock')}</div>${activityPanel()}</section><div class="quiet-note"><span>FOCUS ON THE NEXT STEP.</span><p>不必一次完成所有事，<br>只要清楚下一步。</p><div>+<span>+</span></div></div></aside></div><footer class="main-footer"><span>一点一滴，皆是进展。</span><span>LOCAL FIRST <i></i> YOUR WORK, YOUR SPACE</span></footer></main></div>`;
  renderTasks();
  notesUI.mount();
  renderSidebarToggle();
  renderInsightsToggle();
  mountColumnScroll();
  workbenchUI.mount();
  if (view === 'day' && selectedDay < localDay()) $('.list-footnote').innerHTML = `${icon('clock')} 历史日期视图 · 任务展示最新进度，右侧动态按当天记录。`;
  window.scrollTo({ ...pageScroll, behavior: 'instant' });
}

function followupPanel(tasks) {
  const followups = tasks.flatMap(task => task.steps.flatMap(step =>
    (step.substeps?.length ? step.substeps : [step]).filter(item => item.status === 'waiting').map(item => ({ task, step, item }))));
  if (!followups.length) return '';
  return `<section class="insight-panel followup-panel"><div class="panel-heading"><h2>${icon('flag')}需要你关注</h2><span class="count-badge">${followups.length}</span></div>${followups.slice(0, 4).map(({ task, step, item }) => `<button class="followup-item" data-action="focus-task" data-task="${task.id}" data-step="${step.id}" ${item !== step ? `data-substep="${item.id}"` : ''}><span>${escape(item.title)}</span><small>${escape(task.title)}${item !== step ? ` / ${escape(step.title)}` : ''}</small>${icon('arrow')}</button>`).join('')}</section>`;
}

function activityPanel() {
  const activities = state.activities.filter(activity => view === 'all' || localDay(new Date(activity.at)) === selectedDay).slice(0, 4);
  return activities.length ? `<ol class="activities">${activities.map(activity => `<li><span class="activity-dot"></span><div><p>${escape(activity.message)}</p><span>${escape(activity.taskTitle)}</span><time>${view === 'all' ? dateTime(activity.at) : time(activity.at)}</time></div></li>`).join('')}</ol>` : '<div class="activity-empty">还没有动态。<br>从一个小任务开始，记录今天的进展。</div>';
}

function renderTasks() {
  parkInlineEditor();
  const tasks = scopedTasks();
  const filters = [['all', '全部', tasks.length], ['open', '未完成', tasks.filter(t => taskStatus(t) !== 'done').length], ['waiting', '待跟进', tasks.filter(t => taskStatus(t) === 'waiting').length], ['done', '已完成', tasks.filter(t => taskStatus(t) === 'done').length]];
  $('#filters').innerHTML = filters.map(([key, label, count]) => `<button class="filter ${filter === key ? 'selected' : ''}" data-action="filter" data-filter="${key}" aria-pressed="${filter === key}">${label}<span>${count}</span></button>`).join('');
  const visible = filteredTasks();
  $('#task-count').textContent = `${visible.length} 项任务`;
  $('#task-list').innerHTML = visible.length ? visible.map(taskCard).join('') : `<div class="empty-state"><div class="empty-symbol">${icon(query || filter !== 'all' ? 'search' : 'layers')}<span>+</span></div><span class="eyebrow">${query || filter !== 'all' ? 'A LITTLE LESS NOISE' : 'A FRESH START'}</span><h3>${query || filter !== 'all' ? '这里暂时没有匹配的任务' : '今天的进展，从这里开始'}</h3><p>${query || filter !== 'all' ? '试试其他关键词，或查看全部状态的任务。' : '给一个想法起个标题，再把与 AI 协作的<br>每一步记录下来。清晰的进度，就这么简单。'}</p><button class="button ${query || filter !== 'all' ? 'secondary' : 'primary'}" data-action="${query || filter !== 'all' ? 'clear-filters' : 'new-task'}">${icon(query || filter !== 'all' ? 'layers' : 'plus')}${query || filter !== 'all' ? '查看全部任务' : '创建第一个任务'}</button>${!query && filter === 'all' ? '<div class="empty-flow"><span><b>01</b> 创建任务</span><i>→</i><span><b>02</b> 记录进度</span><i>→</i><span><b>03</b> 完成一步</span></div>' : ''}</div>`;
  for (const card of $('#task-list').querySelectorAll('[data-task-id]')) {
    const task = state.tasks.find(task => task.id === card.dataset.taskId);
    const taskBody = card.querySelector('.task-body');
    if (!taskBody) continue;
    taskBody.querySelector('.steps, .no-steps').insertAdjacentHTML('beforebegin', imagesUI.gallery(task.images));
    for (const row of card.querySelectorAll('[data-step-id]')) {
      const step = task.steps.find(step => step.id === row.dataset.stepId);
      row.querySelector('.step-footer')?.insertAdjacentHTML('beforebegin', imagesUI.gallery(step.images));
      for (const childRow of row.querySelectorAll('[data-substep-id]')) {
        const child = step.substeps.find(child => child.id === childRow.dataset.substepId);
        childRow.querySelector('.substep-footer').insertAdjacentHTML('beforebegin', imagesUI.gallery(child.images));
      }
    }
  }
  workbenchUI.markSelection();
  mountInlineEditor();
}

function taskCard(task, index) {
  const status = taskStatus(task);
  const activeDirections = task.steps.some(step => stepStatus(step) === 'active');
  const finished = task.steps.filter(step => stepStatus(step) === 'done').length;
  const isCollapsed = collapsed.has(task.id) && !query;
  const work = progressItems(task);
  const percent = work.length ? Math.round(work.filter(item => item.status === 'done').length / work.length * 100) : (taskStatus(task) === 'done' ? 100 : 0);
  return `<article class="task-card task-${status}" id="task-${task.id}" data-task-id="${task.id}">
    <header class="task-header"><span class="task-index">${pad(index + 1)}</span><div class="task-title-block">
      <div class="hierarchy-path"><span class="hierarchy-level">任务</span><span>总体目标 · ${activeDirections ? '有方向进行中' : task.statusMode === 'manual' ? '状态手动管理' : task.steps.length ? '状态按方向汇总' : '点击状态开始管理'}</span></div>
      <div class="task-title-line"><h3>${renderBold(task.title, task.bold?.title)}</h3>${statusUI.chip({ value: status, label: statusLabels[status], name: `任务状态：${task.title}`, key: task.id, attrs: `data-action="choose-status" data-task="${task.id}"` })}</div>
      <div class="task-meta"><span>${shortDay(task.date)} 创建</span>${task.date < selectedDay && view === 'day' && taskStatus(task) !== 'done' ? '<span class="carry-tag">↳ 延续任务</span>' : ''}<span>${finished} / ${task.steps.length} 方向完成</span>${task.steps.some(step => step.substeps?.length) ? `<span>${work.filter(item => item.status === 'done').length} / ${work.length} 执行项完成</span>` : ''}</div>
    </div><div class="task-header-actions">${iconButton('edit-task', '编辑任务', 'edit', `data-task="${task.id}"`)}${iconButton('collapse', isCollapsed ? '展开任务' : '折叠任务', isCollapsed ? 'down' : 'up', `data-task="${task.id}" aria-expanded="${!isCollapsed}"`)}</div></header>
    <div class="task-progress" title="下级执行项完成 ${percent}%"><span style="width:${percent}%"></span></div>
    ${!isCollapsed ? `<div class="task-body">${task.description ? `<p class="task-description">${renderBold(task.description, task.bold?.description)}</p>` : ''}${task.steps.length ? `<ol class="steps">${task.steps.map((step, i) => stepCard(task, step, i)).join('')}</ol>` : '<div class="no-steps">任务状态可以直接选择。添加方向后，可拆分子进度并关联 Codex 会话。</div>'}<div class="task-bottom"><button class="add-step" data-action="new-step" data-task="${task.id}">${icon('plus')}添加方向</button><div>${taskStatus(task) === 'done' ? `<button class="text-button" data-action="reopen-task" data-task="${task.id}">重新打开 ${icon('arrow')}</button>` : task.steps.every(step => stepStatus(step) === 'done') ? `<button class="text-button" data-action="complete-task" data-task="${task.id}">${icon('check')}完成任务</button>` : ''}${iconButton('delete-task', '删除任务', 'trash', `data-task="${task.id}"`)}</div></div></div>` : ''}
  </article>`;
}

function recordContent(content, cls = 'step-content', bold = []) {
  if (!content) return '';
  return `<p class="${cls}">${renderBold(content, bold)}</p>`;
}

function workbenchButton(attrs) {
  return `<div class="wb-card-actions"><button type="button" class="wb-connect-card" data-action="open-workbench" ${attrs} ${demo ? 'disabled' : ''}>在 Codex 中打开 ↗</button></div>`;
}

function stepCard(task, step, index) {
  const attrs = `data-task="${task.id}" data-step="${step.id}"`;
  const children = step.substeps || [];
  const results = step.results || [];
  const resultsCollapsed = collapsedResults.has(step.id) && !query;
  const status = stepStatus(step);
  const done = children.filter(child => child.status === 'done').length;
  const isCollapsed = collapsedDirections.has(step.id) && !query;
  const activeChildren = children.some(child => child.status === 'active');
  const automatic = children.length && (step.statusMode !== 'manual' || activeChildren);
  const folded = foldedSteps.has(foldKey(step.id)) && !query;
  const foldButton = iconButton('fold-step', folded ? '展开方向' : '折叠方向', folded ? 'right' : 'down', `${attrs} aria-expanded="${!folded}"`);
  const dragHandle = `<button type="button" class="wb-drag-handle" draggable="${!demo}" data-workbench-drag="${step.id}" data-action="open-workbench" ${attrs} ${demo ? 'disabled' : ''} aria-label="拖动或打开 Codex：${escape(step.title)}" title="拖到右侧 Codex，或点击打开">⠿</button>`;
  if (folded) return `<li class="step step-${status} step-folded" data-step-id="${step.id}"><div class="step-main"><div class="step-heading">${dragHandle}<button class="step-title" data-action="fold-step" ${attrs} aria-expanded="false">${renderBold(step.title, step.bold?.title)}</button>${foldButton}</div>${workbenchButton(attrs)}</div></li>`;
  return `<li class="step step-${status}" data-step-id="${step.id}">
    <div class="step-track"><button class="step-check" data-action="${automatic ? 'choose-status' : 'toggle-step'}" ${attrs} aria-label="${automatic ? '选择方向状态' : status === 'done' ? '恢复未完成' : '标记完成'}：${escape(step.title)}" aria-pressed="${status === 'done'}">${status === 'done' ? icon('check') : pad(index + 1)}</button></div>
    <div class="step-main">
      <div class="hierarchy-path">${dragHandle}<span class="hierarchy-level">方向</span><span>${activeChildren ? '有子进度进行中' : automatic ? '状态按子进度汇总' : '状态手动管理'}</span></div>
      <div class="step-heading"><button class="step-title" data-action="edit-step" ${attrs}>${renderBold(step.title, step.bold?.title)}</button>${statusUI.chip({ value: status, label: statusLabels[status], name: `方向状态：${step.title}`, key: step.id, attrs: `data-action="choose-status" ${attrs}` })}${foldButton}</div>
      ${recordContent(step.content, 'step-content', step.bold?.content)}
      <div class="step-footer"><time title="${escape(step.updatedAt)}">${dateTime(step.updatedAt)}</time><div class="step-actions">${iconButton('move-up', '上移方向', 'up', `${attrs} ${index === 0 ? 'disabled' : ''}`)}${iconButton('move-down', '下移方向', 'down', `${attrs} ${index === task.steps.length - 1 ? 'disabled' : ''}`)}${iconButton('new-substep', '添加子进度', 'plus', attrs)}${iconButton('new-result', '记录结果', 'record', attrs)}${iconButton('edit-step', '编辑方向', 'edit', attrs)}${iconButton('delete-step', '删除方向', 'trash', attrs)}</div></div>
      ${children.length ? `<div class="direction-progress">
        <div class="direction-progress-heading"><button class="substeps-toggle" data-action="collapse-direction" ${attrs} aria-expanded="${!isCollapsed}" aria-controls="substeps-${step.id}">${icon(isCollapsed ? 'right' : 'down')}子进度 <span>${done} / ${children.length} 完成</span></button><span class="direction-auto">${automatic ? '完成数与状态自动汇总' : '完成数按子项统计 · 总体状态手动管理'}</span></div>
        <ol class="substeps" id="substeps-${step.id}" ${isCollapsed ? 'hidden' : ''}>${children.map((child, i) => substepCard(task, step, child, i)).join('')}</ol>
      </div>` : ''}
      ${results.length ? `<div class="direction-results">
        <div class="direction-progress-heading"><button class="results-toggle" data-action="collapse-results" ${attrs} aria-expanded="${!resultsCollapsed}" aria-controls="results-${step.id}">${icon(resultsCollapsed ? 'right' : 'down')}结果记录 <span>${results.length} 条</span></button><span class="result-hint">不计入进度</span></div>
        <ol class="results-list" id="results-${step.id}" ${resultsCollapsed ? 'hidden' : ''}>${results.map(result => resultCard(task, step, result)).join('')}</ol>
      </div>` : ''}
      ${workbenchButton(attrs)}
    </div>
  </li>`;
}

function substepCard(task, step, child, index) {
  const attrs = `data-task="${task.id}" data-step="${step.id}" data-substep="${child.id}"`;
  const dragHandle = `<button type="button" class="wb-drag-handle" draggable="${!demo}" data-workbench-drag="${child.id}" data-action="open-workbench" ${attrs} ${demo ? 'disabled' : ''} aria-label="拖动或打开 Codex：${escape(child.title)}" title="拖到右侧 Codex，或点击打开">⠿</button>`;
  return `<li class="substep substep-${child.status}" id="substep-${child.id}" data-substep-id="${child.id}">
    <button class="substep-check" data-action="toggle-substep" ${attrs} aria-label="${child.status === 'done' ? '恢复未完成' : '标记完成'}：${escape(child.title)}" aria-pressed="${child.status === 'done'}">${child.status === 'done' ? icon('check') : pad(index + 1)}</button>
    <div class="substep-main"><div class="hierarchy-path">${dragHandle}<span class="hierarchy-level">子方向</span><span>可独立研究</span></div><div class="step-heading"><button class="substep-title" data-action="edit-substep" ${attrs}>${renderBold(child.title, child.bold?.title)}</button>${statusUI.chip({ value: child.status, label: statusLabels[child.status], name: `子进度状态：${child.title}`, key: child.id, attrs: `data-action="choose-status" ${attrs}` })}</div>
      ${child.content ? `<p class="substep-content">${renderBold(child.content, child.bold?.content)}</p>` : ''}
      <div class="substep-footer"><time title="${escape(child.updatedAt)}">${dateTime(child.updatedAt)}</time><div class="substep-actions">${iconButton('move-substep-up', '上移子进度', 'up', `${attrs} ${index === 0 ? 'disabled' : ''}`)}${iconButton('move-substep-down', '下移子进度', 'down', `${attrs} ${index === step.substeps.length - 1 ? 'disabled' : ''}`)}${iconButton('edit-substep', '编辑子进度', 'edit', attrs)}${iconButton('delete-substep', '删除子进度', 'trash', attrs)}</div></div>
      ${workbenchButton(attrs)}
    </div>
  </li>`;
}

function resultCard(task, step, result) {
  const attrs = `data-task="${task.id}" data-step="${step.id}" data-result="${result.id}"`;
  return `<li class="result-record" data-result-id="${result.id}">
    <span class="result-symbol">${icon('record')}</span><div class="result-main">
      <button class="result-title" data-action="edit-result" ${attrs}>${renderBold(result.title, result.bold?.title)}</button>
      ${result.content ? `<p class="result-content">${renderBold(result.content, result.bold?.content)}</p>` : ''}${imagesUI.gallery(result.images)}
      <div class="result-footer"><time title="${escape(result.createdAt)}">${dateTime(result.createdAt)} 记录${result.updatedAt !== result.createdAt ? ` · ${dateTime(result.updatedAt)} 更新` : ''}</time><div class="result-actions"><button class="text-button" data-action="link-result" ${attrs}>${icon('book')}关联思考与结论</button>${iconButton('edit-result', '编辑结果', 'edit', attrs)}${iconButton('delete-result', '删除结果', 'trash', attrs)}</div></div>
      ${(state.notes || []).filter(note => note.sources?.some(source => source.resultId === result.id)).map(note => `<button class="source-link" data-note-action="read" data-note="${escape(note.id)}">${icon('book')}<span>${escape(note.title)}${note.archivedAt ? '（已归档）' : ''}</span>${icon('arrow')}</button>`).join('')}
    </div>
  </li>`;
}

function chooseStatus(anchor, task, step, child) {
  const item = child || step || task;
  const children = child ? [] : step ? step.substeps || [] : task.steps;
  const automatic = !child && children.length > 0 && item.statusMode !== 'manual';
  const activeChildren = !child && children.some(c => step ? c.status === 'active' : stepStatus(c) === 'active');
  const value = child ? child.status : step ? stepStatus(step) : taskStatus(task);
  const description = child ? (anchor.dataset.substep ? '' : child.title) : activeChildren ? `有${step ? '子进度' : '方向'}正在进行，总体状态保持进行中。调整下级状态后，可选择其它总体状态。` : `${step ? '方向' : '任务'}总体状态${automatic ? `由${step ? '子进度' : '方向'}自动汇总` : '由你手动管理'}。选择状态不会修改下级，完成数仍按下级统计。`;
  const options = Object.entries(statusLabels).map(([value, label]) => ({ value, label, disabled: activeChildren && value !== 'active' }));
  if (children.length) options.push({ value: 'auto', label: step ? '跟随子进度汇总' : '跟随方向汇总', detail: automatic ? '当前模式' : '自动', color: 'active' });
  if (step && !child) options.push(...children.map(c => ({ value: c.id, label: c.title, detail: statusLabels[c.status], color: c.status, action: true })));
  statusUI.open({ anchor, value: automatic ? 'auto' : value, description, options, allowSame: !child && item.statusMode !== 'manual', onSelect: async status => {
    if (step && !child && children.some(c => c.id === status)) {
      const current = state.tasks.find(t => t.id === task.id)?.steps.find(s => s.id === step.id);
      const target = current?.substeps?.find(c => c.id === status);
      if (target) chooseStatus(anchor, task, current, target);
      return;
    }
    await mutate({ type: child ? 'set-substep-status' : step ? 'set-step-status' : 'set-task-status', taskId: task.id, ...(step ? { stepId: step.id } : {}), ...(child ? { substepId: child.id, status } : status === 'auto' ? { statusMode: 'auto' } : { status, statusMode: 'manual' }) }, status === 'auto' ? '已恢复自动汇总' : `已切换为${statusLabels[status]}`);
  } });
}

function parkInlineEditor() {
  if (!editorPanel.classList.contains('inline-editor') || !editorPanel.closest('#app')) return;
  const focused = document.activeElement;
  if (editorPanel.contains(focused)) {
    const selection = window.getSelection();
    inlineFocus = { element: focused, range: selection.rangeCount && editorPanel.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null };
  }
  editorPanel.parentElement.classList.remove('inline-editing');
  document.body.append(editorPanel);
}

function mountInlineEditor() {
  if (!editorPanel.open || !formContext?.inline) return;
  const { taskId, stepId, substepId, resultId } = formContext;
  const host = resultId ? $(`[data-result-id="${resultId}"] > .result-main`)
    : substepId ? $(`[data-substep-id="${substepId}"] > .substep-main`)
    : stepId ? $(`[data-step-id="${stepId}"] > .step-main`) : $(`[data-task-id="${taskId}"]`);
  if (host) { host.classList.add('inline-editing'); host.prepend(editorPanel); }
  else $('.task-workspace').insertBefore(editorPanel, $('#task-list'));
  if (inlineFocus) {
    const { element, range } = inlineFocus; inlineFocus = null;
    element.focus({ preventScroll: true });
    if (range) { const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); }
  }
}

function closeEditor() {
  const form = editorPanel.querySelector('#editor-form');
  if (form) imagesUI.unmount(form);
  editorPanel.close();
  editorPanel.parentElement?.classList.remove('inline-editing');
  editorPanel.classList.remove('inline-editor');
  document.body.append(editorPanel);
  inlineFocus = null;
  if (formContext) formContext.inline = false;
}

function openEditor(kind, taskId, stepId, substepId, resultId) {
  closeEditor();
  const task = state.tasks.find(item => item.id === taskId);
  const step = task?.steps.find(item => item.id === stepId);
  const isStep = kind.includes('step');
  const isChild = kind.includes('substep');
  const isResult = kind.includes('result');
  const isRecord = isStep || isResult;
  const edit = kind.startsWith('edit');
  const value = edit ? (isResult ? step?.results?.find(item => item.id === resultId) : isChild ? step?.substeps?.find(item => item.id === substepId) : isStep ? step : task) : undefined;
  const automatic = !isChild && isStep && !!step?.substeps?.length;
  const noun = isResult ? '结果' : isChild ? '子进度' : isStep ? '方向' : '任务';
  const draftKey = `procision-draft:${demo ? 'demo' : 'real'}:${kind}:${resultId || substepId || stepId || taskId || selectedDay}`;
  let draft;
  try { draft = JSON.parse(readLocal(draftKey)); } catch { /* Ignore an invalid browser draft. */ }
  const source = draft || value || {};
  const activeChildren = automatic && step.substeps.some(child => child.status === 'active');
  const selectedStatus = activeChildren ? (step.statusMode === 'manual' ? 'active' : 'auto') : automatic ? (draft?.status || (step.statusMode === 'manual' ? stepStatus(step) : 'auto')) : source.status || 'active';
  const inline = edit && document.documentElement.dataset.workbench === 'cli';
  formContext = { kind, taskId, stepId, substepId, resultId, draftKey, inline };
  $('#editor').innerHTML = `<form id="editor-form">
    <div class="dialog-top"><div class="dialog-icon">${icon(isResult ? 'record' : isStep ? 'layers' : 'plus')}</div>${iconButton('close-dialog', '关闭窗口', 'close')}</div>
    <div class="eyebrow">${isResult ? 'KEEP THE RESULT' : isChild ? 'ONE STEP FORWARD' : isStep ? 'A PARALLEL DIRECTION' : 'MAKE ROOM FOR AN IDEA'}</div>
    <h2 id="dialog-title">${edit ? '编辑' : isResult ? '记录' : '添加'}${noun}</h2>
    <p class="dialog-description">${isResult ? `${escape(task.title)} → ${escape(step.title)}<br>保存验证结果、AI 输出或阶段结论，不计入任务完成率。` : isChild ? `${escape(task.title)} → ${escape(step.title)}<br>记录这个方向的下一步进展。` : isStep ? `「${escape(task.title)}」的一个并行方向，可在下面继续添加子进度。` : '一个清晰的标题，是推进一件事的开始。'}</p>
    <label class="field-label" for="form-title">${noun}标题 <span>*</span></label>
    <input class="field" id="form-title" name="title" required maxlength="200" autocomplete="off" placeholder="${isResult ? '例如：第一轮验证的结果与结论' : isChild ? '例如：完成第一轮验证并记录结果' : isStep ? '例如：研究中心漂移的调整方式' : '例如：搭建我的 AI 协作工作台'}" value="${escape(source.title || '')}">
    <label class="field-label" for="form-content">${isResult ? '结果内容' : isStep ? '进度记录' : '补充说明'} <small>可选</small></label>
    <textarea class="field" id="form-content" name="${isRecord ? 'content' : 'description'}" rows="${isRecord ? '7' : '4'}" maxlength="${isRecord ? '50000' : '10000'}" placeholder="${isResult ? '记录这次得到了什么结果、有什么发现，也可以粘贴 AI 输出或截图。' : isStep ? '把 AI 的回复、已完成的工作、遇到的问题粘贴在这里…\n支持多行文本，保留原始换行。' : '这个任务想解决什么问题？可以记下背景或目标。'}">${escape((isRecord ? source.content : source.description) || '')}</textarea>
    ${isStep ? `<label class="field-label">${automatic ? '方向总体状态' : '当前状态'}</label><div class="status-options">${[...Object.entries(statusLabels), ...(automatic ? [['auto', '跟随子进度汇总']] : [])].map(([value, label]) => `<label class="status-option ${value}"><input type="radio" name="status" value="${value}" ${selectedStatus === value ? 'checked' : ''}><span><i></i>${label}</span></label>`).join('')}</div>${automatic ? '<p class="direction-status-hint">手动选择只修改方向总体状态，保留每条子进度的状态与完成数；选择“跟随子进度汇总”可恢复自动管理。</p>' : ''}` : !edit && !isResult ? `<label class="field-label" for="form-date">所属日期</label><input class="field date-field" type="date" id="form-date" name="date" required value="${escape(source.date || (view === 'all' ? localDay() : selectedDay))}">` : ''}
    <div class="dialog-footer"><span>${draft ? '已恢复未保存的草稿' : 'Ctrl + Enter 快速保存'}</span><div><button type="button" class="button secondary" data-action="close-dialog">取消</button><button type="submit" class="button primary">${icon('check')}${edit ? '保存修改' : isResult ? '保存结果' : isStep ? `添加${noun}` : '创建任务'}</button></div></div>
  </form>`;
  if (inline) {
    editorPanel.classList.add('inline-editor');
    editorPanel.show(); mountInlineEditor();
  } else editorPanel.showModal();
  const form = $('#editor-form');
  if (activeChildren) {
    for (const radio of form.querySelectorAll('input[name=status]')) radio.disabled = !['active', 'auto'].includes(radio.value);
    form.querySelector('.direction-status-hint').textContent = '有子进度正在进行，方向保持进行中。先调整子进度状态，再选择其它总体状态。';
  }
  mountBoldEditors(form, source);
  imagesUI.mount(form, source.images ?? value?.images ?? [], draftKey, () => saveLocal(draftKey, JSON.stringify(editorValues(form))));
  $('#form-title').focus({ preventScroll: inline });
  if (inline) {
    const panel = $('.task-workspace'), top = editorPanel.getBoundingClientRect().top - panel.getBoundingClientRect().top;
    panel.scrollTop += top - 12;
  }
}

function confirmDelete(kind, taskId, stepId, substepId, resultId) {
  closeEditor();
  const task = state.tasks.find(item => item.id === taskId);
  const step = task?.steps.find(item => item.id === stepId);
  const child = step?.substeps?.find(item => item.id === substepId);
  const result = step?.results?.find(item => item.id === resultId);
  const title = result?.title || child?.title || step?.title || task.title;
  const count = child ? 0 : step ? step.substeps?.length || 0 : task.steps.reduce((total, step) => total + (step.substeps?.length || 0), 0);
  const resultCount = step ? step.results?.length || 0 : task.steps.reduce((total, step) => total + (step.results?.length || 0), 0);
  const resultWarning = resultCount ? `、${resultCount} 条结果记录` : '';
  const description = child || result ? '将被删除。' : step ? `和其中的 ${count} 条子进度${resultWarning}将被删除。` : `和其中的 ${task.steps.length} 个方向、${count} 条子进度${resultWarning}将被删除。`;
  $('#editor').innerHTML = `<div class="confirm-dialog"><div class="dialog-top"><div class="dialog-icon danger">${icon('trash')}</div>${iconButton('close-dialog', '关闭窗口', 'close')}</div><h2 id="dialog-title">删除${result ? '这条结果记录' : child ? '这条子进度' : step ? '这个方向' : '这个任务'}？</h2><p>「${escape(title)}」${description}此操作无法撤销。</p><div class="dialog-footer"><span></span><div><button class="button secondary" data-action="close-dialog" autofocus>保留</button><button class="button danger-button" data-action="confirm-delete" data-kind="${kind}" data-task="${taskId}" ${stepId ? `data-step="${stepId}"` : ''} ${substepId ? `data-substep="${substepId}"` : ''} ${resultId ? `data-result="${resultId}"` : ''}>确认删除</button></div></div></div>`;
  $('#editor').showModal();
}

function navigateDay(day) { selectedDay = day; calendarMonth = day.slice(0, 7); view = 'day'; filter = 'all'; query = ''; render(); }

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const { action, task: taskId, step: stepId, substep: substepId, result: resultId } = button.dataset;
  if (busy && action !== 'close-dialog') return;
  const task = state.tasks.find(item => item.id === taskId);
  const step = task?.steps.find(item => item.id === stepId);
  switch (action) {
    case 'open-workbench': workbenchUI.open(substepId || stepId); break;
    case 'choose-status': chooseStatus(button, task, step, substepId ? step.substeps.find(item => item.id === substepId) : undefined); break;
    case 'toggle-insights': {
      const panel = $('.insights');
      const expanding = document.documentElement.dataset.insights === 'collapsed';
      const toggleVersion = ++insightsToggleVersion;
      if (!expanding) rememberColumnScroll();
      const readingPosition = columnScrollPositions.get(panel.dataset.scrollKey) || 0;
      document.documentElement.dataset.insights = expanding ? 'expanded' : 'collapsed';
      saveLocal('procision-insights', document.documentElement.dataset.insights);
      renderInsightsToggle();
      if (expanding && separateColumns.matches) {
        panel.scrollTop = readingPosition;
        // Restore once column reflow finishes; browser anchoring can move the offset during it.
        const transitions = $('.workspace-columns').getAnimations();
        Promise.allSettled(transitions.map(animation => animation.finished)).then(() => {
          if (toggleVersion === insightsToggleVersion && panel.isConnected && separateColumns.matches) panel.scrollTop = readingPosition;
        });
      }
      break;
    }
    case 'toggle-sidebar': {
      const next = document.documentElement.dataset.sidebar === 'collapsed' ? 'expanded' : 'collapsed';
      document.documentElement.dataset.sidebar = next;
      saveLocal('procision-sidebar', next);
      renderSidebarToggle();
      break;
    }
    case 'today': navigateDay(localDay()); break;
    case 'all': view = 'all'; filter = 'all'; query = ''; render(); break;
    case 'date': navigateDay(button.dataset.date); break;
    case 'prev-day': navigateDay(shiftDay(selectedDay, -1)); break;
    case 'next-day': navigateDay(shiftDay(selectedDay, 1)); break;
    case 'prev-month': case 'next-month': {
      const date = new Date(`${calendarMonth}-01T12:00:00Z`);
      date.setUTCMonth(date.getUTCMonth() + (action === 'next-month' ? 1 : -1));
      calendarMonth = date.toISOString().slice(0, 7); $('#calendar').innerHTML = calendar(); break;
    }
    case 'theme': document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; saveLocal('procision-theme', document.documentElement.dataset.theme); render(); break;
    case 'demo': closeEditor(); demo = !demo; history.replaceState(null, '', demo ? '/?demo' : '/'); filter = 'all'; query = ''; collapsed.clear(); await load(); break;
    case 'reload': await load(); break;
    case 'filter': filter = button.dataset.filter; renderTasks(); break;
    case 'clear-filters': filter = 'all'; query = ''; $('#search').value = ''; renderTasks(); break;
    case 'new-task': openEditor('create-task'); break;
    case 'edit-task': openEditor('edit-task', taskId); break;
    case 'new-step': openEditor('create-step', taskId); break;
    case 'edit-step': openEditor('edit-step', taskId, stepId); break;
    case 'new-substep': openEditor('create-substep', taskId, stepId); break;
    case 'edit-substep': openEditor('edit-substep', taskId, stepId, substepId); break;
    case 'new-result': openEditor('create-result', taskId, stepId); break;
    case 'link-result': notesUI.linkResult(resultId); break;
    case 'edit-result': openEditor('edit-result', taskId, stepId, undefined, resultId); break;
    case 'collapse-results': collapsedResults.has(stepId) ? collapsedResults.delete(stepId) : collapsedResults.add(stepId); renderTasks(); break;
    case 'collapse-direction': collapsedDirections.has(stepId) ? collapsedDirections.delete(stepId) : collapsedDirections.add(stepId); renderTasks(); break;
    case 'fold-step': {
      setStepFolded(stepId, !foldedSteps.has(foldKey(stepId)));
      renderTasks();
      $(`[data-step-id="${stepId}"] .icon-button[data-action="fold-step"]`)?.focus({ preventScroll: true });
      break;
    }
    case 'toggle-substep': {
      const child = step.substeps.find(item => item.id === substepId);
      await mutate({ type: 'set-substep-status', taskId, stepId, substepId, status: child.status === 'done' ? 'active' : 'done' }, child.status === 'done' ? '子进度已恢复为进行中' : '子进度已完成');
      break;
    }
    case 'move-substep-up': case 'move-substep-down': await mutate({ type: 'move-substep', taskId, stepId, substepId, direction: action === 'move-substep-up' ? -1 : 1 }); break;
    case 'close-dialog': closeEditor(); break;
    case 'collapse': collapsed.has(taskId) ? collapsed.delete(taskId) : collapsed.add(taskId); renderTasks(); break;
    case 'collapse-all': {
      const visible = filteredTasks(); const allCollapsed = visible.every(task => collapsed.has(task.id));
      visible.forEach(task => allCollapsed ? collapsed.delete(task.id) : collapsed.add(task.id));
      button.innerHTML = `${icon('layers')}${allCollapsed ? '折叠全部' : '展开全部'}`; renderTasks(); break;
    }
    case 'toggle-step': await mutate({ type: 'set-step-status', taskId, stepId, status: stepStatus(step) === 'done' ? 'active' : 'done' }, stepStatus(step) === 'done' ? '已恢复为进行中' : '又完成了一步'); break;
    case 'move-up': case 'move-down': await mutate({ type: 'move-step', taskId, stepId, direction: action === 'move-up' ? -1 : 1 }); break;
    case 'complete-task': await mutate({ type: 'complete-task', taskId }, '任务已完成'); break;
    case 'reopen-task': await mutate({ type: 'reopen-task', taskId }, '任务已重新打开'); break;
    case 'delete-task': case 'delete-step': case 'delete-substep': case 'delete-result': confirmDelete(action, taskId, stepId, substepId, resultId); break;
    case 'confirm-delete': if (await mutate({ type: button.dataset.kind, taskId, stepId, substepId, resultId }, '已删除')) closeEditor(); break;
    case 'focus-task': filter = 'all'; query = ''; $('#search').value = ''; collapsed.delete(taskId); collapsedDirections.delete(stepId); setStepFolded(stepId, false); renderTasks(); $(substepId ? `#substep-${substepId}` : `#task-${taskId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
  }
});

function editorValues(form) {
  const formatting = boldValues(form);
  return { ...Object.fromEntries(new FormData(form)), ...formatting, images: imagesUI.get(form) };
}

document.addEventListener('input', event => {
  if (event.target.id === 'search') { query = event.target.value; renderTasks(); }
  if (event.target.closest('#editor-form')) saveLocal(formContext.draftKey, JSON.stringify(editorValues($('#editor-form'))));
});
document.addEventListener('change', async event => {
  if (['step-status', 'substep-status'].includes(event.target.dataset.action)) {
    const { task: taskId, step: stepId, substep: substepId } = event.target.dataset;
    if (!await mutate({ type: substepId ? 'set-substep-status' : 'set-step-status', taskId, stepId, substepId, status: event.target.value }, '进度状态已更新')) renderTasks();
  }
});
document.addEventListener('submit', async event => {
  if (event.target.id !== 'editor-form') return;
  event.preventDefault();
  if (busy || !imagesUI.ready(event.target)) return;
  try { validateBoldEditors(event.target); } catch (error) { showError(error.message); return; }
  const values = editorValues(event.target);
  const { kind, taskId, stepId, substepId, resultId, draftKey } = formContext;
  if (kind === 'edit-step' && state.tasks.find(t => t.id === taskId)?.steps.find(s => s.id === stepId)?.substeps?.length) {
    values.statusMode = values.status === 'auto' ? 'auto' : 'manual';
    if (values.statusMode === 'auto') delete values.status;
  }
  if (kind === 'create-substep') collapsedDirections.delete(stepId);
  if (kind === 'create-result') collapsedResults.delete(stepId);
  const submit = event.target.querySelector('[type=submit]');
  submit.disabled = true;
  if (await mutate({ type: kind, taskId, stepId, substepId, resultId, ...values }, kind.startsWith('edit') ? '修改已保存' : kind.includes('result') ? '结果已保存' : kind.includes('step') ? '进度已添加' : '任务已创建')) {
    await imagesUI.commit(event.target);
    saveLocal(draftKey, null);
    if (event.target === $('#editor-form')) closeEditor();
  }
  submit.disabled = false;
});
document.addEventListener('keydown', event => {
  if (event.target.closest('#workbench-root') || $('#workspace-settings')?.open || $('#workspace-files')?.open) return;
  if ($('#image-viewer')?.open) return;
  if (event.target.closest('.status-menu')) return;
  if ($('#editor').open) {
    if (!formContext?.inline || event.target.closest('#editor')) {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); $('#editor-form')?.requestSubmit(); }
      if (formContext?.inline && event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeEditor(); }
    }
    return;
  }
  if (/INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.key.toLowerCase() === 'n') { event.preventDefault(); openEditor('create-task'); }
  if (event.key === '/') { event.preventDefault(); $('#search').focus(); }
});
document.addEventListener('visibilitychange', () => { if (!document.hidden && !demo && !$('#editor').open) load({ quiet: true }); });
let lastToday = localDay();
setInterval(() => {
  const today = localDay();
  if (today !== lastToday && !$('#editor').open) {
    if (selectedDay === lastToday && view === 'day') { selectedDay = today; calendarMonth = today.slice(0, 7); }
    lastToday = today; render();
  }
  if (!document.hidden && !demo && !$('#editor').open) load({ quiet: true });
}, 30000);
await load();
