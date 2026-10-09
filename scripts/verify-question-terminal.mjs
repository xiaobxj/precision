import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { createApp } from '../server.mjs';
import { createSession, codexExecutable, codexEnv, withCodex } from '../lib/codex.mjs';

// Exercise the installed CLI's real request_user_input UI through the browser
// PTY. Only the question RPC is injected: no model turns or production threads.
const directory = resolve('.verification/question-terminal');
const multiline = process.argv.includes('--multiline');
const artifact = multiline ? 'multiline-terminal' : 'question-terminal';
mkdirSync(directory, { recursive: true });
writeFileSync(resolve(directory, 'README.md'), '# Isolated question UI verification\nNo model turns are sent.\n');
const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
await once(proxy, 'listening');
const children = new Set(), responses = [], methods = [], errors = [], submissions = [];
let cli, sessionId, browser, page, server, questionCounter = 0;
proxy.on('connection', ws => {
  cli = ws;
  const process = spawn(codexExecutable(), ['app-server', '--listen', 'stdio://'], { cwd: directory, env: codexEnv(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  children.add(process); process.stderr.on('data', () => {});
  process.on('error', error => errors.push(error.message));
  process.stdin.on('error', error => errors.push(error.message));
  let buffer = '';
  process.stdout.on('data', data => {
    buffer += data;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { JSON.parse(line); if (ws.readyState === 1) ws.send(line); } catch {}
    }
  });
  ws.on('message', raw => {
    const message = JSON.parse(raw);
    if (String(message.id).startsWith('precision-ui-question-')) {
      responses.push(message); console.log('ANSWER', JSON.stringify(message.result));
      ws.send(JSON.stringify({ method: 'serverRequest/resolved', params: { threadId: sessionId, requestId: message.id } }));
      return;
    }
    if (message.method) methods.push(message.method);
    if (multiline && message.method === 'turn/start') {
      // Capture the composed prompt locally; never forward a model request.
      submissions.push(message.params);
      ws.send(JSON.stringify({ id: message.id, error: { code: -32000, message: 'Input captured locally by the verification fixture; no model turn sent' } }));
      return;
    }
    if (['turn/start', 'turn/steer', 'thread/shellCommand', 'process/spawn', 'command/exec'].includes(message.method)) {
      errors.push(`Unexpected action blocked: ${message.method}`);
      ws.send(JSON.stringify({ id: message.id, error: { code: -32000, message: 'No model turns or shell commands in this fixture' } })); return;
    }
    process.stdin.write(JSON.stringify(message) + '\n');
  });
  ws.on('close', () => { process.stdin.end(); process.kill(); children.delete(process); });
});
async function screen() {
  await page.screenshot({ path: resolve(`.verification/${artifact}-live.png`), animations: 'disabled' });
  console.log('SCREEN', (await page.locator('.wb-terminal .xterm-rows').innerText()).slice(-6500));
}
try {
  sessionId = await createSession(directory, multiline ? 'Precision multiline input UI verification' : 'Precision question input UI verification');
  server = createApp({ dataDir: resolve(directory, `data-${Date.now()}`), workbenchOptions: {
    launch: (file, args, options) => pty.spawn(file, ['--remote', `ws://127.0.0.1:${proxy.address().port}`, ...args.filter(arg => arg !== '--no-daemon')], options),
  } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  let state = await (await fetch(`${base}/api/state`)).json();
  const run = async command => {
    const result = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, command }) });
    if (!result.ok) throw new Error(await result.text()); state = await result.json();
  };
  await run({ type: 'create-task', title: '终端提问验证', date: '2026-10-09' }); const taskId = state.tasks[0].id;
  await run({ type: 'create-step', taskId, title: multiline ? '换行与文字粘贴验证' : '独立测试：回答 Codex 提问', content: multiline ? '第一行：左侧研究记录\n第二行：左侧验证条件' : '', status: 'active' }); const stepId = state.tasks[0].steps[0].id;
  await run({ type: 'bind-workspace', taskId, stepId, cwd: directory, sessionId });
  browser = await chromium.launch({ channel: 'msedge' }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('.wb-tools [data-wb="resume"]').click();
  await page.locator('.wb-terminal .xterm-rows').waitFor(); await page.waitForTimeout(4500);
  await screen(); console.log('READY', JSON.stringify({ methods, errors }));
  if (multiline) {
    await expect.poll(() => methods.includes('thread/resume'), { timeout: 60000 }).toBe(true);
    await expect(page.locator('.xterm-rows')).not.toContainText('Resuming session', { timeout: 60000 });
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    const lines = ['第一行：左侧研究记录', '第二行：左侧验证条件', '', '第三行：保留约束'];
    await page.locator('.step-content').evaluate(element => {
      element.tabIndex = -1; element.focus();
      const range = document.createRange(); range.selectNodeContents(element);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press('Control+c');
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(lines.slice(0, 2).join('\n'));
    const input = page.locator('.wb-terminal textarea'); await input.focus();
    await input.press('Control+v'); await page.waitForTimeout(500);
    expect(submissions).toHaveLength(0);
    await expect(page.locator('.xterm-rows')).not.toContainText('Failed to paste image');
    for (const text of lines.slice(2)) {
      await input.press('Shift+Enter');
      if (text) await page.keyboard.insertText(text);
      await page.waitForTimeout(350);
      expect(submissions).toHaveLength(0);
    }
    const visible = await page.locator('.xterm-rows > div').allTextContents();
    await screen();
    const positions = lines.filter(Boolean).map(line => visible.findIndex(row => row.includes(line)));
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[1]).toBe(positions[0] + 1);
    expect(positions[2]).toBe(positions[1] + 2);
    await input.press('Enter');
    await expect.poll(() => submissions.length, { timeout: 10000 }).toBe(1);
    const submittedText = submissions[0].input.filter(item => item.type === 'text').map(item => item.text).join('');
    expect(submittedText).toBe(lines.join('\n'));
    expect(errors).toEqual([]);
    writeFileSync(resolve(`.verification/${artifact}-report.json`), JSON.stringify({ passed: true, copiedFromLeft: true, submittedText, positions, modelRequestsForwarded: 0, methods, errors }, null, 2));
    console.log('MULTILINE_PASSED', JSON.stringify({ submittedText, modelRequestsForwarded: 0 }));
  } else {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    try {
      const command = JSON.parse(line);
      if (command.action === 'close') { lines.close(); break; }
      if (command.action === 'ask') {
        cli.send(JSON.stringify({ id: `precision-ui-question-${++questionCounter}`, method: 'item/tool/requestUserInput', params: {
          threadId: sessionId, turnId: 'ui-verification-turn', itemId: `ui-question-${questionCounter}`, isBlocking: command.blocking !== false, autoResolutionMs: null,
          questions: command.questions || [
            { id: 'research', header: '研究方向', question: '下一步先研究哪个方向？', isOther: true, isSecret: false, options: [{ label: '入场时机', description: '研究进入时点。' }, { label: '预测误差', description: '先定位误差来源。' }] },
            { id: 'notes', header: '补充说明', question: '请输入这轮研究要保留的约束。', isOther: true, isSecret: false, options: null },
          ],
        } }));
      }
      if (command.action === 'key') { await page.locator('.wb-terminal textarea').focus(); await page.keyboard.press(command.key); }
      if (command.action === 'type') { await page.locator('.wb-terminal textarea').focus(); await page.keyboard.insertText(command.text); }
      if (command.action === 'resize') await page.setViewportSize({ width: command.width, height: command.height });
      if (command.action === 'bottom') await page.locator('[data-wb="bottom"]').click();
      await page.waitForTimeout(350); await screen();
      writeFileSync(resolve('.verification/question-terminal-report.json'), JSON.stringify({ responses, methods, errors }, null, 2));
    } catch (error) { console.log('COMMAND_ERROR', error.message); }
  }
  }
} catch (error) {
  console.error('VERIFICATION_FAILED', error.message); process.exitCode = 1;
  writeFileSync(resolve(`.verification/${artifact}-report.json`), JSON.stringify({ passed: false, submissions, methods, errors, failure: error.message }, null, 2));
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  for (const ws of proxy.clients) ws.terminate(); for (const child of children) child.kill();
  await new Promise(resolve => proxy.close(resolve));
  if (sessionId) await withCodex(rpc => rpc('thread/archive', { threadId: sessionId })).catch(error => console.log('Archive failed:', error.message));
}
// ConPTY may retain its host-side async handles after the fixture has closed.
process.exit(process.exitCode || 0);
