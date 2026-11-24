import { useEffect, useState } from 'react'
import {
  dismissInstallHint,
  installHintDismissed,
  isIos,
  isStandalone,
} from '@/lib/pwa'

/** iOS "share" glyph: arrow out of a box. Drawn to match the 1.75 stroke set. */
function ShareGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 13v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" />
    </svg>
  )
}

/**
 * iOS has no install prompt: the only path to full screen is Share -> Add to
 * Home Screen. This says so once, then stays out of the way.
 */
export function InstallHint() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isIos() || isStandalone() || installHintDismissed()) return
    const timer = window.setTimeout(() => setVisible(true), 3000)
    return () => window.clearTimeout(timer)
  }, [])

  if (!visible) return null

  return (
    <div className="install-hint" role="note">
      <span className="install-hint-icon">
        <ShareGlyph />
      </span>
      <p className="install-hint-text">
        <strong>Add to Home Screen</strong> for a fullscreen board with no
        address bar.
      </p>
      <button
        type="button"
        className="install-hint-dismiss"
        onClick={() => {
          dismissInstallHint()
          setVisible(false)
        }}
        aria-label="Dismiss install hint"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
