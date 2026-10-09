import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { once, EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import { createApp } from '../server.mjs';
import { scopedPath } from '../lib/workbench.mjs';
import { applyCommand, emptyState } from '../lib/domain.mjs';

const scratch = join(import.meta.dirname, '../test-results/unit');
mkdirSync(scratch, { recursive: true });
const id1 = 'aaaaaaaa-1111-2222-3333-444444444444', id2 = 'bbbbbbbb-1111-2222-3333-444444444444';

test('workspace binding preserves journal, completion and prior sessions', () => {
  let state = applyCommand(emptyState(), { type: 'create-task', title: '研究', date: '2026-10-09' });
  const taskId = state.tasks[0].id;
  state = applyCommand(state, { type: 'create-step', taskId, title: '方向', content: '我的结论', status: 'done' });
  const stepId = state.tasks[0].steps[0].id, before = structuredClone(state);
  state = applyCommand(state, { type: 'bind-workspace', taskId, stepId, cwd: 'D:\\precision', sessionId: id1 });
  state = applyCommand(state, { type: 'bind-workspace', taskId, stepId, cwd: 'D:\\precision', sessionId: id2 });
  assert.equal(state.tasks[0].completedAt, before.tasks[0].completedAt);
  assert.deepEqual(state.activities, before.activities);
  assert.equal(state.tasks[0].steps[0].content, '我的结论');
  assert.equal(state.tasks[0].steps[0].workspace.history[0].sessionId, id1);
  assert.throws(() => applyCommand(state, { type: 'bind-workspace', taskId, stepId, cwd: 'D:\\precision', sessionId: 'not-a-session' }));
});

test('file scope rejects traversal and directory junction escape', () => {
  const root = mkdtempSync(join(scratch, 'scope-')), outside = mkdtempSync(join(scratch, 'outside-'));
  writeFileSync(join(root, 'README.md'), '研究'); writeFileSync(join(outside, 'private.md'), 'outside');
  assert.equal(scopedPath(root, 'README.md'), join(root, 'README.md'));
  assert.throws(() => scopedPath(root, `../${outside.split(/[\\/]/).at(-1)}/private.md`));
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => scopedPath(root, 'escape/private.md'));
  assert.throws(() => scopedPath(root, '.env'));
});

test('child workspace owns its binding and history without changing parent, siblings or progress', () => {
  let state = applyCommand(emptyState(), { type: 'create-task', title: '研究', date: '2026-10-09' });
  const taskId = state.tasks[0].id;
  const run = command => { state = applyCommand(state, { taskId, ...command }); };
  run({ type: 'create-step', title: '父方向', status: 'active' });
  const parentId = state.tasks[0].steps[0].id;
  run({ type: 'bind-workspace', stepId: parentId, cwd: 'D:\\precision', sessionId: id1, files: ['README.md'] });
  run({ type: 'create-substep', stepId: parentId, title: '子方向', status: 'active', content: '手动结论' });
  run({ type: 'create-substep', stepId: parentId, title: '普通执行项', status: 'waiting' });
  const childId = state.tasks[0].steps[0].substeps[0].id, before = structuredClone(state);
  run({ type: 'bind-workspace', stepId: childId, cwd: 'D:\\precision', sessionId: id2 });
  run({ type: 'bind-workspace', stepId: childId, cwd: 'D:\\precision\\research', sessionId: '' });
  const child = state.tasks[0].steps[0].substeps[0];
  assert.deepEqual(child.workspace.history, [{ sessionId: id2, cwd: 'D:\\precision', at: child.workspace.updatedAt }]);
  assert.equal(child.workspace.sessionId, '');
  const withoutBinding = structuredClone(state);
  delete withoutBinding.tasks[0].steps[0].substeps[0].workspace;
  withoutBinding.revision = before.revision;
  assert.deepEqual(withoutBinding, before);
  assert.throws(() => run({ type: 'bind-workspace', taskId: 'other-task', stepId: childId, cwd: 'D:\\precision' }));
});

