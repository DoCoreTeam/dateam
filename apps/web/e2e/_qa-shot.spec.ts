import { test, expect } from '@playwright/test'
import * as path from 'path'
const ID = 'cmus4n1le0001js04vg8zjax1'
const OUT = path.join(__dirname, '..', '..', '..', 'artifacts', 'qa-final')

test('390 에서 표와 안내를 찍는다', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/crm/quotes/${ID}`)
  await page.waitForLoadState('domcontentloaded')
  const table = page.locator('article table').first()
  await expect(table).toBeVisible({ timeout: 90_000 })
  await page.waitForTimeout(600)
  await table.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, 'shot-390-table.png') })
  // 머리 단추 줄도 찍는다
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  const btns = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter((b) => ['수정', '삭제', '원본 올리기'].some((t) => b.innerText.includes(t)))
    .map((b) => ({ t: b.innerText.replace(/\n/g, '⏎'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })))
  console.log(JSON.stringify(btns))
})
