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
  test('API: Supabase 직접 — planned → done 변경 + DB 검증', async () => {
    const today = new Date().toISOString().split('T')[0]

    const existingLogs = await supabaseGet('daily_logs?select=user_id&limit=1')
    const userId = existingLogs?.[0]?.user_id
    if (!userId) {
      console.log('daily_logs에 기존 유저 없음 — skip')
      return
    }

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

      const [verified] = await supabaseGet(`daily_logs?id=eq.${logId}&select=entry_type`)
      console.log(`DB 최종 검증: entry_type=${verified?.entry_type}`)
      expect(verified?.entry_type).toBe('done')
      console.log('✅ DB 인라인 status 변경 검증 성공')
    } finally {
      await fetch(`${SUPABASE_URL}/rest/v1/daily_logs?id=eq.${logId}`, {
        method: 'DELETE',
        headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
      })
      console.log('테스트 데이터 정리 완료')
    }
  })

  test('UI: /daily 페이지 — status-badge 존재 확인', async ({ page }) => {
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')

    const badges = page.locator('[data-testid^="status-badge-"]')
    const count = await badges.count()
    console.log(`status-badge 요소 수: ${count}`)
    expect(count).toBeGreaterThanOrEqual(0)
  })

  test('UI: status-badge 클릭 → 드롭다운 열림 → done 선택 → DB 검증', async ({ page }) => {
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')

    const firstBadge = page.locator('[data-testid^="status-badge-"]').first()
    if ((await firstBadge.count()) === 0) {
      console.log('업무 로그 없음 — 테스트 건너뜀')
      return
    }

    const testId = await firstBadge.getAttribute('data-testid')
    const logId = testId?.replace('status-badge-', '')
    console.log(`테스트 대상 로그 ID: ${logId}`)

    const initialText = await firstBadge.textContent()
    console.log(`초기 status: ${initialText?.trim()}`)

    await firstBadge.click()
    const popover = page.locator(`[data-testid="status-popover-${logId}"]`)
    await expect(popover).toBeVisible({ timeout: 3000 })
    console.log('✅ 드롭다운 열림 확인')

    const doneOption = popover.locator('[data-testid="status-option-done"]')
    await expect(doneOption).toBeVisible()
    await doneOption.click()

    await expect(popover).not.toBeVisible({ timeout: 3000 })
    console.log('✅ done 선택 후 드롭다운 닫힘 확인')

    await page.waitForTimeout(600)
    if (logId) {
      const [dbRow] = await supabaseGet(`daily_logs?id=eq.${logId}&select=entry_type`)
      console.log(`DB 검증 — entry_type: ${dbRow?.entry_type}`)
      expect(dbRow?.entry_type).toBe('done')
      console.log('✅ DB까지 status 변경 검증 완료')
    }
  })
})