test('child terminals use distinct sessions, survive parent switching and guard subtree deletion while starting or running', async t => {
  const dataDir = mkdtempSync(join(scratch, 'child-api-')), project = join(dataDir, 'project');
  mkdirSync(project); writeFileSync(join(project, 'README.md'), 'shared context');
  const processes = [], requests = [], launches = [];
  let release;
  const server = createApp({ dataDir, workbenchOptions: {
    activities: async () => new Map(),
    newSession: async (cwd, title) => { requests.push({ cwd, title }); return await new Promise(resolve => { release = () => resolve(id2); }); },
    launch: (file, args, options) => {
      launches.push({ args, cwd: options.cwd }); const e = new EventEmitter(); processes.push(e);
      return { onData: cb => e.on('data', cb), onExit: cb => e.on('exit', cb), write: () => {}, resize: () => {}, kill: () => e.emit('exit', { exitCode: 0 }) };
    },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { release?.(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  let state = await (await fetch(`${url}/api/state`)).json();
  const command = async value => {
    const response = await fetch(`${url}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, command: value }) });
    const result = await response.json(); if (response.ok) state = result; return response;
  };
  await command({ type: 'create-task', title: '研究', date: '2026-10-09' }); const taskId = state.tasks[0].id;
  await command({ type: 'create-step', taskId, title: '父方向', status: 'active' }); const parentId = state.tasks[0].steps[0].id;
  await command({ type: 'create-substep', taskId, stepId: parentId, title: '独立研究', status: 'active' }); const childId = state.tasks[0].steps[0].substeps[0].id;
  await command({ type: 'bind-workspace', taskId, stepId: parentId, cwd: project, sessionId: id1 });
  await command({ type: 'bind-workspace', taskId, stepId: childId, cwd: project, files: ['README.md'] });
  const before = structuredClone(state);
  const { token } = await (await fetch(`${url}/api/workbench/bootstrap`)).json();
  const post = (action, value) => fetch(`${url}/api/workbench/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Precision-Token': token }, body: JSON.stringify(value) });
  const pending = post('start', { stepId: childId, mode: 'new' });
  await new Promise((resolve, reject) => {
    const poll = setInterval(() => { if (release) { clearInterval(poll); clearTimeout(deadline); resolve(); } }, 5);
    const deadline = setTimeout(() => { clearInterval(poll); reject(new Error('child did not start')); }, 3000);
  });
  const deletions = [ { type: 'delete-task', taskId }, { type: 'delete-step', taskId, stepId: parentId }, { type: 'delete-substep', taskId, stepId: parentId, substepId: childId } ];
  for (const deletion of deletions) assert.equal((await command(deletion)).status, 400);
  assert.equal((await command({ type: 'bind-workspace', taskId, stepId: childId, cwd: project, sessionId: id1 })).status, 400);
  release(); let result = await (await pending).json(); state = result.state;
  assert.equal(result.terminal.stepId, childId); assert.equal(result.terminal.sessionId, id2);
  assert.deepEqual(requests, [{ cwd: project, title: '研究 / 父方向 / 独立研究' }]);
  const childTerminal = result.terminal;
  result = await (await post('start', { stepId: parentId, mode: 'resume' })).json(); state = result.state;
  assert.equal(result.terminal.sessionId, id1);
  assert.deepEqual(launches.map(l => l.args.slice(0, 2)), [['resume', id2], ['resume', id1]]);
  assert.deepEqual(launches.map(l => l.cwd), [project, project]);
  result = await (await post('start', { stepId: childId, mode: 'resume' })).json();
  assert.equal(result.terminal.id, childTerminal.id); assert.equal(launches.length, 2);
  assert.deepEqual(state.activities, before.activities);
  assert.deepEqual(state.tasks[0].steps[0].workspace, before.tasks[0].steps[0].workspace);
  assert.equal(state.tasks[0].steps[0].substeps[0].status, 'active');
  const preview = await (await fetch(`${url}/api/workbench/files?stepId=${childId}&path=README.md`, { headers: { 'X-Precision-Token': token } })).json();
  assert.equal(preview.text, 'shared context');
  processes[1].emit('exit', { exitCode: 0 }); // Child alone still protects its ancestors.
  for (const deletion of deletions) assert.equal((await command(deletion)).status, 400);
  await post('stop', { stepId: childId, id: childTerminal.id });
  assert.equal((await command(deletions[2])).status, 200);
  assert.equal(state.tasks[0].steps[0].workspace.sessionId, id1);
});

test('terminal reattaches without relaunching, isolates input and never writes progress', async t => {
  const dataDir = mkdtempSync(join(scratch, 'api-')), project = join(dataDir, 'project'); mkdirSync(project); writeFileSync(join(project, 'README.md'), '<script>unsafe()</script>');
  const children = [], starts = [];
  let activity = { state: 'unknown' }, activityReads = 0, releaseActivity;
  const server = createApp({ dataDir, workbenchOptions: {
    activityInterval: 0,
    activities: async () => { activityReads++; if (releaseActivity) await new Promise(resolve => { releaseActivity = resolve; }); return new Map([[id1, activity]]); },
    newSession: async () => id1,
    sessions: async () => ({ sessions: [], nextCursor: null }),
    launch: (file, args, options) => {
      starts.push({ file, args, options }); const e = new EventEmitter(); children.push(e);
      return { onData: cb => e.on('data', cb), onExit: cb => e.on('exit', cb), write: value => e.emit('data', `echo:${value}`), resize: () => {}, kill: () => setImmediate(() => e.emit('exit', { exitCode: 0 })) };
    },
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`, sockets = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await new Promise(resolve => server.close(resolve)); });
  let state = await (await fetch(`${url}/api/state`)).json();
  const command = async c => {
    const response = await fetch(`${url}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, command: c }) });
    const result = await response.json(); if (response.ok) state = result; return { response, result };
  };
  await command({ type: 'create-task', title: '研究', date: '2026-10-09' }); const taskId = state.tasks[0].id;
  await command({ type: 'create-step', taskId, title: '方向', status: 'done' }); const stepId = state.tasks[0].steps[0].id;
  await command({ type: 'bind-workspace', taskId, stepId, cwd: project, files: ['README.md'] });
  const before = structuredClone(state.tasks[0]);
  const { token } = await (await fetch(`${url}/api/workbench/bootstrap`)).json();
  const post = (action, value, extra = {}) => fetch(`${url}/api/workbench/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Precision-Token': token, ...extra }, body: JSON.stringify(value) });
  assert.equal((await post('start', { stepId, mode: 'new' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await post('start', { stepId, mode: 'new' }, { 'X-Precision-Token': 'bad' })).status, 403);
  let result = await (await post('start', { stepId, mode: 'new' })).json(); const terminal = result.terminal; state = result.state;
  assert.equal(starts.length, 1); assert.deepEqual(starts[0].args.slice(0, 2), ['resume', id1]); assert.equal(starts[0].options.cwd, project);
  assert.equal(state.tasks[0].completedAt, before.completedAt);
  result = await (await post('start', { stepId, mode: 'resume' })).json(); assert.equal(result.terminal.id, terminal.id); assert.equal(starts.length, 1);
  const attach = () => {
    const ws = new WebSocket(`${url.replace('http:', 'ws:')}/api/workbench/attach?stepId=${stepId}&id=${terminal.id}&token=${token}`, { origin: url });
    ws.snapshot = once(ws, 'message'); sockets.push(ws); return ws;
  };
  let ws = attach(); await once(ws, 'open'); let [message] = await ws.snapshot; assert.equal(JSON.parse(message).type, 'snapshot');
  const response = once(ws, 'message'); ws.send(JSON.stringify({ type: 'input', data: 'PERSISTENT' })); assert.match(JSON.parse((await response)[0]).data, /PERSISTENT/);
  ws.close(); await once(ws, 'close'); assert.equal(starts.length, 1);
  ws = attach(); await once(ws, 'open'); [message] = await ws.snapshot; assert.match(JSON.parse(message).data, /PERSISTENT/);
  assert.equal((await command({ type: 'delete-step', taskId, stepId })).response.status, 400);
  assert.equal((await command({ type: 'bind-workspace', taskId, stepId, cwd: project, sessionId: id2 })).response.status, 400);
  const preview = await (await fetch(`${url}/api/workbench/files?stepId=${stepId}&path=README.md`, { headers: { 'X-Precision-Token': token } })).json(); assert.equal(preview.kind, 'text'); assert.match(preview.text, /<script>/);
  const saved = await (await fetch(`${url}/api/state`)).json();
  const status = () => fetch(`${url}/api/workbench/status`, { headers: { 'X-Precision-Token': token } }).then(r => r.json());
  activity = { state: 'completed', turnId: 'finished-turn', completedAt: 123 };
  const notification = once(ws, 'message');
  assert.deepEqual((await status()).terminals[0].activity, activity);
  assert.deepEqual(JSON.parse((await notification)[0]).terminal.activity, activity);
  assert.equal(starts.length, 1);
  const inputAfterCompletion = once(ws, 'message'); ws.send(JSON.stringify({ type: 'input', data: 'STILL-WRITING' }));
  assert.match(JSON.parse((await inputAfterCompletion)[0]).data, /STILL-WRITING/);
  assert.deepEqual(await (await fetch(`${url}/api/state`)).json(), saved);
  // Two viewers share one pending read and cannot start parallel CLI helpers.
  releaseActivity = true;
  const beforeReads = activityReads, pendingStatus = status();
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => { if (typeof releaseActivity === 'function') { clearInterval(timer); clearTimeout(deadline); resolve(); } }, 5);
    const deadline = setTimeout(() => { clearInterval(timer); reject(new Error('activity read did not start')); }, 3000);
  });
  const secondStatus = status();
  await new Promise(resolve => setTimeout(resolve, 25));
  activity = { state: 'unknown', turnId: 'next-turn', completedAt: null };
  releaseActivity(); releaseActivity = null;
  const states = await Promise.all([pendingStatus, secondStatus]);
  assert.equal(activityReads - beforeReads, 1);
  for (const result of states) assert.equal(result.terminals[0].activity.state, 'unknown');
  assert.equal((await post('stop', { stepId, id: 'stale' })).status, 400);
  assert.equal((await post('stop', { stepId, id: terminal.id })).status, 200);
});
