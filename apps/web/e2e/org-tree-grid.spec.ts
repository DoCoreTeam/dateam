import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 조직도 트리 레벨 (P0020 I01)
 *
 * 두 가지를 같이 본다.
 *   ① C레벨(CTO)은 본부보다 한 줄 위에 혼자 선다. 같은 줄에 나란히 서면 조직도가
 *      «CTO 와 본부가 같은 층» 이라고 거짓말을 한다 (사용자 지적 2026-09-18).
 *   ② 같은 줄에 놓인 것끼리는 윗변과 높이가 맞는다. 안 맞으면 가지마다 다음 줄이 어긋난다.
 */

async function cardTop(page: import('@playwright/test').Page, name: string): Promise<number> {
  const el = page.getByText(name, { exact: true }).first()
  const card = el.locator('xpath=ancestor::*[@data-org-depth][1]')
  const box = await card.boundingBox()
  if (!box) throw new Error(`${name} 카드를 못 찾음`)
  return Math.round(box.y)
}

test('C레벨은 본부보다 한 줄 위에 있고 본부는 C레벨 하위와 같은 줄이다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await expect(page.locator('[data-org-depth]').first()).toBeVisible()
  await page.waitForTimeout(600)

  const cto = await cardTop(page, 'CTO')
  const bonbu = await cardTop(page, '성장지원본부')
  const yeonguso = await cardTop(page, '연구소')

  expect(cto, `CTO(${cto}) 가 성장지원본부(${bonbu}) 보다 위에 있어야 한다`).toBeLessThan(bonbu)
  expect(Math.abs(bonbu - yeonguso), `성장지원본부(${bonbu}) 와 연구소(${yeonguso}) 가 같은 줄이어야 한다`).toBeLessThanOrEqual(1)
})

test('같은 줄에 놓인 카드는 윗변과 높이가 맞는다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await expect(page.locator('[data-org-depth]').first()).toBeVisible()
  await page.waitForTimeout(600)

  const byDepth = await page.evaluate(() => {
    const out: Record<string, { tops: number[]; heights: number[] }> = {}
    document.querySelectorAll<HTMLElement>('[data-org-depth]').forEach((el) => {
      const d = el.dataset.orgDepth!
      const r = el.getBoundingClientRect()
      out[d] ??= { tops: [], heights: [] }
      out[d].tops.push(Math.round(r.top))
      out[d].heights.push(Math.round(r.height))
    })
    return out
  })

  const depths = Object.keys(byDepth)
  expect(depths.length).toBeGreaterThan(2)

  for (const d of depths) {
    const { tops, heights } = byDepth[d]
    expect(Math.max(...tops) - Math.min(...tops), `깊이 ${d} 윗변이 어긋남: ${tops.join(',')}`).toBeLessThanOrEqual(1)
    expect(Math.max(...heights) - Math.min(...heights), `깊이 ${d} 높이가 어긋남: ${heights.join(',')}`).toBeLessThanOrEqual(1)
  }
})
