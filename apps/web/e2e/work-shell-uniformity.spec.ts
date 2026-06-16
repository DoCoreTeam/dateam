import { test, expect } from '@playwright/test'

const WIDTHS = [375, 768, 1024, 1440]
const PAGES = [
  { path: '/daily', subtabLabels: ['일간', '주간', '메모'] },
  { path: '/dept-tasks', subtabLabels: ['전체', '예정', '진행중', '블로커', '완료'] },
  { path: '/weekly-report', subtabLabels: ['내 보고', '팀 전체'] },
  { path: '/work/overview', subtabLabels: ['고객별', '딜별', '프로젝트별'] },
]

for (const w of WIDTHS) {
  for (const p of PAGES) {
    test(`[${w}] ${p.path} shares uniform top skeleton`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 })
      await page.goto(p.path)

      // 1) 공유 탭바(업무 섹션 네비) 존재 — 4페이지 동일
      await expect(page.getByRole('navigation', { name: '업무 탭' })).toBeVisible()

      // 2) 공유 헤더 h1 존재
      await expect(page.locator('h1').first()).toBeVisible()

      // 3) 공유 서브탭(.work-subtabs) 존재 + 첫 라벨 노출
      const subtabs = page.locator('.work-subtabs')
      await expect(subtabs).toBeVisible()
      await expect(subtabs.getByText(p.subtabLabels[0], { exact: true }).first()).toBeVisible()

      // 4) 가로 스크롤 0 (overflow 없음)
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(1)

      // 스크린샷
      await page.screenshot({ path: `/tmp/work-shell/${p.path.replace(/\//g, '_')}_${w}.png`, fullPage: false })
    })
  }
}

test('subtab switching works on each page', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  // daily: 일간 → 주간 (state)
  await page.goto('/daily')
  await page.locator('.work-subtab', { hasText: '주간' }).click()
  await expect(page.locator('.work-subtab.is-active', { hasText: '주간' })).toBeVisible()

  // dept-tasks: 전체 → 완료 (state filter)
  await page.goto('/dept-tasks')
  await page.locator('.work-subtab', { hasText: '완료' }).click()
  await expect(page.locator('.work-subtab.is-active', { hasText: '완료' })).toBeVisible()

  // weekly-report: 내 보고 → 팀 전체 (href ?tab=)
  await page.goto('/weekly-report')
  await page.locator('.work-subtab', { hasText: '팀 전체' }).click()
  await expect(page).toHaveURL(/tab=team/)

  // work/overview: 고객별 → 딜별 (state ?axis=)
  await page.goto('/work/overview')
  await page.getByTestId('axis-deal').click()
  await expect(page.locator('.work-subtab.is-active', { hasText: '딜별' })).toBeVisible()
})
