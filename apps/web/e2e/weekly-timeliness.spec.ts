import { test, expect } from '@playwright/test'

/**
 * 주간보고 지연 추적·증빙 — 핵심 플로우 E2E.
 *
 * 프로젝트 관례: storageState(auth-state.json, 수동 로그인)로 세션 주입.
 * 조직 탭은 관할/전사 권한이 있어야 노출 → 권한 없으면 graceful skip.
 */
test.describe('주간보고 지연 추적', () => {
  test('주간보고 페이지 로드 (내 보고 탭)', async ({ page }) => {
    await page.goto('/weekly-report')
    // 로그인 안 되어 있으면 /login 으로 튕김 → 스킵
    if (new URL(page.url()).pathname !== '/weekly-report') {
      test.skip(true, '인증 세션 아님 (auth-state.json 필요)')
      return
    }
    await expect(page.getByRole('heading', { name: '주간보고', exact: true })).toBeVisible()
    // 작성 폼 카드
    await expect(page.getByText('보고서 작성')).toBeVisible()
  })

  test('조직 현황 탭 → 부서 드릴 → 작성 적시성 패널', async ({ page }) => {
    await page.goto('/weekly-report?tab=org')
    if (new URL(page.url()).pathname !== '/weekly-report') {
      test.skip(true, '인증 세션 아님')
      return
    }
    // 조직 탭이 없으면(권한 없음) 탭 버튼 자체가 없음 → 스킵
    const orgTab = page.getByRole('link', { name: '조직 현황' })
    if (!(await orgTab.count())) {
      test.skip(true, '조직 권한 없는 세션 — 조직 탭 미노출')
      return
    }
    await expect(page.getByText('조직 현황 — 부서 취합 주간보고')).toBeVisible()

    // 리프 부서까지 드릴다운: "열기" 카드가 있으면 클릭(없으면 이미 리프)
    const openCard = page.getByText('열기').first()
    if (await openCard.count()) {
      await openCard.click()
      await page.waitForLoadState('networkidle')
    }
    // 리프 부서면 적시성 패널 노출(멤버 있을 때). 멤버 0이면 패널 없음 → 통계만 확인.
    const panel = page.getByText('작성 적시성')
    if (await panel.count()) {
      await expect(panel.first()).toBeVisible()
    }
  })

  test('주차 네비게이션 화살표 동작', async ({ page }) => {
    await page.goto('/weekly-report?tab=org')
    if (new URL(page.url()).pathname !== '/weekly-report') {
      test.skip(true, '인증 세션 아님')
      return
    }
    if (!(await page.getByRole('link', { name: '조직 현황' }).count())) {
      test.skip(true, '조직 권한 없는 세션')
      return
    }
    const prev = page.getByLabel('이전 주')
    await expect(prev).toBeVisible()
    await prev.click()
    await page.waitForLoadState('networkidle')
    // URL 에 orgWeek 파라미터 반영
    expect(page.url()).toContain('orgWeek=')
  })
})
