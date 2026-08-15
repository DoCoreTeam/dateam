import { test, expect, type Page } from '@playwright/test'

/**
 * 관리자 일일업무 모니터링 — 캘린더형 핵심 플로우 E2E.
 *
 * 프로젝트 관례: storageState(auth-state.json, 수동 로그인)로 세션 주입.
 * 저장 세션이 admin이 아니면 /dashboard로 리다이렉트되므로 graceful skip.
 * (admin 세션으로 실행 시 전 단계 검증)
 *
 * ⚠️ 선택자 주의: 이 화면의 상세 패널은 v0.7.448 목록 표준(ListToolbar/ListSurface)으로,
 *   제목은 v0.7.445 PageHeader로 이관됐다. 예전 선택자(`h1.monitor-title`·`.monitor-filters`·
 *   `.monitor-th-sort`·`.monitor-export-btn`)는 **화면에 더 이상 없다**. 없는 선택자를
 *   `count()===0 → skip`으로 감싸면 검사는 초록인데 아무것도 안 보는 상태가 된다(실제로 그랬다).
 */

/** admin 세션이 아니면 false — 호출부가 skip 처리한다. */
async function gotoMonitor(page: Page): Promise<boolean> {
  await page.goto('/admin/daily-logs')
  return new URL(page.url()).pathname === '/admin/daily-logs'
}

/**
 * **기록이 있는 날**을 찾아 눌러 상세 패널을 연다. 없으면 '이전 달'로 최대 12개월 거슬러 찾는다.
 *
 * 왜 이렇게까지 하나: 빈 날을 고르면 목록 표 자체가 안 그려져 정렬 검사가 조용히 skip되고,
 * 검사는 초록인데 아무것도 안 본 상태가 된다(실제로 이번 달 기록 0건이라 그렇게 됐다).
 * 셀의 aria-label이 "2026-07-31 작성 3명" 꼴이라 작성자 수로 곧장 고를 수 있다.
 *
 * @returns 기록 있는 날을 열었으면 true, 12개월을 뒤져도 없으면 false(호출부가 skip)
 */
async function openDayWithLogs(page: Page): Promise<boolean> {
  const cells = page.locator('.monitor-day-cell:not(.is-out)')
  for (let back = 0; back <= 12; back += 1) {
    const labels = await cells.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
    const hit = labels.findIndex((l) => /작성 [1-9]\d*명/.test(l))
    if (hit >= 0) {
      await cells.nth(hit).click()
      await page.waitForLoadState('networkidle')
      await expect(page.locator('.monitor-panel')).toBeVisible()
      return true
    }
    await page.getByLabel('이전 달').click()
    await page.waitForLoadState('networkidle')
  }
  return false
}

test.describe('관리자 일일업무 모니터링', () => {
  test('캘린더 렌더 → 날짜 클릭 → 작성자 리스트/미작성자 노출', async ({ page }) => {
    if (!(await gotoMonitor(page))) {
      test.skip(true, 'admin 세션이 아니어서 스킵 (auth-state.json이 admin이어야 실행)')
      return
    }

    // 제목(PageHeader) + 캘린더 보드
    await expect(page.getByRole('heading', { name: '일일업무 모니터링', level: 1 })).toBeVisible()
    await expect(page.locator('.calendar-month-grid')).toBeVisible()

    // 월 요약 추이 스트립
    await expect(page.locator('.monitor-month-stats')).toBeVisible()

    test.skip(!(await openDayWithLogs(page)), '최근 12개월에 일일업무 기록이 없어 상세 패널을 열 수 없음')

    // 선택일 상세 패널: KPI + 목록 도구(검색) + 미작성자 영역
    await expect(page.locator('.monitor-kpi')).toBeVisible()
    await expect(page.getByRole('toolbar', { name: '목록 도구' })).toBeVisible()
    await expect(page.getByLabel('내용 검색')).toBeVisible()
    await expect(page.locator('.monitor-missing')).toBeVisible()
  })

  test('정렬 헤더 클릭 시 URL sort 파라미터 반영', async ({ page }) => {
    if (!(await gotoMonitor(page))) {
      test.skip(true, 'admin 세션 아님')
      return
    }
    test.skip(!(await openDayWithLogs(page)), '최근 12개월에 일일업무 기록이 없어 정렬을 검증할 수 없음')

    // ListSurface의 정렬 가능 헤더는 th 안의 button이다(헤더 라벨 + 정렬 아이콘).
    await page.getByRole('button', { name: /멤버/ }).first().click()
    await expect(page).toHaveURL(/sort=name/)
  })

  test('CSV 내보내기 링크가 선택일 범위로 구성', async ({ page }) => {
    if (!(await gotoMonitor(page))) {
      test.skip(true, 'admin 세션 아님')
      return
    }
    test.skip(!(await openDayWithLogs(page)), '최근 12개월에 일일업무 기록이 없어 내보내기 링크를 검증할 수 없음')

    const exportLink = page.getByRole('link', { name: '선택일 CSV 내보내기' })
    await expect(exportLink).toBeVisible()
    const href = await exportLink.getAttribute('href')
    expect(href).toContain('/admin/daily-logs/export?')
    expect(href).toMatch(/from=\d{4}-\d{2}-\d{2}/)
    expect(href).toMatch(/to=\d{4}-\d{2}-\d{2}/)
  })
})
