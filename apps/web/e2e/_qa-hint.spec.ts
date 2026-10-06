import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

test('밀어 보라는 안내와 태블릿 폭', async ({ page }) => {
  test.setTimeout(300_000)
  const out: unknown[] = []
  for (const w of [1440, 1280, 1024, 768, 430, 390]) {
    await page.setViewportSize({ width: w, height: 950 })
    await page.goto(`/crm/quotes/${ID}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('article table').first()).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(600)
    out.push(await page.evaluate(() => {
      const table = document.querySelector('article table') as HTMLElement
      const wrap = table.parentElement as HTMLElement
      const row = table.querySelector('tbody tr') as HTMLElement
      const td = [...row.querySelectorAll('td')] as HTMLElement[]
      const cell = td[td.length - 1]
      const cs = getComputedStyle(cell)
      const inner = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`
      document.body.appendChild(probe)
      const tooWide = cell.innerText.split(/\s+/).filter(Boolean)
        .filter((wd) => { probe.textContent = wd; return probe.offsetWidth > inner })
      probe.remove()
      const hint = [...document.querySelectorAll('p')]
        .find((p) => p.innerText.includes('옆으로 밀면'))
      const nameEl = td[1]
      const nameLines = +(nameEl.getBoundingClientRect().height
        / (parseFloat(getComputedStyle(nameEl).lineHeight) || 18)).toFixed(1)
      return {
        overflow: wrap.scrollWidth - wrap.clientWidth,
        hint: hint ? hint.innerText : null,
        tableW: Math.round(table.getBoundingClientRect().width),
        remarkInner: Math.round(inner),
        tooWide,
        nameLines,
      }
    }))
  }
  fs.writeFileSync('/tmp/qa-hint.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out))
})
