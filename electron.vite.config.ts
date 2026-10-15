import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const defineMode = process.env.FELO_MODE
  ? { 'process.env.FELO_MODE': JSON.stringify(process.env.FELO_MODE) }
  : {}

export default defineConfig({
  main: {
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    },
    define: defineMode
  },
  preload: {
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    },
    define: defineMode
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: '[name]-[hash].js',
          chunkFileNames: '[name]-[hash].js',
          assetFileNames: '[name]-[hash].[ext]'
        }
      }
    },
    plugins: [tailwindcss(), react()],
    define: defineMode
  }
})
