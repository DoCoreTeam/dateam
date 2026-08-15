import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as XLSX from 'xlsx'

// 실 카탈로그 xlsx → AI 헤더매핑 → 184행 변환 → 검토대기 적재 → 승인 시 시장가 반영. (is_test 격리)
const XLSX_PATH = path.join(__dirname, '../../../gcube_csp_catalog_spheron_2026_0603.xlsx')

// 헤더명을 전혀 다르게 바꾸고 컬럼 순서를 뒤섞은 변형 파일 — "AI가 알아서" 매핑하는지 증명용.
function buildRenamedVariant(): string {
  const wb0 = XLSX.readFile(XLSX_PATH)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb0.Sheets[wb0.SheetNames[0]], { defval: null })
  const renamed = rows.map((r) => ({
    is_spot: r.spot,                 // 순서·이름 모두 변경
    vram: r.gpu_memory,
    provider: r.location,            // 업체/지역 복합
    model: r.gpu_name,
    hourly_usd: r.price,
    cores: r.cpu,
  }))
  const ws = XLSX.utils.json_to_sheet(renamed)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'catalog')
  const p = path.join(os.tmpdir(), 'catalog-variant.xlsx')
  XLSX.writeFile(wb, p)
  return p
}

test('카탈로그 xlsx 업로드 → AI 매핑 → 검토대기 적재 → 승인 반영', async ({ page }) => {
  test.setTimeout(150_000)

  // API 응답 캡처(매핑/카운트 검증용)
  let catalogJson: Record<string, unknown> | null = null
  page.on('response', async (res) => {
    if (res.url().includes('/api/pricing/gpu/market/catalog') && res.request().method() === 'POST') {
      try { catalogJson = await res.json() } catch { /* ignore */ }
    }
  })

  await page.goto('/pricing/gpu?tab=intake')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 테스트 데이터로 태깅 (운영 오염 방지)
  const testChk = page.locator('label:has-text("테스트 데이터로 태깅") input[type=checkbox]')
  await testChk.scrollIntoViewIfNeeded()
  await testChk.check()

  // 카탈로그 파일 업로드 (숨김 input에 직접 set)
  const fileInput = page.locator('input[type=file][accept*="xlsx"]')
  await fileInput.setInputFiles(XLSX_PATH)

  // 결과 패널 — AI 매핑·변환·적재 완료
  const result = page.getByTestId('catalog-result')
  await expect(result).toBeVisible({ timeout: 120_000 })
  await expect(result).toContainText('검토 대기')

  // API 응답 검증 — 매핑 + 적재 카운트
  await expect.poll(() => catalogJson !== null, { timeout: 10_000 }).toBeTruthy()
  const j = catalogJson as unknown as Record<string, any>
  console.log('[catalog] count=', j.count, 'total_rows=', j.total_rows, 'mapping=', JSON.stringify(j.mapping), 'ai=', JSON.stringify(j.ai))
  expect(j.count).toBeGreaterThan(0)
  expect(j.total_rows).toBe(184)
  expect(j.mapping?.competitor_name).toBeTruthy()
  expect(j.mapping?.model_name).toBeTruthy()
  expect(j.mapping?.price_usd).toBeTruthy()

  // 승인 반영 — 인증된 브라우저 세션으로 검토대기 경쟁사 항목을 confirm.
  //
  // ⚠️ 첫 항목 1건만 시도하면 안 된다. 카탈로그에는 우리 제품 목록에 없는 모델이 섞여 있고,
  //    그런 항목의 confirm은 **의도된 4xx(매칭 실패 안내)** 다 — 실패가 아니라 정상 동작이다.
  //    매칭되는 항목이 나올 때까지 훑어 "적어도 1건은 실제로 반영된다"를 확인한다.
  const confirm = await page.evaluate(async () => {
    const list = await fetch('/api/pricing/gpu/review?status=pending').then((r) => r.json())
    const items = (list.items || []).filter((it: any) => it.target === 'competitor' && it.is_test === true)
    if (items.length === 0) return { found: false, tried: 0, ok: false, lastError: null as unknown }
    let lastError: unknown = null
    for (const item of items.slice(0, 30)) {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) return { found: true, tried: items.length, ok: true, body, product: item.product_hint }
      lastError = { status: res.status, body }
    }
    return { found: true, tried: items.length, ok: false, lastError }
  })
  console.log('[confirm]', JSON.stringify(confirm))
  expect(confirm.found, '검토대기에 is_test 경쟁사 항목이 적재됨').toBeTruthy()
  expect(confirm.ok, `승인 반영 성공 0건 — 마지막 오류: ${JSON.stringify(confirm.lastError)}`).toBeTruthy()

  // 검토대기 탭에서 경쟁사 카탈로그 카드 렌더 확인(다각도 UI)
  await page.goto('/pricing/gpu?tab=review')
  await expect(page.getByTestId('competitor-review-fields').first()).toBeVisible({ timeout: 30_000 })
})

test('다각도 — 헤더명·순서가 전혀 다른 변형 파일도 AI가 알아서 매핑', async ({ page }) => {
  test.setTimeout(150_000)
  const variantPath = buildRenamedVariant()

  let catalogJson: Record<string, unknown> | null = null
  page.on('response', async (res) => {
    if (res.url().includes('/api/pricing/gpu/market/catalog') && res.request().method() === 'POST') {
      try { catalogJson = await res.json() } catch { /* ignore */ }
    }
  })

  await page.goto('/pricing/gpu?tab=intake')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await page.locator('label:has-text("테스트 데이터로 태깅") input[type=checkbox]').check()
  await page.locator('input[type=file][accept*="xlsx"]').setInputFiles(variantPath)

  await expect(page.getByTestId('catalog-result')).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => catalogJson !== null, { timeout: 10_000 }).toBeTruthy()
  const j = catalogJson as unknown as Record<string, any>
  console.log('[variant] mapping=', JSON.stringify(j.mapping), 'count=', j.count, 'ai=', JSON.stringify(j.ai))
  // AI가 바뀐 헤더명을 우리 필드로 정확히 매핑했는지 — 하드코딩 별칭으로는 불가능, 순수 AI 판단
  expect(j.mapping?.competitor_name).toBe('provider')
  expect(j.mapping?.model_name).toBe('model')
  expect(j.mapping?.price_usd).toBe('hourly_usd')
  expect(j.count).toBeGreaterThan(0)

  // 정리 — 이 변형 테스트로 적재된 검토대기는 미승인 상태로만 남으므로 곧바로 revert 대상(스크립트가 일괄 삭제)
})
