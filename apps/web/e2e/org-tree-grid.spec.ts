import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 조직도 트리 레벨 정렬 (P0019 I08a)
 *
 * 같은 깊이의 카드가 같은 줄에서 시작해야 한다. 지금까지는 형제에 C레벨이 있으면 부서를
 * 일부러 48px 밀었고, 카드 높이가 제각각이라 가지마다 다음 줄이 다른 높이에서 시작했다.
 */
test('같은 깊이 카드는 같은 줄에서 시작한다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)
  await expect(page.locator('[data-org-depth]').first()).toBeVisible()
  await page.waitForTimeout(600) // 글꼴 로드 뒤 재측정까지 기다린다

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
  expect(depths.length).toBeGreaterThan(2) // 회사 · 본부 · 하위 부서는 있어야 의미가 있다

  for (const d of depths) {
    const { tops, heights } = byDepth[d]
    // 같은 줄: 윗변이 1px 안쪽으로 모인다(확대 배율 때문에 소수점이 생긴다)
    expect(Math.max(...tops) - Math.min(...tops), `깊이 ${d} 윗변이 어긋남: ${tops.join(',')}`).toBeLessThanOrEqual(1)
    // 같은 높이: 이게 맞아야 그 다음 줄도 맞는다
    expect(Math.max(...heights) - Math.min(...heights), `깊이 ${d} 높이가 어긋남: ${heights.join(',')}`).toBeLessThanOrEqual(1)
  }
})
