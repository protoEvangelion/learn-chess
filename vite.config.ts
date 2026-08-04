import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@logic': path.resolve(__dirname, 'src/logic'),
      '@models': path.resolve(__dirname, 'src/models'),
    },
  },
})
