import { test, expect } from '@playwright/test'

// 업무 허브 IA E2E — /work 진입 리다이렉트 + 공유 탭바 3탭 전환. (auth-state 세션 재사용)
test.describe('업무 허브 IA', () => {
  test('/work → /daily 리다이렉트 + WorkTabBar 3탭 전환', async ({ page }) => {
    await page.goto('/work')
    await expect(page).toHaveURL(/\/daily$/)

    const tabbar = page.getByRole('navigation', { name: '업무 탭' })
    await expect(tabbar.getByRole('link', { name: '일일업무' })).toBeVisible()
    await expect(tabbar.getByRole('link', { name: '부서 업무' })).toBeVisible()
    await expect(tabbar.getByRole('link', { name: '주간보고' })).toBeVisible()

    // 부서 업무 탭 이동
    await tabbar.getByRole('link', { name: '부서 업무' }).click()
    await expect(page).toHaveURL(/\/dept-tasks$/)

    // 주간보고 탭 이동
    await page.getByRole('navigation', { name: '업무 탭' }).getByRole('link', { name: '주간보고' }).click()
    await expect(page).toHaveURL(/\/weekly-report/)
  })
})
