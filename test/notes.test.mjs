import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyState } from '../lib/domain.mjs';

const now = '2026-09-30T12:00:00+08:00';
const legacy = () => {
  let state = applyCommand(emptyState(), { type: 'create-task', title: '已有任务', date: '2026-09-29' }, now);
  state = applyCommand(state, { type: 'create-step', taskId: state.tasks[0].id, title: '已有进度', content: '原始长文本\n不能丢失', status: 'waiting' }, now);
  state.extra = { preserved: true };
  assert.equal(Object.hasOwn(state, 'notes'), false);
  return state;
};

test('notes are additive: legacy tasks, steps, activity and unknown fields remain byte-identical', () => {
  const original = legacy();
  const before = JSON.stringify(original);
  const state = applyCommand(original, { type: 'create-note', title: '中心漂移', conclusion: '考虑提前更新 mu', content: '第一行\n第二行', status: 'thought' }, now);
  const { notes, revision, ...rest } = state;
  const { revision: oldRevision, ...oldRest } = original;
  assert.equal(JSON.stringify(rest), JSON.stringify(oldRest));
  assert.equal(JSON.stringify(original), before);
  assert.equal(revision, oldRevision + 1);
  assert.equal(notes[0].content, '第一行\n第二行');
  const taskUpdate = applyCommand(state, { type: 'set-step-status', taskId: state.tasks[0].id, stepId: state.tasks[0].steps[0].id, status: 'done' }, now);
  assert.deepEqual(taskUpdate.notes, notes);
});

test('edits retain full previous versions and archive can be reversed', () => {
  let state = applyCommand(legacy(), { type: 'create-note', title: '原始标题', conclusion: '原始结论', content: '长文\n'.repeat(5000), status: 'thought' }, now);
  const original = structuredClone(state.notes[0]);
  const noteId = original.id;
  state = applyCommand(state, { type: 'edit-note', noteId, title: '新标题', conclusion: '新结论', content: '新正文', status: 'conclusion' }, '2026-10-01T01:00:00+08:00');
  assert.deepEqual(state.notes[0].versions[0], { title: original.title, conclusion: original.conclusion, content: original.content, status: original.status, at: original.updatedAt });
  state = applyCommand(state, { type: 'archive-note', noteId }, now);
  assert.equal(state.notes[0].archivedAt, now);
  assert.throws(() => applyCommand(state, { type: 'edit-note', noteId, title: 'x', content: 'x' }, now), /先恢复/);
  state = applyCommand(state, { type: 'restore-note', noteId }, now);
  assert.equal(state.notes[0].archivedAt, null);
  assert.equal(state.notes[0].content, '新正文');
  assert.equal(state.notes[0].versions[0].content, original.content);
});

test('invalid and oversized notes are rejected without touching existing records', () => {
  const state = legacy();
  const before = JSON.stringify(state);
  for (const fields of [
    { title: ' ' }, { title: 'x' }, { title: 'x', content: 'x', status: 'done' },
    { title: 'x', content: 'x', status: 'toString' }, { title: 'x', content: 'x'.repeat(200001) },
  ]) assert.throws(() => applyCommand(state, { type: 'create-note', ...fields }, now));
  assert.equal(JSON.stringify(state), before);
});
