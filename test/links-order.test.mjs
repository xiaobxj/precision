import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyState, findResult } from '../lib/domain.mjs';

function fixture() {
  let state = emptyState();
  const run = command => state = applyCommand(state, command);
  for (const title of ['任务甲', '任务乙', '任务丙']) run({ type: 'create-task', title, date: '2026-10-08' });
  const taskId = state.tasks[0].id;
  for (const title of ['方向甲', '方向乙']) run({ type: 'create-step', taskId, title, content: '完整正文', status: 'active' });
  const stepId = state.tasks[0].steps[0].id;
  for (const title of ['子进度甲', '子进度乙']) run({ type: 'create-substep', taskId, stepId, title, content: '原始记录', status: 'waiting' });
  run({ type: 'create-result', taskId, stepId, title: '来源结果', content: '原始结果' });
  run({ type: 'create-note', title: '已有结论', conclusion: '完整结论', content: '完整思考', bold: { title: [[0, 2]], conclusion: [[0, 2]], content: [] } });
  return state;
}

test('linking preserves original data, versions and deleted-source references; old clients keep links', () => {
  const original = fixture();
  const taskId = original.tasks[0].id, stepId = original.tasks[0].steps[0].id;
  const resultId = original.tasks[0].steps[0].results[0].id, noteId = original.notes[0].id;
  let state = applyCommand(original, { type: 'link-note-result', noteId, resultId });
  assert.deepEqual(state.tasks, original.tasks);
  assert.deepEqual(state.activities, original.activities);
  for (const key of ['title', 'content', 'conclusion', 'bold', 'createdAt']) assert.deepEqual(state.notes[0][key], original.notes[0][key]);
  assert.equal(state.notes[0].sources[0].resultId, resultId);
  assert.equal(original.notes[0].sources, undefined);
  state = applyCommand(state, { type: 'link-note-result', noteId, resultId });
  assert.equal(state.notes[0].sources.length, 1);
  assert.equal(state.notes[0].versions.length, 1);
  state = applyCommand(state, { type: 'delete-result', taskId, stepId, resultId });
  assert.equal(findResult(state, resultId), undefined);
  state = applyCommand(state, { type: 'edit-note', noteId, title: '修改标题', content: '修改思考', conclusion: '完整结论' });
  assert.equal(state.notes[0].sources[0].resultTitle, '来源结果');
  state = applyCommand(state, { type: 'edit-note', noteId, title: '修改标题', content: '修改思考', sources: [] });
  assert.equal(state.notes[0].sources.length, 0);
  assert.equal(state.notes[0].versions[0].sources[0].resultId, resultId);
  assert.throws(() => applyCommand(state, { type: 'link-note-result', noteId, resultId }), /已不存在/);
});
