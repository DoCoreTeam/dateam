import { test, expect } from '@playwright/test'

// v0.7.377 검증 — GPU 관리 스펙 탭에서 H100이 폼팩터 하위그룹을 가진 1종으로 뜨는지 + 회귀 없는지.
test('GPU 관리: H100이 1종(폼팩터 하위그룹)으로 그룹핑', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto('/pricing/gpu?tab=specs')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 스펙 테이블 로딩 대기 (변경내역 모달 뒤에 있어도 visible)
  await expect(page.locator('table.table-base').first()).toBeVisible({ timeout: 20_000 })

  // "폼팩터 N" 배지 = H100 등 다변형 base 그룹 존재
  await expect(page.getByText('폼팩터', { exact: false }).first()).toBeVisible({ timeout: 10_000 })

  // "새로운 소식" 변경내역 모달이 떠 있으면 닫기(오버레이가 클릭 가로챔)
  for (let i = 0; i < 4; i++) {
    if (await page.locator('.modal-backdrop').count() === 0) break
    await page.locator('.modal-backdrop').first().click({ position: { x: 5, y: 5 } }).catch(() => {})
    await page.waitForTimeout(400)
  }

  // H100 base 행 클릭 → 확장 → 폼팩터 변형(SXM/PCIe/NVL) 행 노출
  const h100Base = page.locator('tr', { has: page.locator('td.card-header', { hasText: 'H100' }) }).filter({ hasText: '폼팩터' }).first()
  await h100Base.click()
  // 확장 후 변형 라벨(SXM/PCIe/NVL 중 하나) 노출 확인
  await expect(page.getByText('H100 SXM', { exact: false }).first()).toBeVisible({ timeout: 8_000 })
  await expect(page.getByText('H100 NVL', { exact: false }).first()).toBeVisible({ timeout: 8_000 })

  expect(errors.join('\n')).not.toMatch(/TypeError|is not a function|Cannot read/)
})

// 회귀 — GPU 목록을 공유하는 다른 탭들이 정상 로딩되는지(가격표/시장/재고)
for (const tab of ['cockpit', 'market', 'inventory']) {
  test(`회귀: ${tab} 탭 정상 로딩`, async ({ page }) => {
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    await page.goto(`/pricing/gpu?tab=${tab}`)
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
    await expect(page.locator('body')).toBeVisible()
    await page.waitForTimeout(2500)
    expect(errors.join('\n')).not.toMatch(/TypeError|is not a function|Cannot read|Unhandled/)
  })
}
