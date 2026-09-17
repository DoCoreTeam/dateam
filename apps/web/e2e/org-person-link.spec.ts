import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/** 조직도 사람 카드 → 구성원 상세 (P0019 I06) */
test('조직도에서 사람 이름을 누르면 구성원 상세가 열린다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)

  const memberLinks = page.locator('a[href^="/admin/members/"][title="구성원 상세 열기"]')
  await expect(memberLinks.first()).toBeVisible()
  const href = await memberLinks.first().getAttribute('href')
  expect(href).toMatch(/^\/admin\/members\/[0-9a-f-]{36}$/)

  // 이름을 링크로 만든 뒤에도 카드는 여전히 끌 수 있어야 한다 — dnd-kit 이 붙인 표시로 확인
  const draggableCard = memberLinks.first().locator('xpath=ancestor::*[@aria-roledescription="draggable"][1]')
  await expect(draggableCard).toHaveCount(1)

  await memberLinks.first().click()
  await page.waitForURL(/\/admin\/members\/[0-9a-f-]{36}$/)
  await expect(page.getByText('재직 기록', { exact: true })).toBeVisible()
})

test('사람 노드의 연필은 부서 이동이라고 말하고 상세로 가는 길을 준다', async ({ page }) => {
  await page.goto('/admin/members?tab=org')
  await dismissGlobalModals(page)

  await page.locator('button[title="부서 이동"]').first().click()
  await expect(page.getByRole('heading', { name: '부서 이동' })).toBeVisible()
  await expect(page.getByText('상위 노드 변경')).toBeVisible()
  await expect(page.getByRole('link', { name: '구성원 상세' })).toBeVisible()
  // 이름 칸은 없다 — 사람 노드에서 고칠 것이 아니다
  await expect(page.getByRole('textbox')).toHaveCount(0)
})
