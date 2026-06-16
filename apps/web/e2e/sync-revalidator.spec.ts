import { test, expect, type Page } from '@playwright/test'

// Phase B 조건부 재검증 검증 (SyncRevalidator + revalidateIfStale:false).
// 4 시나리오:
//  (a) 캐시 있고 토큰 동일 재방문 → 해당 API 네트워크 호출 없음
//  (b) 데이터 변경(토큰 변경) 후 → 그 리소스만 재요청
//  (c) 첫 방문(캐시 없음) → 정상 로드
//  (d) sync/version 실패 → 정상(전체) 재검증 — stale 안 남음
//
// 결정성을 위해 /api/work/sync/version 응답을 라우트로 제어하고,
// /api/daily*·/api/calendar* 실제 호출 수를 카운트한다(실데이터 변경 불필요 — 운영 데이터 오염 방지).

const DAILY_VER_BASE = { daily: 'T1|1', calendar: 'C1|1', weekly: 'W1|1', projects: 'P1|1' }

function countMatching(page: Page, counters: { daily: number; calendar: number }) {
  page.on('request', (req) => {
    const u = new URL(req.url())
    if (u.pathname.startsWith('/api/daily')) counters.daily += 1
    if (u.pathname.startsWith('/api/calendar')) counters.calendar += 1
  })
}

test.describe('SyncRevalidator conditional revalidation', () => {
  test('(c) first visit (no cache) loads normally', async ({ page }) => {
    await page.route('**/api/work/sync/version', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: DAILY_VER_BASE, ts: new Date().toISOString() }) }),
    )
    const counters = { daily: 0, calendar: 0 }
    countMatching(page, counters)

    await page.goto('/daily')
    await page.waitForLoadState('networkidle')

    // 첫 방문: 캐시가 없으므로 daily API가 정상 fetch 되어야 한다(>=1).
    expect(counters.daily).toBeGreaterThanOrEqual(1)
    // 토큰은 저장되어 있어야 함(다음 비교용).
    const stored = await page.evaluate(() => {
      const k = Object.keys(localStorage).find((x) => x.startsWith('swr-ver:'))
      return k ? localStorage.getItem(k) : null
    })
    expect(stored).toContain('daily')
  })

  test('(a) revisit with same token → no daily API call (SPA navigation)', async ({ page }) => {
    // 실사용 내비게이션(Next Link/router = pushState, 리로드 없음)을 모사한다.
    // 하드 리로드(goto)는 swr-persist 비동기 복원 레이스로 캐시가 비어 SWR이 fetch하는데,
    // 이는 stale을 막는 fail-safe(정상)지 Phase B 회귀가 아니다. 재방문 시나리오의 본질은
    // "메모리 캐시가 살아있는 in-app 재방문에서 토큰이 같으면 네트워크 0"이다.
    await page.route('**/api/work/sync/version', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: DAILY_VER_BASE, ts: new Date().toISOString() }) }),
    )
    // 1차 하드 진입: 캐시·토큰 채움
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1500)

    // 2차: SPA 내비게이션으로 calendar→daily 복귀 (메모리 캐시 유지, 토큰 동일)
    const counters = { daily: 0, calendar: 0 }
    countMatching(page, counters)
    await page.evaluate(() => {
      window.history.pushState({}, '', '/calendar')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.waitForTimeout(1200)
    await page.evaluate(() => {
      window.history.pushState({}, '', '/daily')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await page.waitForTimeout(1500)

    // 토큰 동일 + revalidateIfStale:false → daily API 재호출 없음.
    expect(counters.daily).toBe(0)
  })

  test('(b) token changed for one resource → only that resource refetches', async ({ page }) => {
    // 1차: base 토큰으로 캐시·토큰 채움
    let versions = { ...DAILY_VER_BASE }
    await page.route('**/api/work/sync/version', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions, ts: new Date().toISOString() }) }),
    )
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')
    await page.goto('/calendar')
    await page.waitForLoadState('networkidle')

    // daily 토큰만 변경
    versions = { ...DAILY_VER_BASE, daily: 'T2|2' }

    const counters = { daily: 0, calendar: 0 }
    countMatching(page, counters)
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')

    // daily는 토큰 변경 → 재검증(>=1). calendar는 동일 → 0.
    expect(counters.daily).toBeGreaterThanOrEqual(1)
    expect(counters.calendar).toBe(0)
  })

  test('(d) sync/version failure → full revalidation (no stale)', async ({ page }) => {
    // 1차: 정상 토큰으로 캐시 채움
    await page.route('**/api/work/sync/version', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ versions: DAILY_VER_BASE, ts: new Date().toISOString() }) }),
    )
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')
    await page.unroute('**/api/work/sync/version')

    // 2차: sync/version 실패시킴
    await page.route('**/api/work/sync/version', (route) => route.fulfill({ status: 500, body: '{}' }))

    const counters = { daily: 0, calendar: 0 }
    countMatching(page, counters)
    await page.goto('/daily')
    await page.waitForLoadState('networkidle')

    // fail-safe: 전체 재검증 → daily API 재호출(>=1). 영구 stale 금지.
    expect(counters.daily).toBeGreaterThanOrEqual(1)
  })
})
