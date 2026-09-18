import { test, expect } from '@playwright/test'
import { dismissGlobalModals } from './_helpers'

/**
 * 날짜 칸의 「오늘」 단추 (P0021 I01b)
 *
 * 왜 검사하나 (사용자 지적 2026-09-18): 날짜를 넣으려면 무조건 달력을 열어야 했다.
 * 달력을 안 열고 오늘이 들어가는지를 본다.
 */
function kstToday(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' }) // kst-ok
}

async function openFirstMember(page: import('@playwright/test').Page) {
  await page.goto('/admin/members?tab=users')
  await dismissGlobalModals(page)
  await page.locator('a[href^="/admin/members/"]').first().click()
  await page.waitForURL(/\/admin\/members\/[0-9a-f-]{36}$/)
  await dismissGlobalModals(page)
}

test('달력을 안 열어도 오늘 단추로 오늘이 들어간다', async ({ page }) => {
  await openFirstMember(page)

  const hired = page.locator('#emp-hired')
  await expect(hired).toBeVisible()
  await hired.fill('')

  const todayBtn = hired.locator('xpath=following-sibling::button[1]')
  await expect(todayBtn).toHaveText('오늘')
  await todayBtn.click()
  await expect(hired).toHaveValue(kstToday())

  // 칸을 비워 원래대로 돌려 놓는다 — 저장은 누르지 않으므로 실데이터는 그대로다
  await hired.fill('')
})

test('칸과 단추가 한 줄에 들어가고 단추가 칸을 밀어내지 않는다', async ({ page }) => {
  await openFirstMember(page)

  const wrap = page.locator('.date-field').first()
  const input = wrap.locator('.input-field')
  const btn = wrap.locator('.date-field-today')
  const [wb, ib, bb] = await Promise.all([wrap.boundingBox(), input.boundingBox(), btn.boundingBox()])
  if (!wb || !ib || !bb) throw new Error('날짜 칸을 못 찾음')
  expect(Math.abs((ib.y + ib.height / 2) - (bb.y + bb.height / 2))).toBeLessThanOrEqual(2)
  expect(ib.width + bb.width).toBeLessThanOrEqual(wb.width + 12)
})
