import { test, expect } from '@playwright/test';
import { localDay } from '../../lib/domain.mjs';

test('status labels change direction and child status without editing, including keyboard, failure and reload', async ({ page }) => {
  let state = await (await page.request.get('/api/state')).json();
  const run = async command => {
    const response = await page.request.post('/api/commands', { data: { revision: state.revision, command } });
    expect(response.ok()).toBeTruthy(); state = await response.json();
  };
  await run({ type: 'create-task', title: '状态菜单测试', date: localDay() });
  const taskId = state.tasks.at(-1).id;
  try {
    await run({ type: 'create-step', taskId, title: '手动方向', content: '原始方向内容', status: 'active', bold: { title: [[0, 2]], content: [[0, 2]] } });
    const manualId = state.tasks.at(-1).steps[0].id;
    await run({ type: 'create-step', taskId, title: '自动方向', status: 'active' });
    const automaticId = state.tasks.at(-1).steps[1].id;
    await run({ type: 'create-substep', taskId, stepId: automaticId, title: '第一步', content: '原始子进度内容', status: 'active' });
    const original = structuredClone(state.tasks.at(-1));
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    const manual = page.locator(`[data-step-id="${manualId}"]`);
    const auto = page.locator(`[data-step-id="${automaticId}"]`);
    const chip = manual.getByRole('button', { name: '方向状态：手动方向', exact: true });
    await chip.click();
    await expect(page.getByRole('menuitemradio', { name: '进行中', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#editor')).not.toBeVisible();
    await page.screenshot({ path: 'test-results/status-menu-desktop.png' });
    await page.getByRole('menuitemradio', { name: '待跟进', exact: true }).click();
    await expect(chip).toHaveText('待跟进');
    await expect(chip).toBeFocused();
    await chip.press('Enter');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(chip).toHaveText('已完成');
    await page.reload();
    await expect(chip).toHaveText('已完成');
    await chip.click(); await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(chip).toBeFocused();
    await chip.click(); await page.locator('h1').click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.route('**/api/commands', route => route.abort('failed'));
    await chip.click(); await page.getByRole('menuitemradio', { name: '进行中', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('暂时无法保存');
    await expect(chip).toHaveText('已完成');
    await page.unroute('**/api/commands');
    // Aggregated directions expose their children in place; no unrelated status is changed.
    await auto.getByRole('button', { name: '方向状态：自动方向', exact: true }).click();
    await expect(page.getByRole('menu')).toContainText('由子进度自动汇总');
    await page.getByRole('menuitem', { name: '第一步 进行中' }).click();
    await page.getByRole('menuitemradio', { name: '待跟进', exact: true }).click();
    await expect(auto.getByRole('button', { name: '方向状态：自动方向', exact: true })).toContainText('待跟进');
    await expect(auto.getByRole('button', { name: '子进度状态：第一步', exact: true })).toHaveText('待跟进');
    await expect(chip).toHaveText('已完成');
    await expect(page.locator('#editor')).not.toBeVisible();
    state = await (await page.request.get('/api/state')).json();
    const saved = state.tasks.find(task => task.id === taskId);
    expect(saved.steps[0].content).toBe(original.steps[0].content);
    expect(saved.steps[0].bold).toEqual(original.steps[0].bold);
    expect(saved.steps[1].substeps[0].content).toBe(original.steps[1].substeps[0].content);
    // Reject a stale window without overwriting the more recent status or text.
    await run({ type: 'set-step-status', taskId, stepId: manualId, status: 'todo' });
    await chip.click(); await page.getByRole('menuitemradio', { name: '进行中', exact: true }).click();
    await expect(page.locator('#toast')).toContainText('其他窗口更新了内容');
    await expect(chip).toHaveText('待开始');
    await page.setViewportSize({ width: 390, height: 844 });
    await chip.click();
    const rect = await page.getByRole('menu').boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0); expect(rect.x + rect.width).toBeLessThanOrEqual(390);
    expect(rect.y).toBeGreaterThanOrEqual(0); expect(rect.y + rect.height).toBeLessThanOrEqual(844);
    await page.screenshot({ path: 'test-results/status-menu-mobile.png' });
    await page.getByRole('menuitemradio', { name: '进行中', exact: true }).click();
    await expect(chip).toHaveText('进行中');
    expect(errors).toEqual([]);
  } finally {
    state = await (await page.request.get('/api/state')).json();
    await run({ type: 'delete-task', taskId });
  }
});
