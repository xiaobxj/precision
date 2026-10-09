import { randomBytes, randomUUID } from 'node:crypto';
import { realpathSync, statSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, extname, join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import pty from 'node-pty';
import headless from '@xterm/headless';
import serialize from '@xterm/addon-serialize';
import { codexExecutable, codexEnv, listSessions, createSession, readSessionActivities } from './codex.mjs';
import { findWorkbenchDirection, workbenchDirections } from './domain.mjs';

const hidden = new Set(['.git', '.codex', '.env', 'node_modules', '.npm-cache', '__pycache__']);
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export function directory(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error('请填写已存在的绝对目录路径');
  const path = realpathSync(value);
  if (!statSync(path).isDirectory()) throw new Error('工作目录不存在');
  return path;
}
export function scopedPath(root, value = '') {
  if (typeof value !== 'string' || isAbsolute(value) || value.includes('\0')) throw new Error('文件路径无效');
  if (value.split(/[\\/]/).some(part => hidden.has(part) || part.startsWith('.env.'))) throw new Error('此文件不在预览范围内');
  const base = directory(root), path = realpathSync(resolve(base, value));
  const rel = relative(base, path);
  if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('文件必须位于该方向的工作目录内');
  return path;
}

export function createWorkbench({ getState, saveCommand, launch = pty.spawn, sessions = listSessions, newSession = createSession, activities = readSessionActivities, activityInterval = 4000 }) {
  const token = randomBytes(32).toString('hex');
  const terminals = new Map(), starting = new Set();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const find = stepId => findWorkbenchDirection(getState(), stepId);
  const publicTerminal = t => ({ id: t.id, stepId: t.stepId, sessionId: t.sessionId, cwd: t.cwd, status: t.status, startedAt: t.startedAt, exitCode: t.exitCode, activity: t.activity });
  const send = (ws, value) => { if (ws.readyState === WebSocket.OPEN) { if (ws.bufferedAmount > 2 * 1024 * 1024) ws.close(1013, '请重新连接'); else ws.send(JSON.stringify(value)); } };
  const broadcast = (t, value) => { for (const ws of t.clients) send(ws, value); };
  let activityCheck, activityCheckedAt = 0;
  async function refreshActivities() {
    if (activityCheck) return activityCheck;
    if (Date.now() - activityCheckedAt < activityInterval) return;
    const running = [...terminals.values()].filter(t => t.status === 'running');
    if (!running.length) return;
    activityCheckedAt = Date.now();
    activityCheck = (async () => {
      let states;
      try { states = await activities(running.map(t => t.sessionId)); } catch { states = new Map(); }
      for (const t of running) {
        if (t.disposed || terminals.get(t.stepId) !== t || t.status !== 'running') continue;
        const next = states.get(t.sessionId) || { state: 'unknown' };
        if (JSON.stringify(t.activity) === JSON.stringify(next)) continue;
        t.activity = next;
        broadcast(t, { type: 'status', terminal: publicTerminal(t) });
      }
    })();
    try { await activityCheck; } finally { activityCheck = null; }
  }
  const stop = t => {
    if (t.status !== 'running') return;
    t.status = 'stopping'; broadcast(t, { type: 'status', terminal: publicTerminal(t) });
    try { t.process.kill(); }
    catch (error) { t.status = 'running'; broadcast(t, { type: 'status', terminal: publicTerminal(t) }); throw error; }
  };
  function guard(command) {
    const ids = command.type === 'delete-task'
      ? workbenchDirections(getState()).filter(d => d.task.id === command.taskId).map(d => d.step.id)
      : command.type === 'delete-step'
        ? workbenchDirections(getState()).filter(d => d.step.id === command.stepId || d.parent?.id === command.stepId).map(d => d.step.id)
        : [command.type === 'delete-substep' ? command.substepId : command.stepId];
    const oldWorkspace = command.type === 'bind-workspace' ? find(command.stepId).step.workspace : null;
    const bindingChanged = command.type === 'bind-workspace' && (!oldWorkspace || !samePath(resolve(command.cwd || ''), resolve(oldWorkspace.cwd)) || (command.sessionId || '') !== oldWorkspace.sessionId);
    if ((bindingChanged || ['delete-task', 'delete-step', 'delete-substep'].includes(command.type)) && ids.some(id => starting.has(id) || ['running', 'stopping'].includes(terminals.get(id)?.status))) throw new Error('请先结束该方向及其子方向的终端，再修改绑定或删除方向');
    if (command.type === 'bind-workspace') {
      command.cwd = directory(command.cwd);
      for (const file of command.files || []) scopedPath(command.cwd, file);
    }
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('需要 JSON 请求');
    let data = '';
    for await (const chunk of req) { data += chunk; if (data.length > 65536) throw new Error('请求过大'); }
    return JSON.parse(data || '{}');
  }
  function check(req) {
    const expected = `http://${req.headers.host}`;
    return req.headers['x-precision-token'] === token && (!req.headers.origin || req.headers.origin === expected) && !['cross-site', 'same-site'].includes(req.headers['sec-fetch-site']);
  }
  async function route(req, res, url, json) {
    if (!url.pathname.startsWith('/api/workbench')) return false;
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` || ['cross-site', 'same-site'].includes(req.headers['sec-fetch-site'])) { json(res, 403, { error: '请求来源无效' }); return true; }
    if (url.pathname === '/api/workbench/bootstrap' && req.method === 'GET') {
      await refreshActivities();
      json(res, 200, { token, terminals: [...terminals.values()].map(publicTerminal), projects: discoverProjects() }); return true;
    }
    if (!check(req)) { json(res, 403, { error: '工作台连接已过期，请刷新页面' }); return true; }
    try {
      const action = url.pathname.slice('/api/workbench/'.length);
      if (action === 'sessions' && req.method === 'GET') json(res, 200, await sessions(url.searchParams.get('cursor')));
      else if (action === 'status' && req.method === 'GET') {
        await refreshActivities();
        json(res, 200, { terminals: [...terminals.values()].map(publicTerminal) });
      }
      else if (action === 'start' && req.method === 'POST') {
        const input = await body(req), { task, step, parent } = find(input.stepId);
        if (!['new', 'resume'].includes(input.mode)) throw new Error('请选择新建或恢复会话');
        if (!step.workspace?.cwd) throw new Error('请先关联工作目录');
        if (starting.has(step.id)) throw new Error('此方向正在启动，请稍候');
        const existing = terminals.get(step.id);
        if (existing?.status === 'running') { json(res, 200, { terminal: publicTerminal(existing), state: getState() }); return true; }
        if (existing?.status === 'stopping') throw new Error('终端正在退出，请稍候');
        starting.add(step.id);
        try {
          const cwd = directory(step.workspace.cwd);
          let sessionId = step.workspace.sessionId;
          if (input.mode === 'resume' && !sessionId) throw new Error('请先选择已有会话，或新建会话');
          if (input.mode === 'new') {
            sessionId = await newSession(cwd, [task.title, parent?.title, step.title].filter(Boolean).join(' / '));
            saveCommand({ type: 'bind-workspace', taskId: task.id, stepId: step.id, cwd, sessionId, files: find(step.id).step.workspace.files || [] });
          }
          if ([...terminals.values()].some(t => t.status === 'running' && t.sessionId === sessionId)) throw new Error('这个会话已在另一个方向的终端中运行');
          const term = new headless.Terminal({ cols: 100, rows: 30, scrollback: 3000, allowProposedApi: true });
          const serial = new serialize.SerializeAddon(); term.loadAddon(serial);
          let proc;
          try { proc = launch(codexExecutable(), ['resume', sessionId, '--cd', cwd, '--no-alt-screen', '--no-daemon', '-c', 'check_for_update_on_startup=false'], { name: 'xterm-256color', cols: 100, rows: 30, cwd, env: codexEnv(), useConpty: true, useConptyDll: true }); }
          catch (error) { term.dispose(); throw error; }
          if (existing) { for (const ws of existing.clients) ws.close(1000, '终端已重新启动'); existing.term.dispose(); }
          const t = { id: randomUUID(), stepId: step.id, cwd, sessionId, startedAt: new Date().toISOString(), status: 'running', activity: { state: 'unknown' }, process: proc, term, serial, clients: new Set(), writer: null };
          terminals.set(step.id, t);
          activityCheckedAt = 0;
          proc.onData(data => { if (!t.disposed) term.write(data, () => broadcast(t, { type: 'output', data })); });
          proc.onExit(({ exitCode }) => { t.status = 'exited'; t.exitCode = exitCode; if (!t.disposed) term.write('', () => broadcast(t, { type: 'status', terminal: publicTerminal(t) })); });
          json(res, 200, { terminal: publicTerminal(t), state: getState() });
        } finally { starting.delete(step.id); }
      } else if (action === 'stop' && req.method === 'POST') {
        const input = await body(req), t = terminals.get(input.stepId);
        if (!t || t.id !== input.id) throw new Error('终端已变化，请刷新连接');
        stop(t); json(res, 200, { terminal: publicTerminal(t) });
      } else if (action === 'files' && req.method === 'GET') {
        const { step } = find(url.searchParams.get('stepId'));
        const path = scopedPath(step.workspace?.cwd, url.searchParams.get('path') || '');
        const info = statSync(path);
        if (info.isDirectory()) {
          const entries = readdirSync(path, { withFileTypes: true }).filter(e => !hidden.has(e.name) && !e.name.startsWith('.env.')).map(e => ({ name: e.name, directory: e.isDirectory(), link: e.isSymbolicLink() })).sort((a,b) => Number(b.directory)-Number(a.directory) || a.name.localeCompare(b.name));
          json(res, 200, { kind: 'directory', entries: entries.slice(0, 400), truncated: entries.length > 400 });
        } else {
          if (info.size > 1024 * 1024) throw new Error('该文件超过 1 MB，请在本地编辑器中查看');
          const bytes = readFileSync(path), ext = extname(path).toLowerCase();
          const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
          if (mime) json(res, 200, { kind: 'image', mime, data: bytes.toString('base64'), modifiedAt: info.mtime.toISOString() });
          else if (bytes.includes(0)) throw new Error('该文件为二进制格式，暂不支持预览');
          else json(res, 200, { kind: 'text', text: bytes.toString('utf8'), modifiedAt: info.mtime.toISOString() });
        }
      } else json(res, 404, { error: '接口不存在' });
    } catch (error) { json(res, 400, { error: error.code === 'ENOENT' ? '目录或文件不存在，请检查绑定路径' : error.message }); }
    return true;
  }
  function attach(server) {
    server.on('upgrade', (req, socket, head) => {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) || req.headers.origin !== `http://${host}`) return socket.destroy();
      const url = new URL(req.url, `http://${host}`);
      const t = terminals.get(url.searchParams.get('stepId'));
      if (url.pathname !== '/api/workbench/attach' || url.searchParams.get('token') !== token || !t || url.searchParams.get('id') !== t.id) return socket.destroy();
      wss.handleUpgrade(req, socket, head, ws => {
        // One controlling browser at a time; refreshing releases the old controller.
        if (t.writer?.readyState === WebSocket.OPEN) { send(t.writer, { type: 'readonly' }); }
        t.writer = ws;
        t.term.write('', () => { if (ws.readyState !== WebSocket.OPEN) return; send(ws, { type: 'snapshot', data: t.serial.serialize(), terminal: publicTerminal(t) }); t.clients.add(ws); });
        ws.on('message', raw => {
          if (t.writer !== ws || t.status !== 'running') return;
          try {
            const m = JSON.parse(raw);
            if (m.type === 'input' && typeof m.data === 'string' && m.data.length <= 32768) t.process.write(m.data);
            if (m.type === 'resize' && Number.isInteger(m.cols) && Number.isInteger(m.rows) && m.cols >= 20 && m.cols <= 400 && m.rows >= 5 && m.rows <= 200) { t.term.resize(m.cols, m.rows); t.process.resize(m.cols, m.rows); }
          } catch { ws.close(1008, '无效消息'); }
        });
        ws.on('close', () => { t.clients.delete(ws); if (t.writer === ws) t.writer = null; });
        ws.on('error', () => ws.close());
      });
    });
  }
  function close() { for (const t of terminals.values()) { t.disposed = true; stop(t); for (const ws of t.clients) ws.terminate(); t.term.dispose(); } wss.close(); }
  return { route, attach, guard, close };
}

function discoverProjects() {
  const base = process.env.PRECISION_PROJECTS_ROOT || 'D:\\workflow\\research\\strategies';
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => ({ name: e.name, path: join(base, e.name) }));
}
