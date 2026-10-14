import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    }
  },
  preload: {
    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      },
      extensions: ['.ts', '.tsx', '.js', '.mjs', '.json']
    },
    plugins: [tailwindcss(), react()]
  }
})
