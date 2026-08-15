import type { Page } from '@playwright/test'

/**
 * 화면을 덮는 자동 안내 모달을 닫는다.
 *
 * 왜: 앱은 상황에 따라 스스로 모달을 띄운다(주간보고 미작성 안내·이름 설정·루틴 체크인 등).
 *   이건 정상 동작이지만, E2E에서는 `.modal-backdrop`이 포인터 이벤트를 가로채
 *   **"요소는 찾았는데 클릭에서 타임아웃"** 이라는 가장 헷갈리는 실패를 만든다.
 *   앱은 멀쩡한데 검사만 죽으므로, 원인을 못 찾으면 애먼 코드를 고치게 된다.
 *
 * changelog "새로운 소식"은 여기서 닫지 않는다 — auth.setup이 저장 세션에
 * `changelog_seen_version`을 심어 애초에 뜨지 않게 한다(버전 올릴 때마다 반복되므로).
 *
 * 예전엔 이 함수가 work-shell-uniformity.spec.ts 안에만 있었고, 복사해 가지 않은 스펙이
 * 그대로 실패했다(v0.7.475). 그래서 공용으로 뺀다.
 */
export async function dismissGlobalModals(page: Page): Promise<void> {
  await page.waitForTimeout(400)
  for (let i = 0; i < 4; i += 1) {
    const backdrop = page.locator('.modal-backdrop').first()
    if (!(await backdrop.isVisible().catch(() => false))) return
    // 백드롭 모서리를 눌러 닫는다 — 카드 위를 누르면 안의 버튼이 눌린다
    await backdrop.click({ position: { x: 2, y: 2 } }).catch(() => {})
    await page.waitForTimeout(150)
  }
}

/**
 * **개인 일일업무 기록이 있는 가장 최근 날짜**(YYYY-MM-DD)를 찾는다. 없으면 null.
 *
 * 왜: `/daily`는 기본이 '오늘'인데, 오늘 기록이 0건인 날이 흔하다(실측 2026-08은 한 달 통째로 0건).
 *   그런 날엔 카드가 아예 없어서 검사가 "화면이 깨졌다"가 아니라 **"데이터가 없다"로 죽는다** —
 *   앱과 무관한 실패이고, 원인을 못 찾으면 애먼 코드를 고치게 된다.
 *   "오늘부터 며칠 뒤로 클릭" 식의 고정 횟수 되감기도 같은 이유로 부서진다(8일 뒤로는 못 닿았다).
 *
 * `/daily?date=<반환값>`으로 바로 이동하면 결정적으로 데이터가 있는 화면에서 검사할 수 있다.
 */
export async function findDailyDateWithLogs(page: Page, weeksBack = 20): Promise<string | null> {
  const anchor = new Date(new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) + 'T00:00:00Z') // kst-ok
  const dow = anchor.getUTCDay()
  anchor.setUTCDate(anchor.getUTCDate() + (dow === 0 ? -6 : 1 - dow)) // 이번 주 월요일(KST)

  for (let w = 0; w < weeksBack; w += 1) {
    const monday = new Date(anchor)
    monday.setUTCDate(monday.getUTCDate() - w * 7)
    const start = monday.toISOString().slice(0, 10)
    const res = await page.request.get(`/api/daily/week?start=${start}&personal=1`)
    if (!res.ok()) continue
    const rows = (await res.json()) as Array<{ log_date?: string }>
    const dates = rows.map((r) => r.log_date).filter((d): d is string => Boolean(d)).sort()
    if (dates.length > 0) return dates[dates.length - 1]
  }
  return null
}

/**
 * `/daily`의 원본 입력 그룹(origin group)을 전부 펼친다.
 *
 * 왜: v0.7.244부터 한 번에 입력한 원문은 그룹으로 묶여 **접힌 채** 뜨고, 안의 개별 업무 카드
 *   (`.daily-log-card`)와 부서업무 등록 버튼은 펼쳐야 나타난다. 그룹을 안 펼치면 검사는
 *   "카드가 없다"고 죽거나 조용히 skip된다 — 화면은 멀쩡한데 검사만 못 보는 상태다.
 */
export async function expandAllOriginGroups(page: Page): Promise<void> {
  const toggles = page.getByTestId('origin-group-toggle')
  const count = await toggles.count()
  for (let i = 0; i < count; i += 1) {
    const toggle = toggles.nth(i)
    if ((await toggle.getAttribute('aria-expanded')) === 'true') continue
    await toggle.click()
  }
  if (count > 0) await page.waitForTimeout(400)
}

/**
 * 일일 목록이 실제로 그려질 때까지 기다린다(그룹 토글 또는 개별 카드가 하나라도 나올 때까지).
 *
 * 왜: `/daily`는 클라이언트에서 목록을 불러온다. 렌더 전에 버튼을 세면 0이 나와
 *   검사가 조용히 skip되거나(있는데 못 본 것) 엉뚱한 곳을 누른다. 실제로 그래서
 *   promote 검사가 "버튼 없음"과 "눌렀는데 반응 없음" 사이를 오갔다.
 * @returns 항목이 하나라도 그려졌으면 true, 시간 안에 아무것도 없으면 false(그 날은 빈 날)
 */
export async function waitForDailyContent(page: Page, timeoutMs = 30_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const n = (await page.getByTestId('origin-group-toggle').count()) + (await page.locator('.daily-log-card').count())
    if (n > 0) return true
    await page.waitForTimeout(500)
  }
  return false
}

/**
 * 로그인 세션 사용자의 id. `/api/daily/week?personal=1`은 **내 개인 업무만** 돌려주므로
 * 그 행의 user_id가 곧 나다(쿠키 JWT를 직접 까는 것보다 깨질 여지가 적다).
 */
export async function getMyUserId(page: Page, weeksBack = 20): Promise<string | null> {
  const anchor = new Date(new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) + 'T00:00:00Z') // kst-ok
  const dow = anchor.getUTCDay()
  anchor.setUTCDate(anchor.getUTCDate() + (dow === 0 ? -6 : 1 - dow))
  for (let w = 0; w < weeksBack; w += 1) {
    const monday = new Date(anchor)
    monday.setUTCDate(monday.getUTCDate() - w * 7)
    const res = await page.request.get(`/api/daily/week?start=${monday.toISOString().slice(0, 10)}&personal=1`)
    if (!res.ok()) continue
    const rows = (await res.json()) as Array<{ user_id?: string }>
    const uid = rows.find((r) => r.user_id)?.user_id
    if (uid) return uid
  }
  return null
}
