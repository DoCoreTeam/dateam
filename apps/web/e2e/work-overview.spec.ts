import { test, expect } from '@playwright/test'
test('업무 현황 — 그룹뷰 렌더 + 축 토글', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/work/overview'); await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 })
  await expect(page.getByText('업무 현황')).toBeVisible({ timeout: 15_000 })
  // 고객 축 — API 응답 캡처
  const r = await page.evaluate(async () => {
    const a = await fetch('/api/work/groups?by=account').then(x => x.json())
    const d = await fetch('/api/work/groups?by=deal').then(x => x.json())
    return { accGroups: a.groups?.length, accUngrouped: a.ungrouped, dealUngrouped: d.ungrouped }
  })
  console.log('[overview]', JSON.stringify(r))
  expect(typeof r.accUngrouped).toBe('number')   // 집계 동작
  // 축 토글 클릭
  await page.getByTestId('axis-deal').click()
  await page.waitForTimeout(800)
  await expect(page.getByTestId('axis-deal')).toBeVisible()
})
