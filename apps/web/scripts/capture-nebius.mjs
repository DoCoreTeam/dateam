// Nebius GPU 표 전체(9행) 캡처 — GPU Instances 헤딩 ~ CPU-only instances 헤딩 사이 전 영역.
import pw from '/Users/dohyeonkim/AX사업본부/newAX/node_modules/.pnpm/playwright@1.60.0/node_modules/playwright/index.js'
const { chromium } = pw
const b = await chromium.launch({ headless: true })
const p = await (await b.newContext({ viewport: { width: 1440, height: 2200 } })).newPage()
await p.goto('https://nebius.com/prices', { waitUntil: 'domcontentloaded', timeout: 60000 })
await p.getByText('NVIDIA GPU Instances', { exact: false }).first().waitFor({ timeout: 45000 })
await p.getByText('L40S with AMD', { exact: false }).first().waitFor({ timeout: 30000 })
await p.waitForTimeout(1500)
const clip = await p.evaluate(() => {
  const leaf = (s) => Array.from(document.querySelectorAll('*')).find(e => e.children.length === 0 && e.textContent && e.textContent.includes(s))
  const top = leaf('NVIDIA GPU Instances')
  const amd = leaf('L40S with AMD')
  const cpu = leaf('CPU-only instances')
  if (!top || !amd) return null
  const t = top.getBoundingClientRect().top + scrollY
  // 하단: L40S AMD 행 아래 + 여유(또는 CPU 헤딩 직전)
  const bottom = cpu ? (cpu.getBoundingClientRect().top + scrollY - 20) : (amd.getBoundingClientRect().bottom + scrollY + 60)
  return { x: 0, y: Math.max(0, t - 10), width: 1440, height: Math.min(2000, bottom - t + 20) }
})
await p.screenshot({ path: '/tmp/nebius-gpu.png', clip: clip || undefined, fullPage: !clip })
const meta = await p.evaluate(() => 1)
console.log('캡처 완료', JSON.stringify(clip))
await b.close()
