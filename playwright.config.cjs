const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.cjs',
  workers: 1,
  reporter: 'list',
  use: { channel: process.env.PLAYWRIGHT_CHANNEL || undefined, viewport: { width: 1280, height: 800 } },
});
