import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function codexExecutable() {
  if (process.env.PRECISION_CODEX_PATH) return process.env.PRECISION_CODEX_PATH;
  const bundled = join(process.env.LOCALAPPDATA || '', 'Programs/OpenAI/Codex/bin/codex.exe');
  return existsSync(bundled) ? bundled : 'codex';
}

export function codexEnv() {
  const env = { ...process.env };
  // A terminal opened here is an independent user session, not a child agent of the builder.
  delete env.CODEX_THREAD_ID;
  delete env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE;
  return env;
}

// Use the installed CLI's protocol rather than relying on its private SQLite schema.
// This bridge never starts an inference turn and never sends a user prompt.
export async function withCodex(callback, { cwd = process.cwd(), env = codexEnv(), executable = codexExecutable() } = {}) {
  const child = spawn(executable, ['app-server', '--listen', 'stdio://'], { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let sequence = 0, buffer = '';
  const pending = new Map();
  const fail = error => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(error); } pending.clear(); };
  child.on('error', error => fail(new Error(`无法启动 Codex：${error.message}`)));
  child.on('exit', () => fail(new Error('Codex 会话服务已退出，请重试')));
  child.stderr.on('data', () => {});
  child.stdin.on('error', error => fail(error));
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const entry = pending.get(message.id);
      if (!entry) continue;
      clearTimeout(entry.timer); pending.delete(message.id);
      message.error ? entry.reject(new Error(message.error.message || 'Codex 请求失败')) : entry.resolve(message.result);
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('Codex 会话服务响应超时')); }, 25000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'precision_workbench', title: 'Precision 工作台', version: '1.1.0' } });
    child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
    return await callback(rpc);
  } finally {
    child.stdin.end();
    if (child.exitCode === null && !child.killed) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 2000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.once('error', () => { clearTimeout(timer); resolve(); });
    });
    fail(new Error('会话查询已结束'));
  }
}

export async function listSessions(cursor) {
  return withCodex(async rpc => {
    const result = await rpc('thread/list', { limit: 100, ...(cursor ? { cursor } : {}) });
    return { sessions: result.data.map(t => ({ id: t.id, title: t.name || t.preview || t.id, cwd: t.cwd, updatedAt: t.updatedAt })), nextCursor: result.nextCursor || null };
  });
}

// Read only the newest persisted turn. Do not resume/subscribe to a thread:
// that would compete with the user's CLI, whose runtime lives in another process.
export async function readSessionActivities(sessionIds, connect = withCodex) {
  const ids = [...new Set(sessionIds)];
  if (!ids.length) return new Map();
  const unknown = () => ({ state: 'unknown' });
  try {
    return await connect(async rpc => {
      const results = await Promise.allSettled(ids.map(async threadId => {
        const { data } = await rpc('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
        const turn = data[0];
        if (!turn) return { state: 'idle' };
        // Stored, still-running turns can hydrate as "interrupted" with no end
        // time in a separate App Server. Neither that nor silence means success.
        const ended = Number.isFinite(turn.completedAt);
        const state = turn.status === 'completed' && ended ? 'completed'
          : turn.status === 'inProgress' ? 'working'
          : turn.status === 'failed' ? 'failed'
          : turn.status === 'interrupted' && ended ? 'interrupted' : 'unknown';
        return { state, turnId: turn.id, completedAt: ended ? turn.completedAt : null };
      }));
      return new Map(ids.map((id, i) => [id, results[i].status === 'fulfilled' ? results[i].value : unknown()]));
    });
  } catch {
    // Missing/older CLI or a failed read must clear a stale green badge.
    return new Map(ids.map(id => [id, unknown()]));
  }
}

export async function createSession(cwd, title) {
  return withCodex(async rpc => {
    const { thread } = await rpc('thread/start', { cwd, persistExtendedHistory: true });
    // Naming flushes the empty session to disk, so the CLI can resume it without
    // sending a synthetic prompt or spending a model turn just to create a chat.
    await rpc('thread/name/set', { threadId: thread.id, name: title.slice(0, 160) });
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await rpc('thread/resume', { threadId: thread.id }); return thread.id; }
      catch (error) {
        if (!/no rollout found/i.test(error.message) || attempt === 29) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }, { cwd });
}
