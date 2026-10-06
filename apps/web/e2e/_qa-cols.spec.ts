import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

test('비고가 긴 견적의 열 폭과 줄 수', async ({ page }) => {
  test.setTimeout(240_000)
  const out: unknown[] = []
  for (const w of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width: w, height: 950 })
    await page.goto(`/crm/quotes/${ID}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('article table').first()).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(500)
    out.push(await page.evaluate(() => {
      const table = document.querySelector('article table') as HTMLElement
      const th = [...table.querySelectorAll('thead th')] as HTMLElement[]
      const td = [...(table.querySelector('tbody tr') as HTMLElement).querySelectorAll('td')] as HTMLElement[]
      const lines = (el: HTMLElement) => {
        const cs = getComputedStyle(el)
        const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
        return +(el.getBoundingClientRect().height / lh).toFixed(1)
      }
      const nameEl = td[1].querySelector('div, span') as HTMLElement ?? td[1]
      return {
        cols: th.map((c) => `${c.innerText.trim()}=${Math.round(c.getBoundingClientRect().width)}`),
        rowH: Math.round((table.querySelector('tbody tr') as HTMLElement).getBoundingClientRect().height),
        nameFirstLine: nameEl.innerText.split('\n')[0],
        nameLines: lines(nameEl),
        remarkText: td[td.length - 1].innerText.replace(/\n/g, '⏎'),
        remarkLines: lines(td[td.length - 1]),
      }
    }))
  }
  fs.writeFileSync('/tmp/qa-cols.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
})
