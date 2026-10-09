import { test as base, expect } from '@playwright/test';

// Existing suites exercise the manual journal with its reference column open.
// The new workspace suite separately verifies the new first-visit defaults.
export const test = base.extend({
  journalView: [async ({ page }, use) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('precision-view')) localStorage.setItem('precision-view', 'progress');
      if (!localStorage.getItem('procision-insights')) localStorage.setItem('procision-insights', 'expanded');
    });
    await use();
  }, { auto: true }],
});
export { expect };
