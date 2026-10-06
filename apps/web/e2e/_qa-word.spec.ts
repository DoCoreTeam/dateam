import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

test('비고가 낱말 가운데서 끊기나', async ({ page }) => {
  test.setTimeout(240_000)
  const out: unknown[] = []
  for (const w of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width: w, height: 950 })
    await page.goto(`/crm/quotes/${ID}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('article table').first()).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(500)
    out.push(await page.evaluate(() => {
      const row = document.querySelector('article table tbody tr') as HTMLElement
      const cell = [...row.querySelectorAll('td')].pop() as HTMLElement
      const cs = getComputedStyle(cell)
      const inner = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      // 각 낱말을 같은 서식으로 재서 칸보다 넓은 것을 찾는다 — 그런 낱말만 가운데서 끊긴다
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`
      document.body.appendChild(probe)
      const words = cell.innerText.split(/\s+/).filter(Boolean)
      const tooWide = words.filter((wd) => { probe.textContent = wd; return probe.offsetWidth > inner })
      probe.remove()
      return { inner: Math.round(inner), words: words.length, tooWide }
    }))
  }
  fs.writeFileSync('/tmp/qa-word.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out))
})
