import { test, expect, type Page } from '@playwright/test'

/**
 * 주간보고 "일일업무에서 주간보고 생성" 병합 회귀 E2E.
 *
 * 회귀 대상(v0.7.215): 생성이 기존 폼 내용을 통째로 교체(replace)하던 버그 →
 * 카테고리 키 + 셀 불릿 합집합(중복제거) 병합으로 수정.
 *
 * 결정적 설계: 일일업무 조회/생성 API를 route mock으로 고정해 AI 변동성을 제거.
 * 두 번 연속 생성하여 (a)신규 추가 (b)기존 보존 (c)동일 카테고리 병합+중복제거를 한 번에 검증.
 *
 * 프로젝트 관례: storageState(auth-state.json, 수동 로그인) 세션 필요 → 없으면 graceful skip.
 */

const DAILY_TASK = [{
  id: 'e2e-task-1', user_id: 'e2e', log_date: '2026-06-16', logged_at: '2026-06-16T09:00:00Z',
  content: 'E2E 더미 업무', entry_type: 'done', is_resolved: true, priority: 'normal', ai_processed: false,
}]

async function readRows(page: Page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll('table.report-form-table tbody tr')).map((tr) => {
      const c = Array.from(tr.querySelectorAll('td'))
      const txt = (el: Element | undefined) => (el ? (el as HTMLElement).innerText : '').replace(/\s+/g, ' ').trim()
      return {
        category: (tr.querySelector('input[list="category-list"]') as HTMLInputElement | null)?.value ?? '',
        performance: txt(c[1]), plan: txt(c[2]), issues: txt(c[3]),
      }
    })
  })
}

// 첫 접속/업데이트 모달 등 오버레이 제거 — 셀렉터 클릭 가로채기 방지
async function dismissOverlays(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('[role="dialog"]').forEach((el) => el.remove())
    document.querySelectorAll('[class*="backdrop" i], [class*="overlay" i]').forEach((el) => {
      const s = getComputedStyle(el as HTMLElement)
      if (s.position === 'fixed') (el as HTMLElement).remove()
    })
  })
}

// 생성 버튼은 "(N개 업무)" — 헤더 "(N/N개 선택)"와 구분
const GEN_BTN = /주간보고 생성 \(\d+개 업무\)/

async function generateOnce(page: Page) {
  await dismissOverlays(page)
  await page.locator('#onboarding-daily-selector').click()
  await page.getByRole('button', { name: GEN_BTN }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: GEN_BTN }).click()
  // 패널이 닫히면 생성 반영 완료
  await expect(page.getByRole('button', { name: GEN_BTN })).toBeHidden({ timeout: 10_000 })
}

test('생성은 기존 내용을 덮어쓰지 않고 카테고리 단위로 병합한다', async ({ page }) => {
  // 주간보고 작성 가이드(driver.js 스포트라이트) 자동시작 차단 — 클릭 가로채기 방지
  await page.addInitScript(() => {
    try { localStorage.setItem('weekly_report_onboarding_done', '1') } catch { /* noop */ }
  })

  // 일일업무 목록 고정(생성 버튼 활성화용)
  await page.route('**/api/daily/week**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DAILY_TASK) }),
  )

  await page.goto('/weekly-report?tab=mine')
  if (new URL(page.url()).pathname !== '/weekly-report') {
    test.skip(true, '인증 세션 아님 (auth-state.json 필요)')
    return
  }
  // 폼이 그려질 때까지 대기
  await page.locator('table.report-form-table').waitFor({ state: 'visible' })

  // 1차 생성 — 신규 카테고리 2개 주입
  await page.route('**/api/weekly-report/generate-from-tasks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows: [
        { category: 'E2E_영업', performance: '<ul><li>AA</li></ul>', plan: '', issues: '' },
        { category: 'E2E_운영', performance: '<ul><li>BB</li></ul>', plan: '', issues: '' },
      ] }),
    }),
  )
  await generateOnce(page)

  let rows = await readRows(page)
  let byCat = Object.fromEntries(rows.map((r) => [r.category, r]))
  expect(byCat['E2E_영업']?.performance).toContain('AA')
  expect(byCat['E2E_운영']?.performance).toContain('BB')

  // 2차 생성 — E2E_영업은 기존(AA) 중복 + 신규(AA2), E2E_개발은 완전 신규. E2E_운영은 미포함.
  await page.unroute('**/api/weekly-report/generate-from-tasks')
  await page.route('**/api/weekly-report/generate-from-tasks', (route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ rows: [
        { category: 'E2E_영업', performance: '<ul><li>AA</li><li>AA2</li></ul>', plan: '', issues: '' },
        { category: 'E2E_개발', performance: '<ul><li>CC</li></ul>', plan: '', issues: '' },
      ] }),
    }),
  )
  await generateOnce(page)

  rows = await readRows(page)
  byCat = Object.fromEntries(rows.map((r) => [r.category, r]))

  // (a) 미포함 카테고리(E2E_운영)는 그대로 보존
  expect(byCat['E2E_운영']?.performance).toContain('BB')
  // (b) 신규 카테고리(E2E_개발) 추가
  expect(byCat['E2E_개발']?.performance).toContain('CC')
  // (c) 동일 카테고리(E2E_영업)는 병합 — AA 보존 + AA2 추가, AA는 1회만(중복제거)
  const salesPerf = byCat['E2E_영업']?.performance ?? ''
  expect(salesPerf).toContain('AA2')
  expect((salesPerf.match(/AA(?!2)/g) ?? []).length).toBe(1)
})
