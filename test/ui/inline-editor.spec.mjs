import { test, expect } from '@playwright/test';

test.afterEach(async ({ request }) => {
  let state = await (await request.get('/api/state')).json();
  for (const task of state.tasks.filter(t => t.title.startsWith('原位编辑验证'))) {
    state = await (await request.post('/api/commands', { data: { revision: state.revision, command: { type: 'delete-task', taskId: task.id } } })).json();
  }
});

test('edit beside a live terminal, preview pasted images directly, and retain drafts through rerenders and save failures', async ({ page }) => {
  let state = await (await page.request.get('/api/state')).json();
  const run = async command => {
    const response = await page.request.post('/api/commands', { data: { revision: state.revision, command } });
    expect(response.ok()).toBeTruthy(); state = await response.json();
  };
  await run({ type: 'create-task', title: '原位编辑验证', description: '任务说明', date: '2026-10-09' });
  const taskId = state.tasks.at(-1).id;
  await run({ type: 'create-step', taskId, title: '研究方向', content: '原有研究结论', status: 'active' });
  const stepId = state.tasks.at(-1).steps[0].id;
  await run({ type: 'create-substep', taskId, stepId, title: '独立子方向', content: '子方向原文', status: 'active' });
  const substepId = state.tasks.at(-1).steps[0].substeps[0].id;
  await run({ type: 'create-result', taskId, stepId, title: '阶段结果', content: '结果原文' });
  const resultId = state.tasks.at(-1).steps[0].results[0].id;
  const terminal = { id: 'inline-terminal', stepId, status: 'running' }, input = [], errors = [];
  let connections = 0, socket;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/workbench/bootstrap', route => route.fulfill({ json: { token: 'fixture', projects: [], terminals: [terminal] } }));
  await page.route('**/api/workbench/status', route => route.fulfill({ json: { terminals: [terminal] } }));
  await page.routeWebSocket(/\/api\/workbench\/attach\?/, ws => {
    connections++; socket = ws;
    ws.onMessage(raw => { const message = JSON.parse(String(raw)); if (message.type === 'input') input.push(message.data); });
    ws.send(JSON.stringify({ type: 'snapshot', terminal, data: 'Research terminal stays available\r\n' }));
  });
  await page.setViewportSize({ width: 1680, height: 1050 }); await page.goto('/');
  await page.locator(`[data-direction="${stepId}"]`).click();
  await expect(page.locator('.xterm-rows')).toContainText('Research terminal stays available');
  await page.evaluate(() => { window.originalTerminal = document.querySelector('.xterm'); });
  const task = page.locator(`[data-task-id="${taskId}"]`), step = page.locator(`[data-step-id="${stepId}"]`);
  const editor = page.locator('#editor'), body = page.getByRole('textbox', { name: '进度记录' });
  await step.locator('> .step-main > .step-heading > .step-title').click();
  await expect(step.locator('#editor')).toBeVisible();
  expect(await editor.evaluate(e => e.matches(':modal'))).toBe(false);
  const box = await editor.boundingBox(), right = await page.locator('#workbench-root').boundingBox();
  expect(box.x + box.width).toBeLessThan(right.x);
  await body.fill('修改后的研究结论\n与右侧对照记录');
  await page.locator('.wb-terminal textarea').press('x');
  await expect.poll(() => input.join('')).toBe('x');
  await expect(editor).toBeVisible(); await expect(body).toHaveText('修改后的研究结论\n与右侧对照记录', { useInnerText: true });
  await body.evaluate(async element => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
    const context = canvas.getContext('2d'); context.fillStyle = '#102033'; context.fillRect(0, 0, 800, 400);
    context.strokeStyle = '#22d3ee'; context.lineWidth = 6; context.beginPath(); context.moveTo(40, 340); context.lineTo(250, 180); context.lineTo(400, 260); context.lineTo(760, 50); context.stroke();
    context.fillStyle = '#ffffff'; context.font = '28px sans-serif'; context.fillText('Research result preview', 35, 45);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], 'image.png', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(editor.locator('.image-draft-caption')).toContainText('已就绪');
  await expect(editor.locator('.image-draft-caption > span')).not.toBeVisible();
  const draftImage = editor.locator('.image-draft-preview img');
  await expect.poll(() => draftImage.evaluate(i => i.naturalWidth)).toBe(800);
  const previewBox = await draftImage.boundingBox(); expect(previewBox.height).toBeCloseTo(previewBox.width / 2, 0);
  socket.send(JSON.stringify({ type: 'output', data: 'You can keep typing here while editing the journal.\r\n' }));
  await expect(page.locator('.xterm-rows')).toContainText('You can keep typing here');
  await page.getByRole('button', { name: '切换明暗主题', exact: true }).click();
  await expect(body).toHaveText('修改后的研究结论\n与右侧对照记录', { useInnerText: true });
  await expect(draftImage).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索任务或进度' }).fill('没有匹配的任务');
  await expect(editor).toBeVisible(); await expect(body).toContainText('修改后的研究结论');
  await page.getByRole('searchbox', { name: '搜索任务或进度' }).fill('');
  await expect(step.locator('#editor')).toBeVisible();
  await page.locator('.task-workspace').evaluate(panel => {
    panel.scrollTop += panel.querySelector('#editor').getBoundingClientRect().top - panel.getBoundingClientRect().top - 8;
  });
  await page.screenshot({ path: 'test-results/inline-editor-with-terminal.png' });
  await page.route('**/api/commands', route => route.abort());
  await editor.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(editor.locator('#form-error')).toContainText('输入内容已保留');
  await expect(body).toContainText('修改后的研究结论');
  await page.unroute('**/api/commands');
  await body.press('Control+Enter');
  await expect(editor).not.toBeVisible();
  await expect(step.locator('> .step-main > .step-content')).toHaveText('修改后的研究结论\n与右侧对照记录');
  const savedImage = step.locator('> .step-main > .image-gallery .image-thumbnail');
  await expect(savedImage.locator('img')).toBeVisible(); await expect(savedImage.locator('span')).not.toBeVisible();
  const imageBox = await savedImage.locator('img').boundingBox(); expect(imageBox.height).toBeCloseTo(imageBox.width / 2, 0);
  await savedImage.click(); await expect(page.locator('#image-viewer')).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await step.locator('> .step-main > .step-heading > .step-title').click();
  await body.fill('尚未保存的草稿'); await editor.getByRole('button', { name: '取消', exact: true }).click();
  await expect(step.locator('> .step-main > .step-content')).toContainText('修改后的研究结论');
  await step.locator('> .step-main > .step-heading > .step-title').click(); await expect(body).toHaveText('尚未保存的草稿');
  await expect(editor.locator('.image-draft-preview img')).toBeVisible();
  await body.press('Escape'); await expect(editor).not.toBeVisible();
  const child = page.locator(`[data-substep-id="${substepId}"]`), result = page.locator(`[data-result-id="${resultId}"]`);
  for (const [card, action, label, text] of [[child, 'edit-substep', '进度记录', '子方向已更新'], [result, 'edit-result', '结果内容', '结果已更新'], [task, 'edit-task', '补充说明', '任务说明已更新']]) {
    await card.locator(`[data-action="${action}"]`).first().click(); await expect(card.locator('#editor')).toBeVisible();
    await page.getByRole('textbox', { name: label }).fill(text); await editor.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(editor).not.toBeVisible(); await expect(card).toContainText(text);
  }
  expect(await page.evaluate(() => window.originalTerminal === document.querySelector('.xterm'))).toBe(true);
  expect(connections).toBe(1);
  await page.reload();
  await step.locator('> .step-main > .step-heading > .step-title').click();
  await expect(body).toHaveText('尚未保存的草稿');
  await expect.poll(() => editor.locator('.image-draft-preview img').evaluate(i => i.naturalWidth)).toBe(800);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
