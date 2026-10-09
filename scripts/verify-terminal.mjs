import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createApp } from '../server.mjs';
import { once } from 'node:events';
import { withCodex } from '../lib/codex.mjs';

const scratch = resolve('.verification/terminal');
mkdirSync(scratch, { recursive: true });
writeFileSync(resolve(scratch, 'README.md'), '# 终端验收\n此目录仅用于浏览器终端验证，不发送模型请求。\n');
const server = createApp({ dataDir: resolve('.verification/terminal-data') });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge' });
let sessionId;
try {
  let state = await (await fetch(`${base}/api/state`)).json();
  const run = async command => {
    const r = await fetch(`${base}/api/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.revision, command }) });
    if (!r.ok) throw new Error(await r.text()); state = await r.json();
  };
  await run({ type: 'create-task', title: 'Precision 终端验收', date: '2026-10-09' }); const taskId = state.tasks.at(-1).id;
  await run({ type: 'create-step', taskId, title: '浏览器终端验证（无模型请求）' }); const stepId = state.tasks.at(-1).steps[0].id;
  await run({ type: 'bind-workspace', taskId, stepId, cwd: scratch, files: ['README.md'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1040 } });
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base);
  await page.locator(`[data-direction="${stepId}"]`).click();
  await page.locator('.wb-tools [data-wb="new"]').click();
  await page.locator('.wb-terminal .xterm').waitFor({ timeout: 90000 });
  const boot = await (await fetch(`${base}/api/workbench/bootstrap`)).json();
  sessionId = boot.terminals.find(t => t.stepId === stepId).sessionId;
  console.log('Terminal started, session bound:', Boolean(sessionId));
  await page.waitForTimeout(4500);
  await page.screenshot({ path: resolve('.verification/terminal-live.png'), animations: 'disabled' });
  let screen = await page.locator('.wb-terminal .xterm-rows').innerText();
  console.log('Visible terminal:', screen.slice(-6000));
  if (screen.includes('Trust this folder?') && screen.includes('1. Trust and continue')) {
    // This fixture directory contains only the README created above. Approve
    // only this exact, inspected startup choice; never type through unknown UI.
    await page.locator('.wb-terminal textarea').focus(); await page.keyboard.press('Enter');
    await page.waitForTimeout(3500); screen = await page.locator('.wb-terminal .xterm-rows').innerText();
    console.log('After folder trust:', screen.slice(-5000));
  }
  if (/Update now|Sign in|trust|setup|Set up/i.test(screen)) throw new Error('Startup dialog requires inspection before typing');
  await page.locator('.wb-terminal textarea').focus();
  await page.keyboard.type('/status', { delay: 90 }); await page.waitForTimeout(400); await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
  console.log('After /status:', (await page.locator('.wb-terminal .xterm-rows').innerText()).slice(-6000));
  const statusScreen = await page.locator('.wb-terminal .xterm-rows').innerText();
  if (!/Session:|会话|Context window:|Permissions:/i.test(statusScreen)) throw new Error('Status command did not render its result');
  await page.reload();
  await page.locator('.wb-terminal .xterm').waitFor();
  await page.waitForTimeout(1200);
  const second = await (await fetch(`${base}/api/workbench/bootstrap`)).json();
  if (second.terminals.find(t => t.stepId === stepId).id !== boot.terminals.find(t => t.stepId === stepId).id) throw new Error('Refresh replaced terminal');
  await page.screenshot({ path: resolve('.verification/terminal-reconnected.png'), animations: 'disabled' });
  console.log('Refresh retained the same terminal; page errors:', errors);
  if (errors.length) throw new Error('Browser errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  if (sessionId) await withCodex(rpc => rpc('thread/archive', { threadId: sessionId })).catch(e => console.log('Could not archive test session:', e.message));
}
process.exit(0);
