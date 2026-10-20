import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * 가격표 파일로 가져오기 — 읽기와 나란히 보기까지 (P0135 I12)
 *
 * 가격표는 대외비라 저장소에 두지 않는다. PRICEBOOK_SHEET 에 파일 경로를 주면 돈다(없으면 건너뜀).
 * PRICEBOOK_SAVE=1 이면 저장까지 한다 — 운영 DB 에 남으므로 첫 채움(I13)에서만 쓴다.
 */
const SHEET = process.env.PRICEBOOK_SHEET ?? ''

test('가격표를 올리면 원본과 읽은 결과가 나란히 서고 계산 예시가 맞는지 보인다', async ({ page }) => {
  test.skip(!SHEET, 'PRICEBOOK_SHEET 가 없다')
  test.setTimeout(300_000)
  await page.addInitScript(() => { try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* */ } })
  await page.goto('/crm/products', { waitUntil: 'domcontentloaded' })
  await expect(async () => {
    await page.getByRole('button', { name: '파일 가져오기' }).first().click()
    await expect(page.locator('#pb-file')).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await page.locator('#pb-file').setInputFiles({ name: basename(SHEET), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(SHEET) })
  await page.getByRole('button', { name: '읽기', exact: true }).click()
  await expect(page.getByRole('status')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/품목 \d+줄/)).toBeVisible({ timeout: 240_000 })
  await expect(page.getByText(/계산 예시 재현: 가격표의 계산 예시와 같아요/)).toBeVisible()
  await expect(page.getByLabel('나란히 보기')).toBeVisible()
  await page.screenshot({ path: 'apps/web/e2e/.out/pricebook-import-1280.png', fullPage: false })
  if (process.env.PRICEBOOK_SAVE === '1') {
    await page.getByRole('button', { name: '저장', exact: true }).click()
    await page.waitForURL(/\/crm\/products\/[^/?]+/, { timeout: 120_000 })
    // eslint-disable-next-line no-console
    console.log(`SAVED ${page.url()}`)
  }
})
