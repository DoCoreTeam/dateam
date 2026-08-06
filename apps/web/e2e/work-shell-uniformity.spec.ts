import { test, expect, type Page } from '@playwright/test'

async function dismissGlobalModals(page: Page) {
  await page.waitForTimeout(400)
  for (let i = 0; i < 3; i += 1) {
    const backdrop = page.locator('.modal-backdrop').first()
    if (!await backdrop.isVisible().catch(() => false)) return
    await backdrop.click({ position: { x: 2, y: 2 } })
    await page.waitForTimeout(100)
  }
}

const WIDTHS = [375, 768, 1024, 1440]
const PAGES = [
  { path: '/daily', subtabLabels: ['일간', '주간', '메모'] },
  { path: '/dept-tasks', subtabLabels: ['전체', '예정', '진행중', '블로커', '완료'] },
  { path: '/weekly-report', subtabLabels: ['내 보고', '팀 전체'] },
  { path: '/work/projects?view=overview', subtabLabels: ['프로젝트', '현황'] },
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
      const subtabs = page.locator('.work-subtabs').first()
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
  await dismissGlobalModals(page)
  await page.locator('.work-subtab', { hasText: '주간' }).click()
  await expect(page.locator('.work-subtab.is-active', { hasText: '주간' })).toBeVisible()

  // dept-tasks: 전체 → 완료 (state filter)
  await page.goto('/dept-tasks')
  await dismissGlobalModals(page)
  await page.locator('.work-subtab', { hasText: '완료' }).click()
  await expect(page.locator('.work-subtab.is-active', { hasText: '완료' })).toBeVisible()

  // weekly-report: 내 보고 → 팀 전체 (href ?tab=)
  await page.goto('/weekly-report')
  await dismissGlobalModals(page)
  await page.locator('.work-subtab', { hasText: '팀 전체' }).click()
  await expect(page).toHaveURL(/tab=team/)

  // projects: 프로젝트 → 현황 (state ?view=overview)
  await page.goto('/work/projects')
  await dismissGlobalModals(page)
  await page.getByTestId('view-overview').click()
  await expect(page).toHaveURL(/view=overview/)
  await expect(page.locator('.work-subtab.is-active', { hasText: '현황' }).first()).toBeVisible()
})

test('mobile daily order and department detail use the intended flow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/daily')
  await dismissGlobalModals(page)
  const compose = page.locator('.daily-compose-fixed')
  const side = page.locator('.daily-day-side')
  const timeline = page.locator('.daily-timeline-scroll')
  await expect(compose).toBeVisible()
  const [composeBox, sideBox, timelineBox] = await Promise.all([
    compose.boundingBox(), side.boundingBox(), timeline.boundingBox(),
  ])
  expect(composeBox!.y).toBeLessThan(sideBox!.y)
  expect(sideBox!.y).toBeLessThan(timelineBox!.y)

  await page.goto('/dept-tasks')
  await dismissGlobalModals(page)
  const firstTask = page.locator('.dept-task-list tbody tr').first()
  if (await firstTask.count()) {
    await firstTask.click()
    await expect(page.locator('.dept-task-detail-pane')).toBeVisible()
    expect(await page.locator('.dept-task-detail-pane').evaluate((el) => getComputedStyle(el).position)).toBe('fixed')
  }
})
