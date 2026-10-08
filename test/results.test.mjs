import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { applyCommand, emptyState, progressItems, stepStatus, taskStatus, tasksOnDay } from '../lib/domain.mjs';

function fixture(status = 'done', withChildren = true) {
  let state = emptyState();
  let serial = 0;
  let hour = 0;
  const run = command => { state = applyCommand(state, command, `2026-09-30T${String(hour++).padStart(2, '0')}:00:00+08:00`, () => `result-${++serial}`); return state; };
  run({ type: 'create-task', title: '大任务', date: '2026-09-29' });
  const taskId = state.tasks[0].id;
  run({ type: 'create-step', taskId, title: '原方向', content: '原内容\n保留', status, images: [{ id: 'a'.repeat(64), name: '原截图.png' }] });
  const stepId = state.tasks[0].steps[0].id;
  if (withChildren) run({ type: 'create-substep', taskId, stepId, title: '原子进度', status });
  run({ type: 'create-step', taskId, title: '并行方向', status: 'done' });
  run({ type: 'create-note', title: '长期思考', content: '独立记录', conclusion: '保留结论' });
  state.tasks[0].steps[0].customField = 'keep';
  return { run, taskId, stepId, get state() { return state; }, get step() { return state.tasks[0].steps[0]; } };
}

test('reference results never count as work or change completion, carryover or followup status', () => {
  for (const status of ['todo', 'active', 'waiting', 'done']) {
    for (const withChildren of [false, true]) {
      const f = fixture(status, withChildren);
      const previous = structuredClone(f.state);
      const original = previous.tasks[0];
      const command = { taskId: f.taskId, stepId: f.stepId };
      f.run({ ...command, type: 'create-result', title: '阶段结果', content: '不是待办事项', status: 'waiting' });
      const result = f.step.results[0];
      assert.equal(Object.hasOwn(result, 'status'), false);
      assert.equal(Object.hasOwn(result, 'completedAt'), false);
      assert.equal(f.step.status, status);
      assert.equal(f.step.completedAt, original.steps[0].completedAt);
      assert.equal(f.state.tasks[0].completedAt, original.completedAt);
      assert.deepEqual(progressItems(f.state.tasks[0]), progressItems(original).map(item => item.id === f.stepId ? f.step : item));
      assert.equal(progressItems(f.state.tasks[0]).length, progressItems(original).length);
      assert.equal(taskStatus(f.state.tasks[0]), taskStatus(original));
      assert.equal(stepStatus(f.step), stepStatus(original.steps[0]));
      assert.deepEqual(tasksOnDay(f.state.tasks, '2026-10-01').map(t => t.id), tasksOnDay(previous.tasks, '2026-10-01').map(t => t.id));
      for (const key of ['id', 'title', 'content', 'images', 'createdAt', 'customField', 'substeps']) assert.deepEqual(f.step[key], original.steps[0][key]);
      assert.deepEqual(f.state.tasks[0].steps[1], original.steps[1]);
      assert.deepEqual(f.state.notes, previous.notes);
      assert.deepEqual(f.state.activities.slice(1), previous.activities);
      f.run({ ...command, type: 'edit-result', resultId: result.id, title: '修订结果', content: '修订内容' });
      f.run({ ...command, type: 'delete-result', resultId: result.id });
      assert.equal(f.state.tasks[0].completedAt, original.completedAt);
      assert.equal(f.step.status, status);
      assert.deepEqual(f.step.substeps, original.steps[0].substeps);
      assert.deepEqual(f.step.results, []);
    }
  }
});

test('results remain ordered and keep images through edits and task changes; invalid IDs never touch other records', () => {
  const f = fixture();
  const command = { taskId: f.taskId, stepId: f.stepId };
  const original = structuredClone(f.state);
  f.run({ ...command, type: 'create-result', title: '第一份结果', content: '第一行\n第二行', images: [{ id: 'b'.repeat(64), name: '结果.png' }] });
  const first = structuredClone(f.step.results[0]);
  f.run({ ...command, type: 'create-result', title: '第二份结果', content: '后续发现' });
  f.run({ ...command, type: 'edit-result', resultId: first.id, title: '第一份结果修订', content: '修订文字' });
  assert.deepEqual(f.step.results.map(result => result.title), ['第一份结果修订', '第二份结果']);
  assert.equal(f.step.results[0].createdAt, first.createdAt);
  assert.notEqual(f.step.results[0].updatedAt, first.updatedAt);
  assert.deepEqual(f.step.results[0].images, first.images);
  const before = structuredClone(f.state);
  const otherId = f.state.tasks[0].steps[1].id;
  assert.throws(() => f.run({ ...command, type: 'delete-result', stepId: otherId, resultId: first.id }), /结果记录已不存在/);
  assert.throws(() => f.run({ ...command, type: 'edit-result', resultId: 'missing', title: '覆盖' }), /结果记录已不存在/);
  assert.throws(() => f.run({ ...command, type: 'create-result', title: '' }), /不能为空/);
  assert.throws(() => f.run({ ...command, type: 'create-result', title: '太长', content: 'x'.repeat(50001) }), /不能超过/);
  assert.throws(() => f.run({ ...command, type: 'create-result', title: '坏图', images: [{ id: 'bad' }] }), /图片引用/);
  assert.deepEqual(f.state, before);
  f.run({ ...command, type: 'edit-step', title: '方向改名', content: '新说明' });
  assert.deepEqual(f.step.results, before.tasks[0].steps[0].results);
  const child = f.step.substeps[0];
  f.run({ ...command, type: 'delete-substep', substepId: child.id });
  assert.deepEqual(f.step.results, before.tasks[0].steps[0].results);
  assert.equal(f.step.status, 'active');
  f.run({ ...command, type: 'delete-step' });
  assert.deepEqual(f.state.tasks[0].steps, [original.tasks[0].steps[1]]);
  assert.deepEqual(f.state.notes, original.notes);
});

