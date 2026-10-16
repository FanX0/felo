import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './',
  timeout: 45000,
  expect: {
    timeout: 10000
  },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  }
})
