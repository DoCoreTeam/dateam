import { test, expect } from '@playwright/test'

// D 검증: 일일 새 입력 — 임시저장(새로고침 유지) + 복원 배너 + Ctrl+Z 되돌리기.
test('임시저장 새로고침 유지 + 복원 + Undo', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const ta = page.locator('textarea').first()
  await ta.click()
  // 깨끗한 출발 — 기존 draft 제거
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('draft:v1:')).forEach(k => localStorage.removeItem(k)) })

  // 1) 입력 → localStorage draft 저장(디바운스 500ms)
  await ta.fill('임시저장 테스트 — 새로고침해도 유지되어야 함')
  await page.waitForTimeout(800)
  const saved = await page.evaluate(() => Object.keys(localStorage).find(k => k.startsWith('draft:v1:') && k.includes('daily-new')))
  expect(saved).toBeTruthy()

  // 2) 새로고침 → 복원 배너 노출
  await page.reload()
  const banner = page.getByTestId('draft-restore-banner')
  await expect(banner).toBeVisible({ timeout: 15_000 })

  // 3) 복원 클릭 → textarea에 값 복원
  await page.getByTestId('draft-restore-btn').click()
  await expect(page.locator('textarea').first()).toHaveValue(/임시저장 테스트/)

  // 4) Ctrl+Z 되돌리기 — 추가 입력 후 undo로 직전 상태 복귀
  const ta2 = page.locator('textarea').first()
  await ta2.click()
  await ta2.fill('완전히 다른 내용')
  await page.waitForTimeout(100)
  const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.press(`${mod}+z`)
  // undo 후 값이 '완전히 다른 내용'이 아니어야(직전 스냅샷으로)
  await expect(ta2).not.toHaveValue('완전히 다른 내용', { timeout: 5000 })

  // 정리
  await page.evaluate(() => { Object.keys(localStorage).filter(k => k.startsWith('draft:v1:')).forEach(k => localStorage.removeItem(k)) })
})
