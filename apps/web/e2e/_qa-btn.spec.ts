import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const PAGES = ['/crm/quotes/cmus4n1le0001js04vg8zjax1', '/crm/deals', '/crm/quotes', '/work']

test('좁은 화면에서 단추 글자가 한가운데서 안 쪼개진다', async ({ page }) => {
  test.setTimeout(420_000)
  const report: unknown[] = []
  for (const w of [390, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    for (const url of PAGES) {
      await page.goto(url, { waitUntil: 'load' })
      await page.waitForTimeout(2_500)
      await page.waitForLoadState('load')
      const probe = () => page.evaluate(() => {
        const out: { t: string; lines: string[]; overflow: number }[] = []
        for (const b of [...document.querySelectorAll('button, a.btn-primary, a.btn-ghost')] as HTMLElement[]) {
          const txt = b.innerText.trim()
          if (!txt) continue
          const lines = txt.split('\n').map((x) => x.trim()).filter(Boolean)
          const tokens = txt.split(/\s+/).filter(Boolean)
          // 줄 안의 조각이 원래 낱말이 아니면 한가운데서 쪼개진 것이다
          const split = lines.some((ln) =>
            ln.split(/\s+/).filter(Boolean).some((piece) => !tokens.includes(piece)))
          const overflow = b.scrollWidth - b.clientWidth
          if (split || overflow > 1) out.push({ t: txt.replace(/\n/g, '⏎'), lines, overflow })
        }
        return out
      })
      // 스스로 옮겨 가는 화면이 있어 한 번은 다시 잰다
      const bad = await probe().catch(async () => {
        await page.waitForTimeout(2_000)
        return probe()
      })
      report.push({ width: w, url: page.url().replace(/^https?:\/\/[^/]+/, ''), bad })
    }
  }
  fs.writeFileSync('/tmp/qa-btn.json', JSON.stringify(report, null, 1))
  const broken = report.filter((r) => (r as { bad: unknown[] }).bad.length > 0)
  console.log(JSON.stringify(broken, null, 1))
  expect(broken, '단추 글자가 쪼개지거나 넘친다').toEqual([])
})
