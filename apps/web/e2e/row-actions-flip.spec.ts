import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 행 작업 메뉴가 화면 밖으로 나가지 않는다 (P0023 I01)
 *
 * 왜 검사하나 (사용자 지적 2026-09-19): 목록 맨 아래 행에서 더보기를 누르면 메뉴가 잘려
 * 나갔고, 삭제 확인까지 펼치면 확인 단추가 화면 밑으로 사라져 누를 수가 없었다.
 */

async function openMenuOfRow(page: import('@playwright/test').Page, index: number) {
  const row = page.locator('tbody tr').nth(index)
  await row.scrollIntoViewIfNeeded()
  await row.getByRole('button', { name: /작업 더보기/ }).click()
  const menu = page.locator('.row-actions-menu')
  await expect(menu).toBeVisible()
  return { row, menu }
}

test('마지막 행에서 열면 메뉴가 화면 안에 들어온다', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto('/admin/members?tab=users')
  await dismissGlobalModals(page)

  const last = (await page.locator('tbody tr').count()) - 1
  const { menu } = await openMenuOfRow(page, last)

  await expect(menu).toHaveClass(/is-up/)
  const box = await menu.boundingBox()
  const vh = page.viewportSize()!.height
  if (!box) throw new Error('메뉴를 못 찾음')
  expect(box.y + box.height, `메뉴 아래변 ${box.y + box.height} 가 화면 ${vh} 밖`).toBeLessThanOrEqual(vh)
  expect(box.y, '메뉴 윗변이 화면 위로 넘어감').toBeGreaterThanOrEqual(0)
})

test('위로 뒤집는 것은 아래에 자리가 없을 때뿐이다', async ({ page }) => {
  // 화면을 길게 잡아 첫 행 아래에 자리가 남게 한다 — 그 자리에서는 뒤집지 않아야 한다
  await page.setViewportSize({ width: 1400, height: 1400 })
  await page.goto('/admin/members?tab=users')
  await dismissGlobalModals(page)

  const { menu } = await openMenuOfRow(page, 0)

  // 뒤집었나 안 뒤집었나를 실제 남은 자리와 대조한다 — 화면 높이를 가정하지 않는다
  const fact = await page.evaluate(() => {
    const m = document.querySelector('.row-actions-menu') as HTMLElement
    const t = m.closest('.row-actions-more')!.querySelector('button') as HTMLElement
    const r = t.getBoundingClientRect()
    return { up: m.classList.contains('is-up'), menuH: m.offsetHeight, roomBelow: window.innerHeight - r.bottom - 8 }
  })
  expect(fact.roomBelow, `첫 행 아래 자리가 ${fact.roomBelow} 뿐이라 이 검사가 뜻을 잃는다`).toBeGreaterThan(fact.menuH)
  expect(fact.up, '아래에 자리가 남는데 위로 뒤집었다').toBe(false)
  await expect(menu).not.toHaveClass(/is-up/)
})

test('메뉴 안에서 삭제 확인이 펼쳐져 길어져도 화면 안에 남는다', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await page.goto('/admin/members?tab=users')
  await dismissGlobalModals(page)

  const last = (await page.locator('tbody tr').count()) - 1
  const { menu } = await openMenuOfRow(page, last)
  await menu.getByRole('button', { name: '삭제' }).click()
  await expect(menu.getByRole('button', { name: '확인' })).toBeVisible()

  const box = await menu.boundingBox()
  const vh = page.viewportSize()!.height
  if (!box) throw new Error('메뉴를 못 찾음')
  expect(box.y + box.height, '확인을 펼치니 메뉴가 화면 밖으로 나감').toBeLessThanOrEqual(vh)

  // 확인 단추가 실제로 눌리는 자리에 있어야 한다 — 보이는 것과 닿는 것은 다르다
  const confirmBox = await menu.getByRole('button', { name: '확인' }).boundingBox()
  if (!confirmBox) throw new Error('확인 단추를 못 찾음')
  expect(confirmBox.y + confirmBox.height).toBeLessThanOrEqual(vh)
})
