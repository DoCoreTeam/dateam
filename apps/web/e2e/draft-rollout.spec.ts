import { test, expect } from '@playwright/test'
test('리드 인테이크 임시저장 새로고침 유지', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/lead-intake'); await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('draft:v1:')).forEach(k => localStorage.removeItem(k)))
  const ta = page.locator('textarea').first()
  await ta.fill('리드 임시저장 검증 — 삼성SDS 김철수 부장')
  // 임시저장은 (a) 입력 디바운스 500ms + (b) draft 키 네임스페이스용 사용자 id 해석(비동기)
  // 두 가지를 기다려야 한다. 고정 800ms는 dev 서버가 느린 날 그냥 깨진다 — 조건으로 기다린다.
  await expect
    .poll(() => page.evaluate(() => Object.keys(localStorage).some(k => k.includes('lead-intake'))), { timeout: 15_000 })
    .toBe(true)
  await page.reload()
  await expect(page.getByTestId('draft-restore-banner')).toBeVisible({ timeout: 15_000 })
  await page.getByTestId('draft-restore-btn').click()
  await expect(page.locator('textarea').first()).toHaveValue(/삼성SDS/)
  await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('draft:v1:')).forEach(k => localStorage.removeItem(k)))
})
