import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyState, tasksOnDay, taskStatus, validDay, localDay } from '../lib/domain.mjs';

function fixture() {
  let state = emptyState();
  let serial = 0;
  const run = (command, at = '2026-09-29T09:00:00+08:00') => { state = applyCommand(state, command, at, () => `id-${++serial}`); return state; };
  run({ type: 'create-task', title: '调试 AI 工作流', date: '2026-09-29' });
  return { run, get state() { return state; }, taskId: state.tasks[0].id };
}

test('unfinished tasks carry forward without duplicates, completed tasks stop after completion day', () => {
  const f = fixture();
  assert.equal(tasksOnDay(f.state.tasks, '2026-09-28').length, 0);
  assert.equal(tasksOnDay(f.state.tasks, '2026-09-30').length, 1);
  assert.equal(tasksOnDay(f.state.tasks, '2026-10-01').length, 1);
  f.run({ type: 'complete-task', taskId: f.taskId }, '2026-09-30T23:30:00+08:00');
  assert.equal(tasksOnDay(f.state.tasks, '2026-09-29').length, 1);
  assert.equal(tasksOnDay(f.state.tasks, '2026-09-30').length, 1);
  assert.equal(tasksOnDay(f.state.tasks, '2026-10-01').length, 0);
  f.run({ type: 'reopen-task', taskId: f.taskId });
  assert.equal(tasksOnDay(f.state.tasks, '2026-10-01').length, 1);
});

test('Shanghai day boundaries and leap dates are correct', () => {
  assert.equal(localDay(new Date('2026-09-30T16:00:00Z')), '2026-10-01');
  assert.equal(validDay('2026-02-29'), false);
  assert.equal(validDay('2028-02-29'), true);
  assert.equal(validDay('2026-13-01'), false);
  assert.equal(validDay('2026-9-3'), false);
});

test('completion is derived from every step; undo and adding work reopen the task', () => {
  const f = fixture();
  f.run({ type: 'create-step', taskId: f.taskId, title: '第一步', status: 'done' });
  assert.equal(taskStatus(f.state.tasks[0]), 'done');
  f.run({ type: 'create-step', taskId: f.taskId, title: '第二步', status: 'waiting' });
  assert.equal(taskStatus(f.state.tasks[0]), 'waiting');
  assert.throws(() => f.run({ type: 'complete-task', taskId: f.taskId }), /所有步骤/);
  const stepId = f.state.tasks[0].steps[1].id;
  f.run({ type: 'set-step-status', taskId: f.taskId, stepId, status: 'done' });
  assert.equal(taskStatus(f.state.tasks[0]), 'done');
  f.run({ type: 'set-step-status', taskId: f.taskId, stepId, status: 'active' });
  assert.equal(taskStatus(f.state.tasks[0]), 'active');
  assert.equal(f.state.tasks[0].completedAt, null);
});

test('step reordering preserves IDs, content, and statuses', () => {
  const f = fixture();
  f.run({ type: 'create-step', taskId: f.taskId, title: 'A', content: '第一行\n第二行', status: 'done' });
  f.run({ type: 'create-step', taskId: f.taskId, title: 'B', status: 'active' });
  const original = structuredClone(f.state.tasks[0].steps);
  f.run({ type: 'move-step', taskId: f.taskId, stepId: original[1].id, direction: -1 });
  assert.deepEqual(f.state.tasks[0].steps, [original[1], original[0]]);
  assert.throws(() => f.run({ type: 'move-step', taskId: f.taskId, stepId: original[1].id, direction: -1 }), /边界/);
});

test('invalid writes never mutate the input state', () => {
  const f = fixture();
  const before = structuredClone(f.state);
  assert.throws(() => applyCommand(f.state, { type: 'edit-task', taskId: f.taskId, title: ' ' }), /不能为空/);
  assert.throws(() => applyCommand(f.state, { type: 'create-task', title: 'x', date: '2026-02-30' }), /日期/);
  assert.throws(() => applyCommand(f.state, { type: 'create-step', taskId: f.taskId, title: 'x', status: 'garbage' }), /状态/);
  assert.deepEqual(f.state, before);
});

test('deleting the last step reopens instead of leaving a false completion', () => {
  const f = fixture();
  f.run({ type: 'create-step', taskId: f.taskId, title: 'A', status: 'done' });
  const stepId = f.state.tasks[0].steps[0].id;
  f.run({ type: 'delete-step', taskId: f.taskId, stepId });
  assert.equal(f.state.tasks[0].completedAt, null);
  assert.equal(f.state.tasks[0].steps.length, 0);
});

test('a task completed before its planned day is still visible on that day', () => {
  const f = fixture();
  f.run({ type: 'create-task', title: '提前完成', date: '2026-10-02' });
  const taskId = f.state.tasks[1].id;
  f.run({ type: 'complete-task', taskId });
  assert.ok(tasksOnDay(f.state.tasks, '2026-10-02').some(task => task.id === taskId));
});
