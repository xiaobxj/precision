import { test, expect } from '@playwright/test';

async function pasteScreenshot(page, selector) {
  await page.locator(selector).evaluate(async input => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 280;
    const context = canvas.getContext('2d');
    context.fillStyle = '#0f1827'; context.fillRect(0, 0, 600, 280);
    context.strokeStyle = '#22d3ee'; context.lineWidth = 3;
    context.beginPath(); context.moveTo(30, 210); context.lineTo(180, 160); context.lineTo(280, 180); context.lineTo(430, 80); context.lineTo(570, 45); context.stroke();
    context.fillStyle = '#e7edf5'; context.font = '20px sans-serif'; context.fillText('Screenshot attachment test', 30, 35);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([blob], '截图.png', { type: 'image/png' }));
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
}

test('paste images into notes and steps; reopen, preview, export and history keep actual bytes', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '新建思考记录' }).click();
  await page.getByLabel('记录标题').fill('贴图功能验证');
  await pasteScreenshot(page, '#note-content');
  await expect(page.locator('.image-draft-caption')).toContainText('已就绪');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  const card = page.locator('.note-item').filter({ hasText: '贴图功能验证' });
  await expect(card.locator('.image-thumbnail img')).toBeVisible();
  await page.reload();
  await expect(card.locator('.image-thumbnail img')).toBeVisible();
  expect(await card.locator('img').evaluate(image => image.complete && image.naturalWidth === 600)).toBe(true);
  await card.locator('.image-thumbnail').click();
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible();
  await page.getByRole('button', { name: '关闭图片预览' }).click();
  await card.locator('.note-open').click();
  await page.getByRole('button', { name: '编辑记录', exact: true }).click();
  await expect(page.locator('.image-draft')).toHaveCount(1);
  await page.getByRole('button', { name: '移除图片：截图.png' }).click();
  await page.getByRole('textbox', { name: '当前结论' }).fill('图片移到历史版本');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await card.locator('.note-open').click();
  await page.locator('.note-history > summary').click();
  await page.locator('.note-version > summary').first().click();
  await expect(page.locator('.note-version .image-thumbnail')).toBeVisible();
  await page.getByRole('button', { name: '归档（仍可找回）', exact: true }).click();
  await page.getByRole('button', { name: '新建任务' }).click();
  await page.getByLabel('任务标题').fill('图片进度测试');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  const task = page.locator('.task-card').filter({ hasText: '图片进度测试' });
  await task.getByRole('button', { name: '添加方向' }).click();
  await page.getByLabel('方向标题').fill('附上截图');
  await pasteScreenshot(page, '#form-content');
  await expect(page.locator('.image-draft-caption')).toContainText('已就绪');
  await page.getByRole('dialog', { name: '添加方向' }).getByRole('button', { name: '添加方向', exact: true }).click();
  await expect(task.locator('.step .image-thumbnail')).toBeVisible();
  const exported = await (await page.request.get('/api/export')).json();
  expect(exported.imageAssets.length).toBe(1);
  expect(exported.imageAssets[0].base64.length).toBeGreaterThan(100);
  await task.getByRole('button', { name: '删除任务', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  expect(errors).toEqual([]);
});

test('failed image upload survives refresh as a draft and can retry', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建思考记录' }).click();
  await page.getByLabel('记录标题').fill('恢复图片草稿');
  await page.route('**/api/images', route => route.abort('failed'));
  await pasteScreenshot(page, '#note-content');
  await expect(page.locator('.image-draft-caption')).toContainText('连接失败');
  await expect(page.getByRole('button', { name: '保存记录', exact: true })).toBeDisabled();
  await page.reload();
  await page.unroute('**/api/images');
  await page.getByRole('button', { name: '新建思考记录' }).click();
  await expect(page.getByLabel('记录标题')).toHaveText('恢复图片草稿');
  await expect(page.locator('.image-draft-caption')).toContainText('已就绪');
  await page.screenshot({ path: 'test-results/image-paste-editor.png' });
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByRole('button', { name: '查看记录：恢复图片草稿' }).click();
  await page.getByRole('button', { name: '归档（仍可找回）', exact: true }).click();
});

test('sidebar drag follows the pointer, snaps closed, remembers width and supports keyboard', async ({ page }) => {
  await page.goto('/');
  const handle = page.getByRole('separator', { name: '拖动调整日历栏宽度' });
  await expect(handle).toBeVisible();
  const original = await page.locator('.sidebar').boundingBox();
  const drag = async x => {
    const rect = await handle.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, 240); await page.mouse.down();
    await page.mouse.move(x, 240, { steps: 12 }); await page.mouse.up();
  };
  await drag(310);
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox()).width)).toBe(310);
  expect(original.width).toBeLessThan(310);
  await page.reload();
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox()).width)).toBe(310);
  await drag(80);
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox()).width)).toBe(60);
  await page.getByRole('button', { name: '展开日历栏', exact: true }).click();
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox()).width)).toBe(310);
  await handle.focus(); await page.keyboard.press('Home');
  await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Math.round((await page.locator('.sidebar').boundingBox()).width)).toBe(200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
