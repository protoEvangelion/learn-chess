/**
 * Headless-ish fit probe against a running Vite app.
 * Usage: node scripts/test-panel-fit.mjs [baseUrl]
 */
const base = process.argv[2] || 'http://127.0.0.1:5174'

async function main() {
  // Use Playwright if available, else print instructions
  let playwright
  try {
    playwright = await import('playwright')
  } catch {
    console.error('playwright not installed; skipping')
    process.exit(0)
  }
  const browser = await playwright.chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(`${base}/?panel=analysis&t=fitprobe`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)

  const widths = [380, 520, 640]
  const results = []
  for (const w of widths) {
    await page.evaluate((width) => {
      localStorage.setItem('chess-3d:panelWidth', String(width))
      document.documentElement.style.setProperty('--coach-panel-width', `${width}px`)
      // Trigger React resize via custom event if app listens — else reload
      window.dispatchEvent(new Event('resize'))
    }, w)
    await page.goto(`${base}/?panel=analysis&t=fit${w}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1200)
    const fit = await page.evaluate(() => window.__boardFit)
    results.push({ width: w, fit })
    console.log(JSON.stringify({ width: w, fit }, null, 2))
  }

  const failed = results.filter((r) => !r.fit?.ok)
  await browser.close()
  if (failed.length) {
    console.error('FAIL', failed.map((f) => f.width))
    process.exit(1)
  }
  console.log('PASS all widths')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
