import { test, expect } from '@playwright/test'

// 자동 패치노트 팝업(새 버전)을 끄기 위해 seen을 높은 버전으로 미리 주입.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('changelog_seen_version', '999.999.999')
      sessionStorage.setItem('friday-spotlight-dismissed', '1')
    } catch { /* noop */ }
  })
})

async function dismissAutoModals(page: import('@playwright/test').Page) {
  // 자동 모달(주간리마인더·friday-spotlight·changelog 등)이 클릭을 가로챔 → Escape + 백드롭 코너 클릭으로 정리.
  const sel = '.modal-backdrop, [role="dialog"][aria-modal="true"], .friday-spotlight-overlay'
  for (let i = 0; i < 8; i++) {
    if (await page.locator(sel).count() === 0) break
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    if (await page.locator('.modal-backdrop').count() > 0)
      await page.locator('.modal-backdrop').first().click({ position: { x: 4, y: 4 } }).catch(() => {})
    await page.waitForTimeout(300)
  }
}

test('계정 메뉴에서 패치노트 열기 → 모달 제목이 "패치노트"', async ({ page }) => {
  await page.goto('/home')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await dismissAutoModals(page)
  await page.getByTestId('sidebar-profile-trigger').click()
  const item = page.getByRole('button', { name: '패치노트', exact: true })
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  await expect(page.locator('[role="dialog"][aria-label="패치노트"]')).toBeVisible({ timeout: 5000 })
})

test('전체 메뉴에 패치노트 항목 존재 → 클릭 시 모달', async ({ page }) => {
  await page.goto('/home')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await dismissAutoModals(page)
  await page.getByRole('button', { name: '전체 메뉴' }).click()
  const item = page.getByRole('button', { name: '패치노트', exact: true })
  await expect(item).toBeVisible({ timeout: 5000 })
  await item.click()
  await expect(page.locator('[role="dialog"][aria-label="패치노트"]')).toBeVisible({ timeout: 5000 })
})
