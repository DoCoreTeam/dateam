import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 목록 끝 알림 (P0023 I02)
 *
 * 왜 검사하나 (사용자 지적 2026-09-19): 서른 몇 줄을 훑어 바닥에 닿았는데 아무 표시가 없어
 * 「페이지네이션이 없는 건가」 싶었다. 한 쪽이라 단추를 안 그린 것인데 화면이 그 말을 안 했다.
 */
test('한 쪽이면 끝줄, 여러 쪽이면 단추, 0건이면 아무것도 안 그린다', async ({ page }) => {
  await page.goto('/admin/members?tab=users&size=50')
  await dismissGlobalModals(page)
  await expect(page.locator('.list-pager-end')).toBeVisible()
  await expect(page.locator('.list-page-btn')).toHaveCount(0)
  const txt = await page.locator('.list-pager-end').innerText()
  // 사람을 세는 목록이라 조수사가 「명」이다 (용어집 §03)
  expect(txt).toContain('명')

  await page.goto('/admin/members?tab=users&size=20')
  await dismissGlobalModals(page)
  await expect(page.locator('.list-pager-end')).toHaveCount(0)
  expect(await page.locator('.list-page-btn').count()).toBeGreaterThan(2)

  // 0건이면 아무것도 안 그린다 — 빈 상태가 이미 말하고 있다
  await page.goto('/admin/members?tab=users&q=' + encodeURIComponent('없는이름ZZZ'))
  await dismissGlobalModals(page)
  await expect(page.locator('.list-pager-end')).toHaveCount(0)
  await expect(page.locator('.list-pager')).toHaveCount(0)
})
