import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { explainApiPlugin } from './server/explainApi.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), explainApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@logic': path.resolve(root, 'src/logic'),
      '@models': path.resolve(root, 'src/models'),
    },
  },
})
