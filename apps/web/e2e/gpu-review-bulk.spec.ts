import { test, expect } from '@playwright/test'
import * as path from 'path'

// 검토대기 일괄 삭제 + 공급사/경쟁사 필터 검증.
// 안전: is_test 카탈로그 항목을 직접 만들어 그 범위만 삭제 — 사용자 기존 데이터 미접촉.
const XLSX_PATH = path.join(__dirname, '../../../gcube_csp_catalog_spheron_2026_0603.xlsx')

test('검토대기 — 필터 렌더 + is_test 카탈로그 일괄 삭제', async ({ page }) => {
  test.setTimeout(150_000)

  // 1) is_test 카탈로그 적재
  await page.goto('/pricing/gpu?tab=intake')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await page.locator('label:has-text("테스트 데이터로 태깅") input[type=checkbox]').check()
  await page.locator('input[type=file][accept*="xlsx"]').setInputFiles(XLSX_PATH)
  await expect(page.getByTestId('catalog-result')).toBeVisible({ timeout: 120_000 })

  // 2) 검토대기 탭 — 필터 버튼 렌더 확인
  await page.goto('/pricing/gpu?tab=review')
  await expect(page.getByRole('button', { name: /전체 \d+/ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /경쟁사 \d+/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /공급사 \d+/ })).toBeVisible()

  // 3) is_test 카탈로그 항목만 골라 일괄 삭제(엔드포인트 검증, 사용자 데이터 미접촉)
  const result = await page.evaluate(async () => {
    const list = await fetch('/api/pricing/gpu/review?status=pending').then((r) => r.json())
    const ids = (list.items || [])
      .filter((it: any) => it.is_test === true && it.target === 'competitor' && it.channel === 'catalog')
      .map((it: any) => it.id)
    if (ids.length === 0) return { before: 0, deleted: 0 }
    const res = await fetch('/api/pricing/gpu/review/bulk', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids, action: 'delete' }),
    })
    const body = await res.json().catch(() => ({}))
    // 삭제 후 잔여 is_test 카탈로그 확인
    const list2 = await fetch('/api/pricing/gpu/review?status=pending').then((r) => r.json())
    const remain = (list2.items || []).filter((it: any) => it.is_test === true && it.channel === 'catalog').length
    return { before: ids.length, ok: res.ok, deleted: body.deleted, remain }
  })
  console.log('[bulk-delete]', JSON.stringify(result))
  expect(result.before).toBeGreaterThan(0)
  expect(result.ok).toBeTruthy()
  expect(result.deleted).toBe(result.before)
  expect(result.remain).toBe(0)
})
