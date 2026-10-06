import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const DEAL = '/crm/deals/cmup57j5x0004l504gu6ygtu3'

test('저장 뒤 반영 중 표시가 보였다가 사라진다 (QA 견적)', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 950 })
  // QA 견적을 만든다 — 사용자 견적은 안 건드린다
  await page.goto(DEAL)
  await page.waitForLoadState('domcontentloaded')
  const nq = page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first()
  await expect(nq).toBeVisible({ timeout: 120_000 })
  if (await page.locator('.modal-backdrop').count() > 0) {
    await page.getByRole('button', { name: '닫기' }).first().click().catch(() => {})
  }
  await nq.click()
  const dlg = page.getByRole('dialog').first()
  await dlg.locator('#quote-title').fill('QA 반영중 점검 (지워도 됨)')
  // 항목이 없으면 저장이 안 된다 — 카탈로그에서 하나 고른다
  if (await dlg.locator('#ln-name-0').count() === 0) {
    await dlg.getByRole('button', { name: '항목 추가', exact: true }).click()
  }
  await dlg.locator('#ln-name-0').click()
  const picker = page.getByRole('dialog', { name: '품목 고르기' })
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await picker.getByRole('textbox', { name: '품목 검색' }).fill('L40S')
  await page.waitForTimeout(1_200)
  await picker.locator('button').filter({ hasText: /L40S/i }).first().click()
  await expect(picker).toBeHidden({ timeout: 15_000 })
  await dlg.locator('#ln-price-0').fill('1000')
  const posted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/crm/quotes' && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '저장', exact: true }).click()
  const id = (await (await posted).json())?.id
  expect(id).toBeTruthy()

  await page.goto(`/crm/quotes/${id}`)
  await page.waitForLoadState('domcontentloaded')
  const art = page.locator('article').first()
  await expect(art).toBeVisible({ timeout: 90_000 })
  const note = page.getByRole('status').filter({ hasText: '반영 중' })
  await expect(note, '아직 아무것도 안 했는데 표시가 떠 있다').toHaveCount(0)

  await page.getByRole('button', { name: '수정', exact: true }).first().click()
  await expect(dlg).toBeVisible()
  const stamp = `QA-${Date.now()}`
  await dlg.locator('#quote-notes').fill(stamp)
  await dlg.getByRole('button', { name: '저장', exact: true }).click()

  await expect(note, '저장했는데 반영 중 표시가 안 뜬다').toBeVisible({ timeout: 20_000 })
  const seen = await note.innerText()
  await expect(note, '다 불러왔는데 표시가 안 사라진다').toHaveCount(0, { timeout: 30_000 })
  await expect(art).toContainText(stamp, { timeout: 30_000 })
  fs.writeFileSync('/tmp/qa-reload3.txt', `표시=${seen}`)
  console.log(`표시="${seen}"`)

  await page.request.delete(`/api/crm/quotes/${id}`)
  const p2 = await page.request.delete(`/api/crm/quotes/${id}?mode=purge`)
  expect(p2.ok(), '치우기 실패').toBe(true)
})
