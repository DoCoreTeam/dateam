import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

/** 비고 칸이 **실제로 어디서 줄을 바꾸는지**를 글자 단위 사각형으로 읽는다 */
test('비고의 실제 줄바꿈 자리', async ({ page }) => {
  test.setTimeout(240_000)
  const out: unknown[] = []
  for (const w of [1440, 1280]) {
    await page.setViewportSize({ width: w, height: 950 })
    await page.goto(`/crm/quotes/${ID}`)
    await page.waitForLoadState('domcontentloaded')
    await expect(page.locator('article table').first()).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(600)
    out.push(await page.evaluate(() => {
      const row = document.querySelector('article table tbody tr') as HTMLElement
      const cell = [...row.querySelectorAll('td')].pop() as HTMLElement
      const node = [...cell.childNodes].find((n) => n.nodeType === 3) as Text
      if (!node) return { error: '텍스트 노드 없음', html: cell.innerHTML.slice(0, 200) }
      const text = node.data
      const range = document.createRange()
      const lines: { top: number; s: string }[] = []
      for (let i = 0; i < text.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1)
        const r = range.getClientRects()[0]
        if (!r) continue
        const top = Math.round(r.top)
        const last = lines[lines.length - 1]
        if (last && Math.abs(last.top - top) < 3) last.s += text[i]
        else lines.push({ top, s: text[i] })
      }
      return {
        cellW: Math.round(cell.getBoundingClientRect().width),
        lines: lines.map((l) => l.s),
      }
    }))
  }
  fs.writeFileSync('/tmp/qa-lines.json', JSON.stringify(out, null, 1))
  console.log(JSON.stringify(out, null, 1))
})
