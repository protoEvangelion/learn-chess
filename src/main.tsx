import './lib/threeCompat'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ClerkGate } from '@/components/ClerkGate'
import { InstallHint } from '@/components/InstallHint'
import { registerServiceWorker } from '@/lib/pwa'
import './index.css'
import './App.css'

registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkGate>
      <App />
      <InstallHint />
    </ClerkGate>
  </StrictMode>,
)
