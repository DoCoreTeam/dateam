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
  //
  // ⚠️ 목록 API는 `.limit(200)`이고 페이지네이션이 없다. 한 번만 지우면 다음 200건이 다시 올라와
  //    "잔여 0"에 절대 못 닿는다(실측: 지운 뒤에도 200 그대로). 비워질 때까지 회차를 돈다.
  //    삭제 대상 조건과 잔여 확인 조건은 **같아야 한다** — 예전엔 지울 땐 competitor만 보고
  //    남은 걸 셀 땐 target 무관하게 세서, 조건이 어긋나면 영원히 실패했다.
  const result = await page.evaluate(async () => {
    const isTestCatalog = (it: any) => it.is_test === true && it.channel === 'catalog'
    const pending = async () =>
      (await fetch('/api/pricing/gpu/review?status=pending').then((r) => r.json())).items || []

    let before = 0
    let deleted = 0
    let ok = true
    for (let round = 0; round < 20; round += 1) {
      const ids = (await pending()).filter(isTestCatalog).map((it: any) => it.id)
      if (ids.length === 0) break
      before += ids.length
      const res = await fetch('/api/pricing/gpu/review/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete' }),
      })
      if (!res.ok) { ok = false; break }
      const body = await res.json().catch(() => ({}))
      deleted += body.deleted ?? 0
    }
    const remain = (await pending()).filter(isTestCatalog).length
    return { before, ok, deleted, remain }
  })
  console.log('[bulk-delete]', JSON.stringify(result))
  expect(result.before).toBeGreaterThan(0)
  expect(result.ok).toBeTruthy()
  expect(result.deleted).toBe(result.before)
  expect(result.remain).toBe(0)
})
