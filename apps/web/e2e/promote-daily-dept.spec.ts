import { test, expect } from '@playwright/test'
import { getMyUserId } from './_helpers'

// 일일 → 부서업무 등록(참조, 멱등) API 검증.
//
// ⚠️ 예전엔 **실제 사용자 업무 id를 하드코딩**해 승격했다. 그래서 (a) 남의 업무가 부서업무로
//    올라가 그대로 남고 (b) 멱등 차단 때문에 두 번째 실행부터는 1차 등록이 실패해 **영구히 빨간불**이
//    된다(원본 1건당 한 번뿐). 검사 전용 원본을 만들고 끝나면 지운다.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const H = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  ...extra,
})
const rest = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`
const kstToday = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) // kst-ok

test('일일→부서업무 등록(참조, 멱등)', async ({ page }) => {
  test.setTimeout(90_000)
  test.skip(!SERVICE_ROLE || !SUPABASE_URL, 'SERVICE_ROLE 미설정 — 격리된 원본을 만들 수 없음')

  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const owner = await getMyUserId(page)
  test.skip(!owner, '세션 사용자 id를 확인할 수 없음(개인 일일업무 0건)')

  // 등록 대상 부서 — 화면이 쓰는 것과 같은 목록에서 고른다(하드코딩 금지).
  const deptRes = await page.request.get('/api/work/departments')
  expect(deptRes.ok(), '부서 목록 조회').toBeTruthy()
  const { departments } = (await deptRes.json()) as { departments: Array<{ id: string }> }
  test.skip(!departments?.length, '등록 가능한 부서가 없음')
  const departmentId = departments[0].id

  const created = await fetch(rest('daily_logs'), {
    method: 'POST',
    headers: H({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: owner,
      log_date: kstToday(),
      logged_at: new Date().toISOString(),
      content: '[TEST-E2E] 부서업무 승격 멱등 검증',
      entry_type: 'planned',
      task_kind: 'personal',
    }),
  })
  expect(created.ok, '테스트 원본 생성').toBeTruthy()
  const [srcLog] = (await created.json()) as Array<{ id: string }>
  const sourceLogId = srcLog?.id
  expect(sourceLogId).toBeTruthy()

  try {
    const r = await page.evaluate(async ({ sourceLogId, departmentId }) => {
      const call = async () => {
        const res = await fetch('/api/work/promote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceLogId, departmentId }),
        })
        return { ok: res.ok, body: await res.json().catch(() => ({})) }
      }
      const first = await call()
      const second = await call()
      return { first, second }
    }, { sourceLogId, departmentId })
    console.log('[promote]', JSON.stringify(r))

    expect(r.first.ok, `1차 등록 성공 — 응답: ${JSON.stringify(r.first.body)}`).toBeTruthy()
    expect(r.first.body.id).toBeTruthy()
    expect(r.second.ok, '2차는 멱등 차단이어야 함').toBeFalsy()
    expect(String(r.second.body.error ?? '')).toContain('이미 부서업무로 등록')
  } finally {
    await fetch(rest(`daily_logs?promoted_from_log_id=eq.${sourceLogId}`), { method: 'DELETE', headers: H() })
    await fetch(rest(`daily_logs?id=eq.${sourceLogId}`), { method: 'DELETE', headers: H() })
  }
})
