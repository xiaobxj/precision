import test from 'node:test';
import assert from 'node:assert/strict';
import { readSessionActivities } from '../lib/codex.mjs';

test('completion monitoring requests only latest turn metadata and never treats unfinished history as complete', async () => {
  const turns = [
    { id: 't1', status: 'completed', completedAt: 123 },
    { id: 't2', status: 'interrupted', completedAt: null }, // External CLI can still be working.
    { id: 't3', status: 'completed', completedAt: null },
    { id: 't4', status: 'inProgress', completedAt: null },
    { id: 't5', status: 'interrupted', completedAt: 125 },
    { id: 't6', status: 'failed', completedAt: 126 },
    null,
  ];
  const ids = turns.map((_, i) => String(i)), calls = [];
  const result = await readSessionActivities([...ids, ids[0], 'missing'], async callback => callback(async (method, params) => {
    calls.push({ method, params });
    if (params.threadId === 'missing') throw new Error('No saved session');
    const turn = turns[Number(params.threadId)];
    return { data: turn ? [turn] : [] };
  }));
  assert.equal(calls.length, ids.length + 1);
  assert.deepEqual([...result.values()].map(v => v.state), ['completed', 'unknown', 'unknown', 'working', 'interrupted', 'failed', 'idle', 'unknown']);
  assert.deepEqual(result.get('0'), { state: 'completed', turnId: 't1', completedAt: 123 });
  for (const call of calls) assert.deepEqual(call, {
    method: 'thread/turns/list', params: { threadId: call.params.threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' },
  });
});

test('an unavailable status reader returns unknown without launching or changing a conversation', async () => {
  const result = await readSessionActivities(['one', 'two'], async () => { throw new Error('CLI unavailable'); });
  assert.deepEqual([...result.values()], [{ state: 'unknown' }, { state: 'unknown' }]);
  const empty = await readSessionActivities([], () => { throw new Error('must not start a helper'); });
  assert.equal(empty.size, 0);
});
