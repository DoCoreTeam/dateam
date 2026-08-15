import { test, expect } from '@playwright/test'
import { dismissGlobalModals, expandAllOriginGroups, getMyUserId, waitForDailyContent } from './_helpers'

// 일일 행 → 부서업무 등록(승격) UI 검증.
//
// ⚠️ 승격은 원본 1건당 **한 번만** 된다(promoted_from_log_id 멱등). 남의 실제 업무를 쓰면
//    ① 사용자 업무가 부서업무로 올라가 오염되고 ② 그 다음부터 이 검사는 영영 skip된다.
//    그래서 [TEST-E2E] 원본을 직접 만들고, 끝나면 만든 것만 지운다(dept-tasks.spec.ts와 같은 방식).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const MARK = '[TEST-E2E] 부서업무 승격 UI 검증'

const H = (extra: Record<string, string> = {}) => ({
  apikey: SERVICE_ROLE,
  Authorization: `Bearer ${SERVICE_ROLE}`,
  'Content-Type': 'application/json',
  ...extra,
})
const rest = (p: string) => `${SUPABASE_URL}/rest/v1/${p}`
const kstToday = () => new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) // kst-ok

test('일일 행 부서업무 등록 UI — 등록 클릭 → 등록됨 배지', async ({ page }) => {
  test.setTimeout(120_000)
  test.skip(!SERVICE_ROLE || !SUPABASE_URL, 'SERVICE_ROLE 미설정 — 격리된 원본을 만들 수 없음')

  await page.goto('/daily')
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })

  const owner = await getMyUserId(page)
  test.skip(!owner, '세션 사용자 id를 확인할 수 없음(개인 일일업무 0건)')

  // 1) [TEST-E2E] 개인 업무 1건 생성 — 오늘(KST) 날짜라 /daily 기본 화면에 바로 뜬다.
  const created = await fetch(rest('daily_logs'), {
    method: 'POST',
    headers: H({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      user_id: owner,
      log_date: kstToday(),
      logged_at: new Date().toISOString(),
      content: MARK,
      entry_type: 'planned',
      task_kind: 'personal',
    }),
  })
  expect(created.ok, '테스트 원본 생성').toBeTruthy()
  const [srcLog] = (await created.json()) as Array<{ id: string }>
  const srcId = srcLog?.id
  expect(srcId).toBeTruthy()

  try {
    await page.goto('/daily')
    await dismissGlobalModals(page)
    expect(await waitForDailyContent(page), '일일 목록 렌더').toBeTruthy()
    await expandAllOriginGroups(page)

    // 2) 방금 만든 그 행의 등록 버튼만 집는다(첫 버튼이 아니라 — 남의 업무를 올리면 안 된다)
    const btn = page.getByTestId(`promote-btn-${srcId}`)
    await expect(btn).toBeVisible({ timeout: 20_000 })
    await btn.click()

    // 부서 목록이 로딩되기 전에는 '등록'이 눌리지 않아야 한다(눌려도 요청이 안 나가는 먹통 방지).
    //
    // 배경 재검증(SyncRevalidator)이 목록을 다시 그리면 열어 둔 드롭다운이 그대로 닫힌다
    // — 사용자에게도 일어나는 일이다. 닫히면 다시 열어 가며 기다린다.
    const confirmBtn = page.getByTestId(`promote-confirm-${srcId}`)
    await expect(async () => {
      if ((await confirmBtn.count()) === 0) await btn.click()
      await expect(confirmBtn).toBeEnabled({ timeout: 3_000 })
    }).toPass({ timeout: 40_000 })

    // 3) 승격 API 응답을 직접 확인한다.
    //    화면은 실패를 **아무 말 없이 삼킨다**(PromoteToDeptButton은 onToast로만 알리는데
    //    /daily가 onToast를 넘기지 않는다) — 배지만 기다리면 "왜 안 되는지"를 영영 못 본다.
    const promoteResp = page.waitForResponse(
      (r) => r.url().includes('/api/work/promote') && r.request().method() === 'POST',
      { timeout: 20_000 },
    )
    await confirmBtn.click()
    const resp = await promoteResp
    expect(resp.ok(), `승격 API 실패(${resp.status()}): ${await resp.text()}`).toBeTruthy()

    // 4) 등록됨 배지
    await expect(page.locator('text=↗ 부서업무 등록됨').first()).toBeVisible({ timeout: 20_000 })

    // 5) 실제로 부서업무 행이 생겼는지 DB로 확인(화면 배지만 믿지 않는다)
    const promoted = await fetch(
      rest(`daily_logs?select=id&promoted_from_log_id=eq.${srcId}&task_kind=eq.dept_task&deleted_at=is.null`),
      { headers: H() },
    ).then((r) => r.json())
    expect(Array.isArray(promoted) && promoted.length, '부서업무 1건 생성됨').toBe(1)
  } finally {
    // 6) 정리 — 승격된 부서업무 + 원본. 단언이 실패해도 반드시 지운다.
    await fetch(rest(`daily_logs?promoted_from_log_id=eq.${srcId}`), { method: 'DELETE', headers: H() })
    await fetch(rest(`daily_logs?id=eq.${srcId}`), { method: 'DELETE', headers: H() })
  }
})
