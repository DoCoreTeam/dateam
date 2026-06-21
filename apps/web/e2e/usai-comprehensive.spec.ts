import { test, expect } from '@playwright/test'
import * as fs from 'fs'

// USAI 포괄 검증 — 타겟 xlsx 재흡수 + own_target 확정→전략가 반영 + gcube(경쟁사 카탈로그) 흡수.
// throwaway 관리자, is_test 태깅. GPU_USAI_INGEST=1 dev 서버 전제. (전략가 변경은 teardown에서 원복)
const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!
const TARGET = process.env.USAI_TARGET!
const GCUBE = process.env.USAI_GCUBE!

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })
}

async function uploadCatalog(page: import('@playwright/test').Page, filePath: string, name: string) {
  const b64 = fs.readFileSync(filePath).toString('base64')
  return page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
    fd.append('is_test', 'true')
    const res = await fetch('/api/pricing/gpu/market/catalog', { method: 'POST', body: fd })
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { b64, name })
}

test('USAI 포괄: 타겟 재흡수 + own_target→전략가 + gcube', async ({ page }) => {
  test.setTimeout(300_000)
  test.skip(!EMAIL || !TARGET, 'throwaway 자격증명+파일 필요')
  await login(page)

  // ── 1) 타겟 xlsx 재흡수 (이전과 동일 결과 확인) ──
  const t = await uploadCatalog(page, TARGET, 'target.xlsx')
  console.log('[TARGET]', JSON.stringify(t.body))
  expect(t.status).toBe(200)
  expect(t.body.engine).toBe('usai')
  expect(t.body.count).toBeGreaterThan(0)
  const t4 = (t.body.sample as Array<Record<string, unknown>>).find((s) => s.model_name === 'T4')
  expect(t4?.target).toBe('own_target')
  expect(Math.abs((t4?.unit_price_usd as number) - 0.81)).toBeLessThan(0.05)

  // ── 2) own_target on_demand 항목 확정 → 전략가 반영 ──
  const list = await page.evaluate(async () => {
    const r = await fetch('/api/pricing/gpu/review?status=pending')
    return r.json()
  }) as { items: Array<{ id: string; target: string; is_test: boolean; current_extracted: Record<string, unknown> }> }
  const owns = list.items.filter((it) =>
    it.target === 'own_target' && it.is_test === true &&
    (it.current_extracted?.term === 'on_demand' || !it.current_extracted?.term))
  expect(owns.length, 'own_target on_demand 검토항목 존재').toBeGreaterThan(0)

  // 존재하는 제품에 매칭되는 첫 항목까지 순회 확정(미매칭 모델은 graceful 422 — 정상 동작).
  let confirmed: { status: number; body: Record<string, unknown> } | null = null
  for (const own of owns) {
    const r = await page.evaluate(async (id) => {
      const res = await fetch('/api/pricing/gpu/review/' + id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'confirm' }),
      })
      return { status: res.status, body: await res.json().catch(() => null) }
    }, own.id)
    console.log(`[CONFIRM ${String(own.current_extracted?.model_name)}]`, JSON.stringify(r))
    if (r.status === 200) { confirmed = r; break }
  }
  expect(confirmed, '최소 1개 own_target이 전략가로 반영됨').toBeTruthy()
  expect(confirmed!.body.ok).toBe(true)
  expect((confirmed!.body.strategic as Record<string, number>)?.strategic_price_krw).toBeGreaterThan(0)

  // ── 3) gcube 경쟁사 카탈로그 흡수 (다른 파일·다른 구조) ──
  const g = await uploadCatalog(page, GCUBE, 'gcube.xlsx')
  console.log('[GCUBE]', JSON.stringify(g.body))
  expect(g.status).toBe(200)
  expect(g.body.engine).toBe('usai')
  expect(g.body.count).toBeGreaterThan(0)

  // ── 4) 검토대기 화면 스크린샷 ──
  await page.goto('/pricing/gpu?tab=board')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'e2e/usai-comprehensive-board.png', fullPage: true })
})
