import { test, expect } from '@playwright/test'
import * as fs from 'fs'

// USAI 실UI 검증 — 비정형 다중블록 타겟 xlsx를 통합입력에 올려 검토대기에 정상 흡수되는지.
// throwaway 관리자 비번 로그인 + is_test 태깅(운영 오염 방지). GPU_USAI_INGEST=1 dev 서버 전제.
const EMAIL = process.env.E2E_EMAIL!
const PASSWORD = process.env.E2E_PASSWORD!
const XLSX_PATH = process.env.USAI_XLSX!

test('USAI: 타겟 xlsx 업로드 → 검토대기 정상 적재(own_target·needs_human)', async ({ page }) => {
  // 전용 환경 필요(throwaway 계정 + GPU_USAI_INGEST=1 서버) — 미설정 시 기본 suite에서 스킵.
  test.skip(!process.env.E2E_EMAIL || !process.env.USAI_XLSX, 'USAI E2E는 throwaway 자격증명+플래그 서버 필요')
  test.setTimeout(180_000)

  // 로그인(비번)
  await page.goto('/login')
  await page.fill('input[name="email"]', EMAIL)
  await page.fill('input[name="password"]', PASSWORD)
  await page.click('button[type="submit"]')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 })

  // 첫 접속 모달(업데이트 안내/리마인더) 닫기 — 백드롭이 클릭 가로챔
  for (let i = 0; i < 4; i++) {
    const backdrop = page.locator('.modal-backdrop')
    if (await backdrop.count() === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(400)
  }

  await page.goto('/pricing/gpu?tab=intake')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  // 실 route 직접 호출(인증 세션 유지) — 드롭존 자동제출 미지원 우회. 실 Gemini+DB 전 경로.
  const b64 = fs.readFileSync(XLSX_PATH).toString('base64')
  const j = await page.evaluate(async ({ b64, name }) => {
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const fd = new FormData()
    fd.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
    fd.append('is_test', 'true')
    const res = await fetch('/api/pricing/gpu/market/catalog', { method: 'POST', body: fd })
    return { status: res.status, body: await res.json().catch(() => null) }
  }, { b64, name: 'target.xlsx' })

  console.log('[USAI catalog response]', JSON.stringify(j))
  expect(j.status).toBe(200)
  expect(j.body?.engine).toBe('usai')
  expect(j.body?.count).toBeGreaterThan(0)

  // 검토대기 화면 read-only 스크린샷
  await page.goto('/pricing/gpu?tab=board')
  await page.waitForTimeout(3000)
  await page.screenshot({ path: 'e2e/usai-intake-result.png', fullPage: true })
})
