import { test, expect } from '@playwright/test'

// 부서 업무 — DB 무결성 E2E (Supabase REST + service role).
// 트리거(076)는 service role도 우회 못 하므로 REST로 트리거 동작을 직접 검증.
// 모든 데이터는 [TEST]/aaaa0000- 표식 + 종료 시 정리. 운영 무오염.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://tsnlplkslfcwtchzdaai.supabase.co'
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

const H = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  ...extra,
})
const rest = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`
const DEPT = 'aaaa0000-0000-4eee-8000-0000000000d1'

async function cleanup() {
  await fetch(rest(`daily_logs?content=like.%5BTEST-E2E%5D*`), { method: 'DELETE', headers: H() })
  // 자식 person 노드 먼저 삭제(부모 FK 잔존 방지) → closure → 부서 노드
  await fetch(rest(`org_nodes?parent_id=eq.${DEPT}`), { method: 'DELETE', headers: H() })
  await fetch(rest(`org_node_closure?or=(ancestor_id.eq.${DEPT},descendant_id.eq.${DEPT})`), { method: 'DELETE', headers: H() })
  await fetch(rest(`org_nodes?id=eq.${DEPT}`), { method: 'DELETE', headers: H() })
}

test.describe('부서 업무 무결성 (트리거 076)', () => {
  test('담당자 부서소속 강제 — 소속 허용 / 비소속 거부', async () => {
    if (!SERVICE_ROLE) { test.skip(true, 'SERVICE_ROLE 미설정'); return }

    // 루트 + 부서원/비부서원 후보 확보
    const rootRes = await fetch(rest('org_nodes?parent_id=is.null&select=id&limit=1'), { headers: H() })
    const root = (await rootRes.json())?.[0]?.id
    const personsRes = await fetch(rest("org_nodes?type=eq.person&user_id=not.is.null&select=user_id&limit=1"), { headers: H() })
    const persons = await personsRes.json()
    if (!root || !Array.isArray(persons) || persons.length < 1) { test.skip(true, '조직 데이터 부족'); return }

    const memberInDept = persons[0].user_id as string
    // 비소속: memberInDept와 다른 실제 프로필 — 갓 만든 [TEST] 부서 서브트리 밖이 보장됨
    const outRes = await fetch(rest(`profiles?id=neq.${memberInDept}&deleted_at=is.null&select=id&limit=1`), { headers: H() })
    const outsider = (await outRes.json())?.[0]?.id as string | undefined

    await cleanup()
    // [TEST] 부서 + 소속 person 생성
    let r = await fetch(rest('org_nodes'), { method: 'POST', headers: H({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ id: DEPT, type: 'department', parent_id: root, name: '[TEST-E2E]부서', display_order: 990 }) })
    expect(r.ok, 'dept 생성').toBeTruthy()
    r = await fetch(rest('org_nodes'), { method: 'POST', headers: H({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ type: 'person', parent_id: DEPT, name: '[TEST-E2E]소속원', display_order: 1, user_id: memberInDept }) })
    expect(r.ok, 'person 생성').toBeTruthy()

    // 1) 소속원 담당 → 성공 기대
    const okRes = await fetch(rest('daily_logs'), { method: 'POST', headers: H({ Prefer: 'return=representation' }),
      body: JSON.stringify({ user_id: memberInDept, log_date: new Date().toISOString().slice(0, 10), content: '[TEST-E2E]부서업무', entry_type: 'planned', task_kind: 'dept_task', department_id: DEPT, assignee_user_id: memberInDept }) })
    expect(okRes.status, '소속원 담당 생성 성공').toBeLessThan(300)

    // 2) 비소속 담당으로 변경 → 트리거 거부 기대 (4xx)
    if (outsider && outsider !== memberInDept) {
      const badRes = await fetch(rest(`daily_logs?content=eq.${encodeURIComponent('[TEST-E2E]부서업무')}`), {
        method: 'PATCH', headers: H({ Prefer: 'return=minimal' }),
        body: JSON.stringify({ assignee_user_id: outsider }) })
      expect(badRes.ok, '비소속 담당 지정은 트리거가 거부해야 함').toBeFalsy()
    }

    await cleanup()
  })

  test.afterAll(async () => { if (SERVICE_ROLE) await cleanup() })
})
