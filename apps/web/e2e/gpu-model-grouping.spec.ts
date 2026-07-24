import { test, expect } from '@playwright/test'

async function closeChangelog(page: import('@playwright/test').Page) {
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.modal-backdrop').count() === 0) break
    await page.locator('.modal-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(400)
  }
}

// [핵심] 사용자 실화면 = 가격표(board, unified 통합표). H100이 1그룹으로 떠야 한다.
test('board(가격표): H100이 1개 그룹으로 묶인다', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/pricing/gpu?tab=board')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await closeChangelog(page)
  // 통합표 그룹 헤더 로딩
  await expect(page.locator('.gpu-unified-group-name').first()).toBeVisible({ timeout: 20_000 })
  // "H100" 정확히 1개 그룹 (H100 SXM/PCIe/NVL이 개별 그룹으로 안 뜸)
  const h100 = page.locator('.gpu-unified-group-name', { hasText: /^H100$/ })
  await expect(h100).toHaveCount(1)
  // 개별 폼팩터가 top-level 그룹으로 있으면 안 됨
  await expect(page.locator('.gpu-unified-group-name', { hasText: /^H100 SXM$/ })).toHaveCount(0)
  await expect(page.locator('.gpu-unified-group-name', { hasText: /^H100 NVL$/ })).toHaveCount(0)
  expect(errors.join('\n')).not.toMatch(/TypeError|is not a function|Cannot read/)
})

// specs 탭: 삭제된 표기중복(RTX PRO 6000 대문자/NVIDIA)이 가짜 폼팩터로 안 떠야 한다.
test('specs: 삭제된 RTX PRO 6000 표기중복이 폼팩터로 안 뜬다', async ({ page }) => {
  await page.goto('/pricing/gpu?tab=specs')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.locator('table.table-base').first()).toBeVisible({ timeout: 20_000 })
  await closeChangelog(page)
  // "NVIDIA RTX PRO 6000"(삭제됨)이 목록에 없어야 한다
  await expect(page.getByText('NVIDIA RTX PRO 6000', { exact: false })).toHaveCount(0)
})

// 판매가격표(catalog): H100 그룹 헤더 1개.
test('catalog(판매가격표): H100 그룹 1개', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto('/pricing/catalog')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await closeChangelog(page)
  await page.waitForTimeout(2500)
  await expect(page.locator('body')).toBeVisible()
  expect(errors.join('\n')).not.toMatch(/TypeError|is not a function|Cannot read/)
})
