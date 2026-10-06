import { test, expect } from '@playwright/test'
import * as fs from 'fs'
const ID = 'cmus4n1le0001js04vg8zjax1'

test('저장 뒤 반영 중 표시가 보였다가 사라진다', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(`/crm/quotes/${ID}`)
  await page.waitForLoadState('domcontentloaded')
  const art = page.locator('article').first()
  await expect(art).toBeVisible({ timeout: 90_000 })
  const note = page.getByRole('status').filter({ hasText: '반영 중' })

  // 처음 들어왔을 때는 안 보인다 (문서가 이미 그려져 있다)
  await expect(note).toHaveCount(0)

  const edit = page.getByRole('button', { name: '수정', exact: true }).first()
  await edit.click()
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  const before = await dlg.locator('#quote-notes').inputValue()
  const stamp = `QA-${Date.now()}`
  await dlg.locator('#quote-notes').fill(stamp)
  await dlg.getByRole('button', { name: '저장', exact: true }).click()

  // 저장 직후 「반영 중…」이 뜨고
  await expect(note).toBeVisible({ timeout: 20_000 })
  const seen = await note.innerText()
  // 다 불러오면 사라진다
  await expect(note).toHaveCount(0, { timeout: 30_000 })
  await expect(art).toContainText(stamp, { timeout: 30_000 })

  // 되돌린다 — 사용자 견적이다
  await edit.click()
  await expect(dlg).toBeVisible()
  await dlg.locator('#quote-notes').fill(before)
  await dlg.getByRole('button', { name: '저장', exact: true }).click()
  await expect(note).toHaveCount(0, { timeout: 30_000 })
  const after = await art.innerText()
  fs.writeFileSync('/tmp/qa-reload2.txt', `표시=${seen}\n되돌림=${!after.includes(stamp)}\n이전값=${JSON.stringify(before)}`)
  expect(after.includes(stamp), '되돌리지 못했다').toBe(false)
  console.log(`표시="${seen}" 되돌림=${!after.includes(stamp)}`)
})
