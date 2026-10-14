import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { explainApiPlugin } from './server/explainApi.ts'

const root = path.dirname(fileURLToPath(import.meta.url))

function wslLanBridgePlugin(): Plugin {
  return {
    name: 'wsl-lan-bridge',
    apply: 'serve',
    async configureServer(server) {
      if (!process.env.WSL_DISTRO_NAME) return
      const script = path.join(root, 'scripts/wsl-lan-bridge.ps1')
      await new Promise<void>((resolve) => {
        let settled = false
        const done = () => {
          if (settled) return
          settled = true
          resolve()
        }
        const child = spawn(
          'powershell.exe',
          ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )
        let out = ''
        const timer = setTimeout(done, 20000)
        const show = () => {
          if (!out.split(/\r?\n/).some((line) => line.trim() === 'READY')) return
          clearTimeout(timer)
          for (const line of out.split(/\r?\n/)) {
            const trimmed = line.trim()
            if (trimmed.startsWith('LAN ')) {
              server.config.logger.info(`  ➜  Wi-Fi:   ${trimmed.slice(4)}`)
            }
          }
          child.unref()
          done()
        }
        child.stdout?.on('data', (buf: Buffer) => {
          out += buf.toString()
          show()
        })
        child.stderr?.on('data', (buf: Buffer) => {
          const text = buf.toString().trim()
          if (text) server.config.logger.warn(text)
        })
        child.on('error', (err) => {
          server.config.logger.warn(err.message)
          clearTimeout(timer)
          done()
        })
        child.on('exit', () => {
          clearTimeout(timer)
          done()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), explainApiPlugin(), wslLanBridgePlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    // Browser uses the host it loaded (localhost or the Wi-Fi IP).
    // Pinning the port stops Vite from falling back to a Linux-only address.
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
