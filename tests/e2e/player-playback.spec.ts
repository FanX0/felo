import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'
import fs from 'fs'

test.describe('Player Controls & Playback E2E', () => {
  test('verifies player bar, playback controls, and repeat toggle in real app window', async () => {
    const mainEntry = path.resolve(__dirname, '../../out/main/index.js')
    if (!fs.existsSync(mainEntry)) {
      test.skip(true, 'App must be built (npm run build) prior to running Electron E2E test')
      return
    }

    const tempUserDataDir = path.resolve(__dirname, `../../.test-userData-${Date.now()}`)
    const electronApp = await electron.launch({
      args: [
        `--user-data-dir=${tempUserDataDir}`,
        path.resolve(__dirname, '../../')
      ],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        FELO_MODE: 'public'
      }
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      // 1. Ensure the footer bar is present in the DOM
      const footer = window.locator('footer')
      await expect(footer).toBeVisible({ timeout: 15000 })

      // 2. Play/Pause button check
      const playButton = footer.locator('button[title="Play"], button[title="Pause"], button[title="Buffering track..."]').first()
      await expect(playButton).toBeVisible()

      // 3. Repeat button interaction test
      const repeatButton = footer.locator('button[title^="Repeat:"]').first()
      await expect(repeatButton).toBeVisible()

      // Click Repeat to cycle through modes: off -> all -> one
      await repeatButton.click()
      await window.waitForTimeout(300)

      // 4. Progress bar check
      const progressBar = footer.locator('.bg-border.rounded-full').first()
      await expect(progressBar).toBeVisible()

      // 5. Volume controls
      const volumeBar = footer.locator('div[title*="Volume"]').first()
      if (await volumeBar.isVisible()) {
        const box = await volumeBar.boundingBox()
        if (box) {
          // Click volume bar at 80% width
          await window.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2)
        }
      }
    } finally {
      await electronApp.close()
      try {
        fs.rmSync(tempUserDataDir, { recursive: true, force: true })
      } catch {}
    }
  })
})
