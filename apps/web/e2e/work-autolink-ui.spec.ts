import { test, expect } from '@playwright/test'
import { dismissGlobalModals, expandAllOriginGroups, findDailyDateWithLogs, waitForDailyContent } from './_helpers'

// 업무 플로우 패널의 "AI 자동 연결" 섹션 실렌더 검증.
test('업무 클릭 → 업무 플로우 패널에 AI 자동 연결 표시', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 특정 업무 이름('시티큐브')을 하드코딩하면 그 기록이 오래돼 화면에서 사라지는 순간 죽는다.
  // 기록이 있는 날짜를 찾아가 **첫 업무 카드**를 연다 — 어떤 업무든 플로우 패널 계약은 같다.
  const date = await findDailyDateWithLogs(page)
  test.skip(!date, '최근 20주에 개인 일일업무가 없어 플로우 패널을 열 수 없음')
  await page.goto(`/daily?date=${date}`)
  await dismissGlobalModals(page)
  // 목록이 그려지기 전에 세면 0이 나온다 — 렌더를 기다린 뒤 그룹을 펼친다.
  test.skip(!(await waitForDailyContent(page)), `${date}에 렌더된 업무가 없음`)
  await expandAllOriginGroups(page)

  const card = page.locator('.daily-log-card').first()
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.click()

  // AI 자동 연결 섹션 노출
  await expect(page.getByText('✦ AI 자동 연결')).toBeVisible({ timeout: 30_000 })
  // 자동 실행 후 연결 카드(확정/추천) 또는 '찾지 못함' 둘 중 하나가 떠야 함
  await expect
    .poll(async () => {
      const hasLink = await page.locator('text=/확정|추천/').count()
      const hasEmpty = await page.getByText('AI가 연관을 찾지 못했습니다').count()
      return hasLink + hasEmpty
    }, { timeout: 60_000 })
    .toBeGreaterThan(0)
  await page.screenshot({ path: '../../test-results/autolink-panel.png', fullPage: false })
})
