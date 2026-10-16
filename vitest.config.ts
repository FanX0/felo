import { resolve } from 'path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/preload/*.d.ts',
        'src/renderer/src/vite-env.d.ts',
        'out/**',
        'dist/**',
        '**/*.config.*'
      ]
    },
    projects: [
      {
        name: 'shared-and-main',
        resolve: {
          extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
        },
        test: {
          include: ['tests/unit/shared/**/*.test.ts', 'tests/unit/main/**/*.test.ts', 'tests/unit/worker/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['tests/setup/vitest.setup.node.ts'],
          globals: true
        }
      },
      {
        name: 'renderer',
        plugins: [react()],
        resolve: {
          extensions: ['.ts', '.tsx', '.js', '.mjs', '.json'],
          alias: {
            '@renderer': resolve(__dirname, 'src/renderer/src')
          }
        },
        test: {
          include: ['tests/unit/renderer/**/*.test.ts', 'tests/integration/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['tests/setup/vitest.setup.renderer.ts'],
          globals: true
        }
      }
    ]
  }
})
