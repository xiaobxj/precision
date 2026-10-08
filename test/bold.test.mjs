import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, emptyState } from '../lib/domain.mjs';

test('all record kinds accept bold, preserve it on status changes and protect text from invalid formatting', () => {
  let state = emptyState();
  const run = command => { state = applyCommand(state, command); };
  run({ type: 'create-task', title: '标题', description: '说明', date: '2026-10-08', bold: { title: [[0, 1]], description: [[0, 2]] } });
  const taskId = state.tasks[0].id;
  run({ type: 'create-step', taskId, title: '方向', content: '正文', bold: { title: [[0, 2]], content: [[0, 1]] } });
  const stepId = state.tasks[0].steps[0].id;
  run({ type: 'create-substep', taskId, stepId, title: '子进度', content: '原文', bold: { title: [[1, 3]], content: [[0, 2]] } });
  const substepId = state.tasks[0].steps[0].substeps[0].id;
  run({ type: 'create-note', title: '思考', conclusion: '结论', content: '过程', bold: { title: [[0, 1]], conclusion: [[0, 2]], content: [[1, 2]] } });
  const noteId = state.notes[0].id;
  const original = structuredClone(state);
  run({ type: 'set-substep-status', taskId, stepId, substepId, status: 'done' });
  assert.deepEqual(state.tasks[0].bold, original.tasks[0].bold);
  assert.deepEqual(state.tasks[0].steps[0].bold, original.tasks[0].steps[0].bold);
  assert.deepEqual(state.tasks[0].steps[0].substeps[0].bold, original.tasks[0].steps[0].substeps[0].bold);
  const saved = structuredClone(state);
  for (const command of [
    { type: 'edit-task', taskId, title: '标题', description: '说明' },
    { type: 'edit-step', taskId, stepId, title: '方向', content: '正文' },
    { type: 'edit-substep', taskId, stepId, substepId, title: '子进度', content: '原文', status: 'done' },
    { type: 'edit-note', noteId, title: '思考', conclusion: '结论', content: '过程' },
  ]) {
    assert.throws(() => run({ ...command, bold: { title: [[-1, 9]] } }), /加粗格式/);
    assert.deepEqual(state, saved);
  }
  // Commands from an older browser keep unchanged fields' formatting.
  run({ type: 'edit-task', taskId, title: '标题', description: '修改说明' });
  assert.deepEqual(state.tasks[0].bold, { title: [[0, 1]], description: [] });
  run({ type: 'edit-note', noteId, title: '思考', conclusion: '结论', content: '过程', bold: { title: [], conclusion: [], content: [] } });
  assert.deepEqual(state.notes[0].versions[0].bold, original.notes[0].bold);
  run({ type: 'archive-note', noteId });
  run({ type: 'restore-note', noteId });
  assert.deepEqual(state.notes[0].versions[0].bold, original.notes[0].bold);
});
