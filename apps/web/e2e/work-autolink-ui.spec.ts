import { test, expect } from '@playwright/test'

// 업무 플로우 패널의 "AI 자동 연결" 섹션 실렌더 검증.
test('업무 클릭 → 업무 플로우 패널에 AI 자동 연결 표시', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 업무 카드 클릭 → 플로우 패널 오픈 (content 텍스트가 보이는 첫 카드)
  await page.waitForTimeout(1500)
  const card = page.locator('text=시티큐브').first()
  await card.click()

  // AI 자동 연결 섹션 노출
  await expect(page.getByText('✦ AI 자동 연결')).toBeVisible({ timeout: 30_000 })
  // 자동 실행 후 연결 카드(확정/추천) 또는 '찾지 못함' 둘 중 하나가 떠야 함
  await page.waitForTimeout(8000)
  const hasLink = await page.locator('text=/확정|추천/').count()
  const hasEmpty = await page.locator('text=AI가 연관을 찾지 못했습니다').count()
  console.log('[ui] 연결카드:', hasLink, '빈상태:', hasEmpty)
  expect(hasLink + hasEmpty).toBeGreaterThan(0)
  await page.screenshot({ path: '../../test-results/autolink-panel.png', fullPage: false })
})
