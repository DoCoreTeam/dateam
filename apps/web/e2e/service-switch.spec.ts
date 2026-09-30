/**
 * 계정 메뉴에서 옆으로 간다 (§2-3-3 N-6)
 *
 * 사용자 지적 2026-09-30: 「각 서비스에서 계정 메뉴에서 다른 서비스로 이동할 수 있도록
 * 구현되어 있는걸로 알고 있었는데?」 — 그 길이 없었다. 단위 시험은 목록을 재지만
 * **화면에 뜨는지**는 못 잰다. 그래서 실브라우저가 메뉴를 열어 본다.
 */
import { test, expect } from '@playwright/test'

test('AI 트레이딩 계정 메뉴에 다른 서비스로 가는 길이 있다', async ({ page }) => {
  await page.goto('/trading')
  await page.getByTestId('sidebar-profile-trigger').click()
  const entry = page.getByRole('button', { name: '다른 서비스로' })
  await expect(entry).toBeVisible()
  await entry.click()
  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: '영업 CRM' }) })
  await expect(menu.getByRole('menuitem', { name: '영업 CRM' })).toBeVisible()
  // 지금 자리도 그린다 — 빼면 내가 어디 있는지 목록이 말을 안 한다
  await expect(menu.getByRole('menuitem', { name: 'AI 트레이딩' })).toHaveAttribute('aria-current', 'page')
})

test('업무 화면에서는 안 뜬다 — 사이드바 「서비스」 묶음이 그 자리다', async ({ page }) => {
  await page.goto('/home')
  await page.getByTestId('sidebar-profile-trigger').click()
  await expect(page.getByRole('button', { name: '다른 서비스로' })).toHaveCount(0)
})
