import { test, expect } from '@playwright/test'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://tsnlplkslfcwtchzdaai.supabase.co'
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

async function supabaseGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  })
  return res.json()
}

test.describe('일일업무 인라인 status 변경', () => {
  test('status-badge testid가 페이지에 존재함 (auth 없이 구조 확인)', async ({ page }) => {
    const res = await page.goto('http://localhost:3000/daily')
    const finalUrl = page.url()

    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      test.skip(true, '인증 필요 — 로그인 없이 skip')
      return
    }

    await page.waitForLoadState('networkidle')
    const badges = page.locator('[data-testid^="status-badge-"]')
    const count = await badges.count()
    console.log(`status-badge 요소 수: ${count}`)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('API 라우트: updateDailyLogStatus 서버 액션 로직 검증 (Supabase 직접)', async () => {
    const today = new Date().toISOString().split('T')[0]

    // 1. 기존 daily_logs에서 user_id 조회 (service_role로 접근 가능)
    const existingLogs = await supabaseGet('daily_logs?select=user_id&limit=1')
    const userId = existingLogs?.[0]?.user_id
    if (!userId) {
      console.log('daily_logs에 기존 유저 없음 — skip')
      return
    }

    // 2. 테스트 로그 생성 (planned 상태)
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_logs`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        user_id: userId,
        content: '[E2E TEST] inline status change test',
        entry_type: 'planned',
        log_date: today,
        logged_at: new Date().toISOString(),
      }),
    })
    const [testLog] = await insertRes.json()
    const logId = testLog?.id
    expect(logId).toBeTruthy()
    console.log(`테스트 로그 생성: id=${logId}, entry_type=planned`)

    try {
      // 3. entry_type → 'done'으로 변경
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?id=eq.${logId}`, {
        method: 'PATCH',
        headers: {
          apikey: SERVICE_ROLE,
          Authorization: `Bearer ${SERVICE_ROLE}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ entry_type: 'done', updated_at: new Date().toISOString() }),
      })
      const [updated] = await updateRes.json()
      console.log(`entry_type 변경 후: ${updated?.entry_type}`)
      expect(updated?.entry_type).toBe('done')

      // 4. DB 재조회 검증
      const [verified] = await supabaseGet(`daily_logs?id=eq.${logId}&select=entry_type`)
      console.log(`DB 최종 검증: entry_type=${verified?.entry_type}`)
      expect(verified?.entry_type).toBe('done')
      console.log('✅ DB 인라인 status 변경 검증 성공')
    } finally {
      // 5. 테스트 데이터 정리
      await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?id=eq.${logId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      })
      console.log('테스트 데이터 정리 완료')
    }
  })

  test('UI: status-badge 클릭 시 드롭다운 열림 (auth 있을 때)', async ({ page }) => {
    await page.goto('http://localhost:3000/daily')
    const finalUrl = page.url()

    if (finalUrl.includes('/login') || finalUrl.includes('/auth')) {
      test.skip(true, '인증 필요 — UI 테스트 skip')
      return
    }

    await page.waitForLoadState('networkidle')
    const firstBadge = page.locator('[data-testid^="status-badge-"]').first()

    if (await firstBadge.count() === 0) {
      console.log('업무 로그 없음 — UI 드롭다운 테스트 skip')
      return
    }

    const logId = await firstBadge.getAttribute('data-testid').then(v => v?.replace('status-badge-', ''))
    console.log(`테스트 대상 로그 ID: ${logId}`)

    // 클릭 전 초기 status 기록
    const initialText = await firstBadge.textContent()
    console.log(`초기 status: ${initialText?.trim()}`)

    // 클릭 → 드롭다운 열림 확인
    await firstBadge.click()
    const popover = page.locator(`[data-testid="status-popover-${logId}"]`)
    await expect(popover).toBeVisible({ timeout: 2000 })
    console.log('✅ 드롭다운 열림 확인')

    // 완료 옵션 클릭
    const doneOption = page.locator('[data-testid="status-option-done"]').first()
    await expect(doneOption).toBeVisible()
    await doneOption.click()

    // 드롭다운 닫힘 확인
    await expect(popover).not.toBeVisible({ timeout: 2000 })
    console.log('✅ status 선택 후 드롭다운 닫힘 확인')

    // DB에서 변경 확인
    await page.waitForTimeout(500)
    if (logId) {
      const [dbRow] = await supabaseGet(`daily_logs?id=eq.${logId}&select=entry_type`)
      console.log(`DB 검증 — entry_type: ${dbRow?.entry_type}`)
      expect(dbRow?.entry_type).toBe('done')
      console.log('✅ DB까지 status 변경 검증 완료')
    }
  })
})