test('bold is additive metadata, survives edits and rejects invalid ranges without touching saved text', () => {
  const f = fixture();
  const original = structuredClone(f.state);
  const base = { taskId: f.taskId, stepId: f.stepId };
  f.run({ ...base, type: 'create-result', title: '  标题加粗  ', content: '\n正文\n加粗尾部\n', bold: { title: [[4, 6]], content: [[4, 8]] } });
  const result = f.step.results[0];
  assert.equal(result.title, '标题加粗');
  assert.equal(result.content, '正文\n加粗尾部');
  assert.deepEqual(result.bold, { title: [[2, 4]], content: [[3, 7]] });
  assert.deepEqual(f.step.substeps, original.tasks[0].steps[0].substeps);
  assert.deepEqual(f.state.notes, original.notes);
  const edit = { ...base, type: 'edit-result', resultId: result.id, title: result.title, content: result.content };
  f.run(edit);
  assert.deepEqual(f.step.results[0].bold, result.bold);
  const saved = structuredClone(f.state);
  for (const title of [[[0, 99]], [[-1, 1]], [[0, 2], [1, 3]], [[0.5, 1]], ['<script>'], [[2, 2]]]) {
    assert.throws(() => f.run({ ...edit, bold: { title } }), /加粗格式/);
    assert.deepEqual(f.state, saved);
  }
  f.run({ ...edit, bold: { title: [], content: [] } });
  assert.deepEqual(f.step.results[0].bold, { title: [], content: [] });
  assert.equal(f.step.results[0].content, result.content);
});

test('recording a result does not re-complete a task that was explicitly reopened', () => {
  const f = fixture();
  f.run({ type: 'reopen-task', taskId: f.taskId });
  f.run({ type: 'create-result', taskId: f.taskId, stepId: f.stepId, title: '补充观察' });
  assert.equal(f.state.tasks[0].completedAt, null);
  assert.equal(f.step.status, 'done');
});

test('results and image bytes survive restart and export; stale writes and missing attachments are rejected', async t => {
  const dataDir = mkdtempSync(join(tmpdir(), 'procision-results-'));
  let server = createApp({ dataDir });
  const start = async () => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return `http://127.0.0.1:${server.address().port}`; };
  let url = await start();
  t.after(() => new Promise(resolve => server.close(resolve)));
  let state = emptyState();
  const send = (command, revision = state.revision) => fetch(`${url}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, command }) });
  const run = async command => { const response = await send(command); assert.equal(response.status, 200); state = await response.json(); };
  await run({ type: 'create-task', title: '已完成任务', date: '2026-09-30' });
  const taskId = state.tasks[0].id;
  await run({ type: 'create-step', taskId, title: '已完成方向', status: 'done' });
  const stepId = state.tasks[0].steps[0].id;
  const completedAt = state.tasks[0].completedAt;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=', 'base64');
  const upload = await fetch(`${url}/api/images`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
  assert.equal(upload.status, 201);
  const image = await upload.json();
  await run({ type: 'create-result', taskId, stepId, title: '验证结果', content: '文字\n和截图', bold: { title: [[0, 2]], content: [[3, 6]] }, images: [{ id: image.id, name: '结果.png' }] });
  const resultId = state.tasks[0].steps[0].results[0].id;
  const before = structuredClone(state);
  assert.equal(state.tasks[0].completedAt, completedAt);
  assert.equal((await send({ type: 'edit-result', taskId, stepId, resultId, title: '旧窗口覆盖' }, 2)).status, 409);
  assert.equal((await send({ type: 'create-result', taskId, stepId, title: '坏附件', images: [{ id: 'a'.repeat(64) }] })).status, 400);
  await new Promise(resolve => server.close(resolve));
  server = createApp({ dataDir }); url = await start();
  assert.deepEqual(await (await fetch(`${url}/api/state`)).json(), before);
  const exported = await (await fetch(`${url}/api/export`)).json();
  assert.deepEqual(exported.tasks, before.tasks);
  assert.equal(exported.imageAssets[0].base64, bytes.toString('base64'));
  assert.deepEqual(Buffer.from(await (await fetch(`${url}/api/images/${image.id}`)).arrayBuffer()), bytes);
});
