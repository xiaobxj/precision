import { defineConfig } from '@playwright/test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default defineConfig({
  testDir: './test/ui',
  outputDir: './test-results/ui',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4318',
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    viewport: { width: 1440, height: 1100 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node server.mjs',
    url: 'http://127.0.0.1:4318/api/health',
    env: { PORT: '4318', PROCISION_DATA_DIR: join(tmpdir(), `procision-ui-${Date.now()}`) },
    reuseExistingServer: false,
  },
});
