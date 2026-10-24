import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { explainApiPlugin } from './server/explainApi.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), explainApiPlugin()],
  server: {
    // This computer only. The Mac uses the Vercel site, which calls the gateway.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // Pinning the port keeps the browser websocket on this same local server.
    ws: {
      clientPort: 5173,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(root, 'src'),
      '@logic': path.resolve(root, 'src/logic'),
      '@models': path.resolve(root, 'src/models'),
    },
  },
})
