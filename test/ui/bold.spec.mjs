import { test, expect } from './fixtures.mjs';
import { localDay } from '../../lib/domain.mjs';

async function selectText(editor, text) {
  await editor.focus();
  await editor.evaluate((el, text) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const start = node.data.indexOf(text);
      if (start >= 0) { range.setStart(node, start); range.setEnd(node, start + text.length); break; }
    }
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  }, text);
}

test('bold title and body preserve plain text, drafts, undo, refresh, edits and literal markup', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let state = await (await page.request.get('/api/state')).json();
  const run = async command => {
    const response = await page.request.post('/api/commands', { data: { revision: state.revision, command } });
    expect(response.ok()).toBeTruthy(); state = await response.json();
  };
  await run({ type: 'create-task', title: '加粗验证', date: localDay() });
  const taskId = state.tasks.at(-1).id;
  await run({ type: 'create-step', taskId, title: '保留原方向', content: '原有说明', status: 'done' });
  const stepId = state.tasks.at(-1).steps[0].id;
  const literal = '**原样星号** <b>原样标签</b>';
  await run({ type: 'create-result', taskId, stepId, title: literal, content: literal });
  const original = structuredClone(state.tasks.at(-1).steps[0].results[0]);
  await page.goto('/');
  const task = page.locator(`[data-task-id="${taskId}"]`);
  await expect(task.locator('.result-title')).toHaveText(literal);
  await expect(task.locator('.result-record strong, .result-record b')).toHaveCount(0);
  await task.getByRole('button', { name: '记录结果', exact: true }).click();
  const title = page.getByRole('textbox', { name: '结果标题' });
  const body = page.getByRole('textbox', { name: '结果内容' });
  await title.fill('普通标题和重点');
  await selectText(title, '重点');
  await title.press('Control+b');
  await expect(title.locator('b, strong')).toHaveText('重点');
  await title.press('Control+z');
  await expect(title.locator('b, strong')).toHaveCount(0);
  await title.press('Control+y');
  await expect(title.locator('b, strong')).toHaveText('重点');
  const content = '首行普通\n第二行重点\n\n末行 <script>window.boldInjected = true</script>';
  await body.fill(content);
  await selectText(body, '第二行重点');
  await page.getByRole('button', { name: '正文加粗', exact: true }).click();
  await expect(body.locator('b, strong')).toHaveText('第二行重点');
  // A failed save retains both text and formatting as a recoverable draft.
  await page.route('**/api/commands', route => route.abort('failed'));
  await page.getByRole('button', { name: '保存结果', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.reload(); await page.unroute('**/api/commands');
  await task.getByRole('button', { name: '记录结果', exact: true }).click();
  await expect(title.locator('strong')).toHaveText('重点');
  await expect(body.locator('strong')).toHaveText('第二行重点');
  await body.press('Control+Enter');
  await expect(page.locator('#editor')).not.toBeVisible();
  await page.reload();
  const result = task.locator('.result-record').last();
  await expect(result.locator('.result-title strong')).toHaveText('重点');
  await expect(result.locator('.result-content strong')).toHaveText('第二行重点');
  state = await (await page.request.get('/api/state')).json();
  let saved = state.tasks.find(t => t.id === taskId).steps[0].results;
  expect(saved[0]).toEqual(original);
  expect(saved[1].content).toBe(content);
  expect(saved[1].bold).toEqual({ title: [[5, 7]], content: [[5, 10]] });
  expect(await page.evaluate(() => window.boldInjected)).toBeUndefined();
  await result.getByRole('button', { name: '编辑结果', exact: true }).click();
  await selectText(body, '第二行重点'); await body.press('Control+b');
  await expect(body.locator('b, strong')).toHaveCount(0);
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(result.locator('.result-content strong')).toHaveCount(0);
  await expect(result.locator('.result-title strong')).toHaveText('重点');
  // Starting with no selection supports bold typing and ordinary multiline input.
  await task.getByRole('button', { name: '记录结果', exact: true }).click();
  await title.fill('继续输入');
  await body.focus(); await body.press('Control+b');
  await page.keyboard.insertText('加粗开头');
  await body.press('Control+b');
  await page.keyboard.insertText('普通');
  await body.press('Enter'); await body.press('Enter');
  await page.keyboard.insertText('末行');
  await page.getByRole('button', { name: '保存结果', exact: true }).click();
  await expect(task.locator('.result-record')).toHaveCount(3);
  state = await (await page.request.get('/api/state')).json();
  saved = state.tasks.find(t => t.id === taskId).steps[0].results;
  expect(saved[2].content).toBe('加粗开头普通\n\n末行');
  expect(saved[2].bold.content).toEqual([[0, 4]]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await result.getByRole('button', { name: '编辑结果', exact: true }).click();
  await page.screenshot({ path: 'test-results/bold-editor-mobile.png', fullPage: true });
  await run({ type: 'delete-task', taskId });
  expect(errors).toEqual([]);
});
