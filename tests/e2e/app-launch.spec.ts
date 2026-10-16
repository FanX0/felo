import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'

test.describe('Electron App Launch E2E', () => {
  test('launches Electron main window and renders app root container', async () => {
    const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
    if (!fs.existsSync(mainEntry)) {
      test.skip(true, 'App must be built (npm run build) prior to running Electron E2E test')
      return
    }

    const electronApp = await electron.launch({
      args: [path.resolve(__dirname, '../../')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        FELO_MODE: 'public'
      }
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const title = await window.title()
      expect(title).toBeDefined()

      const root = await window.$('#root')
      expect(root).not.toBeNull()
    } finally {
      await electronApp.close()
    }
  })
})
