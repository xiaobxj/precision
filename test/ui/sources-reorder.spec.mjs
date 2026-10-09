import { test, expect } from './fixtures.mjs';
import { localDay } from '../../lib/domain.mjs';

test.afterEach(async ({ request }) => {
  let state = await (await request.get('/api/state')).json();
  for (const task of state.tasks.filter(task => ['关联排序甲', '关联排序乙'].includes(task.title))) {
    state = await (await request.post('/api/commands', { data: { revision: state.revision, command: { type: 'delete-task', taskId: task.id } } })).json();
  }
});

test('result links remain available and original arrow sorting works without drag handles', async ({ page }) => {
  let state = await (await page.request.get('/api/state')).json();
  const run = async command => {
    state = await (await page.request.get('/api/state')).json();
    const response = await page.request.post('/api/commands', { data: { revision: state.revision, command } });
    expect(response.ok()).toBeTruthy(); state = await response.json();
  };
  await run({ type: 'create-task', title: '关联排序甲', date: localDay() });
  const taskId = state.tasks.at(-1).id;
  await run({ type: 'create-task', title: '关联排序乙', date: localDay() });
  for (const title of ['关联方向甲', '关联方向乙']) await run({ type: 'create-step', taskId, title, status: 'active' });
  const [firstStep, secondStep] = state.tasks.find(t => t.id === taskId).steps;
  for (const title of ['关联子进度甲', '关联子进度乙']) await run({ type: 'create-substep', taskId, stepId: firstStep.id, title, status: 'waiting' });
  await run({ type: 'create-result', taskId, stepId: firstStep.id, title: '关联结果', content: '结果正文必须完整保留' });
  const resultId = state.tasks.find(t => t.id === taskId).steps[0].results[0].id;
  await run({ type: 'create-note', title: '关联已有结论', content: '原始思考', conclusion: '原始结论' });
  const original = structuredClone(state.tasks.find(t => t.id === taskId));
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const task = page.locator(`[data-task-id="${taskId}"]`);
  const step = page.locator(`[data-step-id="${firstStep.id}"]`);
  const result = page.locator(`[data-result-id="${resultId}"]`);
  await result.getByRole('button', { name: '关联思考与结论' }).click();
  await page.locator('.link-note-list').getByRole('button', { name: '关联已有结论' }).click();
  await expect(result.getByRole('button', { name: '关联已有结论' })).toBeVisible();
  await step.getByRole('button', { name: '折叠方向', exact: true }).click();
  await task.getByRole('button', { name: '折叠任务', exact: true }).click();
  await page.getByLabel('搜索任务').fill('不匹配的搜索');
  await page.locator('.notes-panel .source-link').filter({ hasText: '关联结果' }).click();
  await expect(result).toBeVisible();
  await expect(result).toHaveClass(/source-highlight/);
  await expect(page.getByLabel('搜索任务')).toHaveValue('');

  await result.getByRole('button', { name: '关联思考与结论' }).click();
  await page.getByRole('button', { name: '新建关联记录' }).click();
  await expect(page.getByLabel('记录标题')).toHaveText('关联结果');
  await page.getByRole('textbox', { name: '当前结论' }).fill('由结果得到的新结论');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.notes-panel').getByRole('button', { name: '查看记录：关联结果', exact: true })).toBeVisible();

  await expect(page.locator('[data-sort-kind], [data-sort-shift]')).toHaveCount(0);
  const otherStep = page.locator(`[data-step-id="${secondStep.id}"]`);
  await otherStep.getByRole('button', { name: '上移方向', exact: true }).click();
  await expect(task.locator('[data-step-id]').first()).toHaveAttribute('data-step-id', secondStep.id);
  const children = step.locator('[data-substep-id]');
  const secondChild = original.steps[0].substeps[1].id;
  await children.last().getByRole('button', { name: '上移子进度', exact: true }).click();
  await expect(children.first()).toHaveAttribute('data-substep-id', secondChild);
  await page.reload();
  await expect(task.locator('[data-step-id]').first()).toHaveAttribute('data-step-id', secondStep.id);
  await expect(children.first()).toHaveAttribute('data-substep-id', secondChild);
  const saved = await (await page.request.get('/api/state')).json();
  expect(saved.tasks.find(t => t.id === taskId).steps.find(s => s.id === firstStep.id).results).toEqual(original.steps[0].results);
  await page.route('**/api/commands', route => route.abort('failed'));
  await otherStep.getByRole('button', { name: '下移方向', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('暂时无法保存');
  await expect(task.locator('[data-step-id]').first()).toHaveAttribute('data-step-id', secondStep.id);
  await page.unroute('**/api/commands');
  await result.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/sources-reorder.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await result.scrollIntoViewIfNeeded();
  await expect(result.getByRole('button', { name: '关联思考与结论' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: 'test-results/sources-reorder-mobile.png' });
  await result.getByRole('button', { name: '关联已有结论', exact: true }).click();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await page.locator(`[data-source-id="${resultId}"]`).uncheck();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(result.getByRole('button', { name: '关联已有结论', exact: true })).toHaveCount(0);
  await run({ type: 'delete-result', taskId, stepId: firstStep.id, resultId });
  await page.reload();
  await expect(page.locator('.notes-panel .source-link').filter({ hasText: '来源已删除' })).toBeDisabled();
  expect(errors).toEqual([]);
});
