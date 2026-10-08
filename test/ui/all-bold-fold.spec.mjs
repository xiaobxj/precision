import { test, expect } from '@playwright/test';
import { applyCommand, emptyState, localDay } from '../../lib/domain.mjs';

test('all editable records keep bold; direction folding only hides content and survives refresh', async ({ page }) => {
  let state = emptyState();
  const run = command => { state = applyCommand(state, command.type.startsWith('create-') ? { images: [], ...command } : command); };
  run({ type: 'create-task', title: '任务原文', description: '任务说明原文', date: localDay() });
  const taskId = state.tasks[0].id;
  run({ type: 'create-step', taskId, title: '方向原文', content: '方向说明原文', status: 'active' });
  const stepId = state.tasks[0].steps[0].id;
  run({ type: 'create-substep', taskId, stepId, title: '子进度原文', content: '子进度正文原文\n'.repeat(8), status: 'waiting' });
  run({ type: 'create-result', taskId, stepId, title: '结果原文', content: '结果正文原文' });
  run({ type: 'create-note', title: '思考原文', conclusion: '结论原文', content: '思考过程原文' });
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/commands', route => {
    const { revision, command } = route.request().postDataJSON();
    expect(revision).toBe(state.revision); run(command);
    return route.fulfill({ json: state });
  });
  const original = structuredClone(state);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const boldField = async name => {
    const editor = page.getByRole('textbox', { name, exact: false });
    await editor.focus(); await editor.press('Control+a'); await editor.press('Control+b');
    expect(await editor.locator('b, strong').count()).toBeGreaterThan(0);
  };
  for (const { button, fields } of [
    { button: '编辑任务', fields: ['任务标题', '补充说明'] },
    { button: '编辑方向', fields: ['方向标题', '进度记录'] },
    { button: '编辑子进度', fields: ['子进度标题', '进度记录'] },
    { button: '编辑结果', fields: ['结果标题', '结果内容'] },
  ]) {
    await page.getByRole('button', { name: button, exact: true }).click();
    await expect(page.locator('#editor')).not.toContainText('Ctrl + B');
    for (const field of fields) await boldField(field);
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('#editor')).not.toBeVisible();
  }
  await page.getByRole('button', { name: '查看记录：思考原文', exact: true }).click();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  for (const field of ['记录标题', '当前结论', '思考过程与有用信息']) await boldField(field);
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await page.reload();
  for (const selector of ['.task-title-line h3', '.task-description', '.step-title', '.step-content', '.substep-title', '.substep-content', '.result-title', '.result-content', '.note-open > strong', '.note-inline-text']) {
    expect(await page.locator(`${selector} strong`).count()).toBeGreaterThan(0);
  }
  const stripBold = value => JSON.parse(JSON.stringify(value, (key, item) => ['bold', 'updatedAt', 'activities', 'revision', 'versions'].includes(key) ? undefined : item));
  expect(stripBold(state)).toEqual(stripBold(original));
  const direction = page.locator(`[data-step-id="${stepId}"]`);
  const beforeFold = structuredClone(state);
  await direction.getByRole('button', { name: '折叠方向', exact: true }).click();
  await expect(direction).toHaveText('方向原文');
  await expect(direction.locator('.step-status, .step-check, .step-footer, .substep, .result-record, .step-content, .image-gallery')).toHaveCount(0);
  await expect(direction.getByRole('button', { name: '展开方向', exact: true })).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await expect(direction).toHaveClass(/step-folded/);
  expect(state).toEqual(beforeFold);
  await page.getByLabel('搜索任务或进度').fill('子进度正文原文');
  await expect(direction.locator('.substep-content')).toBeVisible();
  await page.getByLabel('搜索任务或进度').fill('');
  await expect(direction).toHaveClass(/step-folded/);
  await page.locator('.followup-item').click();
  await expect(direction.locator('.substep-content')).toBeVisible();
  await direction.getByRole('button', { name: '折叠方向', exact: true }).click();
  await direction.getByRole('button', { name: '展开方向', exact: true }).click();
  await expect(direction.locator('.result-content strong')).toHaveText('结果正文原文');
  // Editing formatting creates a history version containing the previous bold.
  await page.getByRole('button', { name: '查看记录：思考原文', exact: true }).click();
  await expect(page.locator('.note-reader h2 strong')).toHaveText('思考原文');
  await expect(page.locator('.note-section .note-text strong')).toHaveCount(2);
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  const conclusion = page.getByRole('textbox', { name: '当前结论' });
  await conclusion.focus(); await conclusion.press('Control+a'); await conclusion.press('Control+b');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await page.getByRole('button', { name: '查看记录：思考原文', exact: true }).click();
  await expect(page.locator('.note-conclusion strong')).toHaveCount(0);
  await page.locator('.note-history > summary').click();
  await page.locator('.note-version > summary').first().click();
  await expect(page.locator('.note-version').first().locator('.note-text strong')).toHaveCount(2);
  expect(state.notes[0].versions[0].bold).toEqual(beforeFold.notes[0].bold);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await direction.getByRole('button', { name: '折叠方向', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/fold-direction-mobile.png', fullPage: true });
  await direction.getByRole('button', { name: '展开方向', exact: true }).click();
  await expect(direction.locator('.substep-content')).toBeVisible();
  expect(errors).toEqual([]);
});
