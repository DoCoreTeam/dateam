import { test, expect } from '@playwright/test'
test('워크로드 대시보드 위젯 렌더 + API', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/work/overview'); await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.getByTestId('work-dashboard')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('활동 추세 (최근 8주)')).toBeVisible()
  const d = await page.evaluate(async () => await fetch('/api/work/dashboard').then(r => r.json()))
  console.log('[dash]', JSON.stringify({ total: d.total, trend: d.trend?.length, dist: d.distribution?.length, rollup: d.rollup }))
  expect(d.trend.length).toBe(8)
  expect(typeof d.total).toBe('number')
  expect(d.rollup).toBeTruthy()
})
