import { test, expect } from '@playwright/test'
test('일일 행 승격 UI — 그룹 펼침→승격 클릭→승격됨', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/daily'); await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  // 로그 있는 날로 이동(오늘 비어있을 수 있음) — 그룹 토글이 보일 때까지
  const toggle = page.getByTestId('origin-group-toggle').first()
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(700)
    if (await toggle.count() > 0) break
    await page.getByRole('button', { name: '이전 날' }).click()
  }
  // 그룹 펼치기 → 내부 행의 승격 버튼 노출
  if (await toggle.count() > 0) await toggle.click()
  await page.waitForTimeout(800)
  const btn = page.locator('[data-testid^="promote-btn-"]').first()
  await expect(btn).toBeVisible({ timeout: 15_000 })
  await btn.click()
  await page.waitForTimeout(1200)
  await page.locator('[data-testid^="promote-confirm-"]').first().click()
  await expect(page.locator('text=↗ 승격됨').first()).toBeVisible({ timeout: 15_000 })
})
