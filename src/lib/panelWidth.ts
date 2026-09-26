const KEY = 'chess-3d:panelWidth'
export const DEFAULT_PANEL_WIDTH = 440
export const MIN_PANEL_WIDTH = 280
export const MAX_PANEL_WIDTH = 720

export function clampPanelWidth(px: number, viewportWidth = window.innerWidth) {
  const max = Math.min(MAX_PANEL_WIDTH, Math.floor(viewportWidth * 0.72))
  return Math.max(MIN_PANEL_WIDTH, Math.min(max, Math.round(px)))
}

export function loadPanelWidth(): number {
  try {
    const raw = Number(localStorage.getItem(KEY))
    if (!Number.isFinite(raw)) return DEFAULT_PANEL_WIDTH
    return clampPanelWidth(raw)
  } catch {
    return DEFAULT_PANEL_WIDTH
  }
}

export function savePanelWidth(px: number) {
  localStorage.setItem(KEY, String(clampPanelWidth(px)))
}

export function applyPanelLayoutCss(panelWidth: number) {
  const w = clampPanelWidth(panelWidth)
  document.documentElement.style.setProperty('--coach-panel-width', `${w}px`)
}
