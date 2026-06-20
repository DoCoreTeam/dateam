import { test, expect } from '@playwright/test'

/**
 * 관리자 일일업무 모니터링 — 캘린더형 핵심 플로우 E2E.
 *
 * 프로젝트 관례: storageState(auth-state.json, 수동 로그인)로 세션 주입.
 * 저장 세션이 admin이 아니면 /dashboard로 리다이렉트되므로 graceful skip.
 * (admin 세션으로 실행 시 전 단계 검증)
 */
test.describe('관리자 일일업무 모니터링', () => {
  test('캘린더 렌더 → 날짜 클릭 → 작성자 리스트/미작성자 노출', async ({ page }) => {
    await page.goto('/admin/daily-logs')

    // admin이 아니면 대시보드로 튕김 → 스킵
    if (new URL(page.url()).pathname !== '/admin/daily-logs') {
      test.skip(true, 'admin 세션이 아니어서 스킵 (auth-state.json이 admin이어야 실행)')
      return
    }

    // 제목 + 캘린더 보드
    await expect(page.locator('h1.monitor-title')).toBeVisible()
    await expect(page.locator('.calendar-month-grid')).toBeVisible()

    // 월 요약 추이 스트립
    await expect(page.locator('.monitor-month-stats')).toBeVisible()

    // 날짜 셀 클릭 (이번 달 셀 하나)
    const cell = page.locator('.monitor-day-cell:not(.is-out)').first()
    await cell.click()
    await page.waitForLoadState('networkidle')

    // 선택일 상세 패널: KPI + 검색/필터 + 미작성자 영역
    await expect(page.locator('.monitor-panel')).toBeVisible()
    await expect(page.locator('.monitor-kpi')).toBeVisible()
    await expect(page.locator('.monitor-filters .input-field').first()).toBeVisible()
    await expect(page.locator('.monitor-missing')).toBeVisible()
  })

  test('정렬 헤더 클릭 시 URL sort 파라미터 반영', async ({ page }) => {
    await page.goto('/admin/daily-logs')
    if (new URL(page.url()).pathname !== '/admin/daily-logs') {
      test.skip(true, 'admin 세션 아님')
      return
    }
    const memberHeader = page.locator('.monitor-th-sort', { hasText: '멤버' })
    if ((await memberHeader.count()) === 0) {
      test.skip(true, '해당일 로그 없음 — 정렬 헤더 미표시')
      return
    }
    await memberHeader.click()
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('sort=name')
  })

  test('CSV 내보내기 링크가 선택일 범위로 구성', async ({ page }) => {
    await page.goto('/admin/daily-logs')
    if (new URL(page.url()).pathname !== '/admin/daily-logs') {
      test.skip(true, 'admin 세션 아님')
      return
    }
    const exportBtn = page.locator('.monitor-export-btn')
    if ((await exportBtn.count()) === 0) {
      test.skip(true, '해당일 로그 없음 — export 버튼 미표시')
      return
    }
    const href = await exportBtn.getAttribute('href')
    expect(href).toContain('/admin/daily-logs/export?')
    expect(href).toMatch(/from=\d{4}-\d{2}-\d{2}/)
    expect(href).toMatch(/to=\d{4}-\d{2}-\d{2}/)
  })
})
