import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

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

      // 3) 공유 서브탭(.seg-tabs) 존재 + 첫 라벨 노출
      const subtabs = page.locator('.seg-tabs').first()
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
  await page.locator('.seg-tab', { hasText: '주간' }).click()
  await expect(page.locator('.seg-tab.is-active', { hasText: '주간' })).toBeVisible()

  // dept-tasks: 전체 → 완료 (state filter)
  await page.goto('/dept-tasks')
  await dismissGlobalModals(page)
  await page.locator('.seg-tab', { hasText: '완료' }).click()
  await expect(page.locator('.seg-tab.is-active', { hasText: '완료' })).toBeVisible()

  // weekly-report: 내 보고 → 팀 전체 (href ?tab=)
  await page.goto('/weekly-report')
  await dismissGlobalModals(page)
  await page.locator('.seg-tab', { hasText: '팀 전체' }).click()
  await expect(page).toHaveURL(/tab=team/)

  // projects: 프로젝트 → 현황 (state ?view=overview)
  await page.goto('/work/projects')
  await dismissGlobalModals(page)
  await page.getByTestId('view-overview').click()
  // `view`는 목록 표준(§2-6)에서 표/카드/조밀 전환에 쓰기로 했고, 현황 패널은 `panel`로 옮겼다
  // (구 링크 ?view=overview도 계속 받는다 — work/projects/page.tsx 참조).
  await expect(page).toHaveURL(/panel=overview/)
  await expect(page.locator('.seg-tab.is-active', { hasText: '현황' }).first()).toBeVisible()
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
