import { test, expect } from './fixtures.mjs';
import { applyCommand, emptyState, localDay } from '../../lib/domain.mjs';

test('columns and surrounding page scroll independently, retain reading positions and adapt to phones', async ({ page }) => {
  let state = emptyState();
  const run = command => { state = applyCommand(state, command); };
  for (let taskIndex = 1; taskIndex <= 3; taskIndex++) {
    run({ type: 'create-task', title: `对照任务 ${taskIndex}`, date: localDay() });
    const taskId = state.tasks.at(-1).id;
    for (let stepIndex = 1; stepIndex <= 7; stepIndex++) {
      run({ type: 'create-step', taskId, title: `研究方向 ${taskIndex}.${stepIndex}`, content: '这一方向的验证过程与结果。\n保留在中间，和右侧结论对照。', status: 'active' });
    }
  }
  for (let i = 1; i <= 3; i++) run({ type: 'create-note', title: `用于对照的结论 ${i}`, conclusion: '固定到适合对照的位置。\n'.repeat(30), content: '保留的原始思考。' });
  await page.route('**/api/state', route => route.fulfill({ json: state }));
  await page.route('**/api/commands', route => {
    const { revision, command } = route.request().postDataJSON();
    expect(revision).toBe(state.revision);
    run(command);
    return route.fulfill({ json: state });
  });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const center = page.getByRole('region', { name: '任务列表', exact: true });
  const right = page.getByRole('complementary', { name: '思考与进度参考', exact: true });
  await expect(center.locator('.task-card')).toHaveCount(3);
  const top = locator => locator.evaluate(element => Math.round(element.scrollTop));
  const wheel = async (locator, amount) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width * .6, box.y + Math.min(150, box.height / 2));
    await page.mouse.wheel(0, amount);
  };
  for (const column of [center, right]) {
    expect(await column.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(column).toHaveAttribute('tabindex', '0');
  }
  await wheel(center, 450);
  await expect.poll(() => top(center)).toBe(450);
  expect(await top(right)).toBe(0);
  await wheel(right, 600);
  await expect.poll(() => top(right)).toBe(600);
  expect(await top(center)).toBe(450);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => top(center)).toBe(450);
  await expect.poll(() => top(right)).toBe(600);
  await page.getByRole('button', { name: '后一天', exact: true }).click();
  await expect.poll(() => top(center)).toBe(0);
  expect(await top(right)).toBe(600);
  await page.getByRole('button', { name: '前一天', exact: true }).click();
  await expect.poll(() => top(center)).toBe(450);
  expect(await top(right)).toBe(600);

  const visibleStepId = await center.evaluate(column => {
    const bounds = column.getBoundingClientRect();
    return [...column.querySelectorAll('.step')].find(step => {
      const rect = step.querySelector('.step-check').getBoundingClientRect();
      return rect.top > bounds.top + 20 && rect.bottom < bounds.bottom - 20;
    }).dataset.stepId;
  });
  const step = center.locator(`[data-step-id="${visibleStepId}"]`);
  await step.locator('.step-check').click();
  await expect(step).toHaveClass(/step-done/);
  await expect.poll(() => top(center)).toBe(450);
  expect(await top(right)).toBe(600);
  await step.locator('.step-title').click();
  await page.getByLabel('进度记录').fill('更新后的验证结果。\n继续对照右侧结论。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect.poll(() => top(center)).toBe(450);
  expect(await top(right)).toBe(600);
  await page.screenshot({ path: 'test-results/independent-scroll.png', animations: 'disabled' });

  await center.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const bottom = await top(center);
  await wheel(center, 500);
  await page.waitForTimeout(200); // Let native wheel chaining settle before checking both other surfaces.
  expect(await top(center)).toBe(bottom);
  expect(await top(right)).toBe(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await center.focus(); await page.keyboard.press('PageUp');
  await expect.poll(() => top(center)).toBeLessThan(bottom);
  expect(await top(right)).toBe(600);
  // Wait for the native PageUp animation before setting a new scroll position.
  await expect.poll(async () => {
    const position = await top(center);
    await page.waitForTimeout(200);
    return await top(center) === position;
  }).toBe(true);

  // The header, gutter and outside margins scroll the page without moving either column internally.
  await center.evaluate(el => el.scrollTo({ top: 450, behavior: 'instant' }));
  await expect.poll(() => top(center)).toBe(450);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.mouse.move(700, 140); await page.mouse.wheel(0, 220);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(220);
  expect(await top(center)).toBe(450);
  expect(await top(right)).toBe(600);
  await wheel(center, 200);
  await expect.poll(() => top(center)).toBe(650);
  expect(await top(right)).toBe(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(220);
  await wheel(right, 200);
  await expect.poll(() => top(right)).toBe(800);
  expect(await top(center)).toBe(650);
  expect(await page.evaluate(() => window.scrollY)).toBe(220);
  const centerBox = await center.boundingBox();
  const rightBox = await right.boundingBox();
  await page.mouse.move((centerBox.x + centerBox.width + rightBox.x) / 2, centerBox.y + 100);
  await page.mouse.wheel(0, 90);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(220);
  const pagePosition = await page.evaluate(() => window.scrollY);
  expect(await top(center)).toBe(650);
  expect(await top(right)).toBe(800);
  await page.getByRole('button', { name: '切换明暗主题' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);
  expect(await top(center)).toBe(650);
  expect(await top(right)).toBe(800);
  await page.screenshot({ path: 'test-results/page-and-column-scroll.png', animations: 'disabled' });
  await right.evaluate(el => { el.scrollTop = el.scrollHeight; });
  const rightBottom = await top(right);
  await wheel(right, 500);
  await page.waitForTimeout(200);
  expect(await top(right)).toBe(rightBottom);
  expect(await top(center)).toBe(650);
  expect(await page.evaluate(() => window.scrollY)).toBe(pagePosition);
  const sidebarBox = await page.locator('.sidebar').boundingBox();
  await page.mouse.move(sidebarBox.x + sidebarBox.width + 14, 150); await page.mouse.wheel(0, -1000);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  expect(await top(center)).toBe(650);
  expect(await top(right)).toBe(rightBottom);
  await right.evaluate(el => { el.scrollTop = 600; });

  await page.setViewportSize({ width: 1440, height: 600 });
  expect((await center.boundingBox()).height).toBeGreaterThan(180);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(center).toHaveAttribute('tabindex', '-1');
  await expect(right).toHaveAttribute('tabindex', '-1');
  expect(await center.evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.mouse.move(180, 500); await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(300);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await expect(center).toHaveAttribute('tabindex', '0');
  await expect(right).toHaveAttribute('tabindex', '0');
  expect(await top(right)).toBe(600);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(errors).toEqual([]);
});
