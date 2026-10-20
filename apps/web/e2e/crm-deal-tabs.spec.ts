import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 딜 화면 탭, 견적 카드 단추 말, 기존 STD 고객 — 실화면 한 바퀴 (P0137 I07)
 *
 * 돌리는 법: 로컬 운영 판을 :3300 에 올리고
 *   E2E_BASE_URL=http://localhost:3300 E2E_DEAL_ID=<딜 id> pnpm exec playwright test crm-deal-tabs --project=chromium --no-deps
 * 아무것도 저장하지 않는다(미리 계산만).
 */

const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'deal-tabs')
const DEAL_ID = process.env.E2E_DEAL_ID ?? ''

function shot(name: string): string {
  fs.mkdirSync(SHOTS, { recursive: true })
  return path.join(SHOTS, `${name}.png`)
}

async function closeUpdateNote(page: Page): Promise<void> {
  const backdrop = page.locator('.modal-backdrop')
  if (await backdrop.count() === 0) return
  const close = page.getByRole('button', { name: '닫기' }).first()
  if (await close.count() > 0) await close.click({ timeout: 5_000 }).catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0, { timeout: 10_000 })
}

async function openDeal(page: Page, query = ''): Promise<void> {
  await page.goto(`/crm/deals/${DEAL_ID}${query}`)
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('tablist', { name: '딜 화면 탭' })).toBeVisible({ timeout: 30_000 })
  await closeUpdateNote(page)
}

test('타임라인 탭이 바로 열리고 쓰기 칸이 첫 화면에 있다, 주소에 남는다', async ({ page }) => {
  test.setTimeout(120_000)
  expect(DEAL_ID).not.toBe('')
  await page.setViewportSize({ width: 1280, height: 900 })
  await openDeal(page)
  await page.getByRole('tab', { name: '타임라인' }).click()
  await expect(page).toHaveURL(/tab=timeline/)
  const input = page.getByPlaceholder('무슨 일이 있었나요?')
  await expect(input).toBeVisible()
  const box = await input.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(900)
  await page.screenshot({ path: shot('1-timeline-1280') })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByPlaceholder('무슨 일이 있었나요?')).toBeVisible({ timeout: 30_000 })
})

test('견적 탭의 단추 말이 짧다', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openDeal(page, '?tab=quote')
  for (const name of ['개정', '대안', '새 견적', '파일 가져오기', '원가 가져오기']) {
    await expect(page.getByRole('button', { name, exact: true }).first()).toBeVisible()
  }
  await expect(page.getByRole('button', { name: '휴지통', exact: true })).toBeVisible()
  for (const old of ['개정본 만들기', '다른 안 만들기', '딜 원가에서 가져오기', '삭제한 견적 보기']) {
    await expect(page.getByText(old, { exact: true })).toHaveCount(0)
  }
  await page.screenshot({ path: shot('2-quote-1280') })
})

test('제품으로 채우기가 기존 STD 고객을 근거와 함께 보이고, 켜고 ENT 로 계산하면 전환 구축이 든다', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openDeal(page, '?tab=quote')
  await page.getByRole('button', { name: /새 견적/ }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '제품으로 채우기' }).click()
  await dialog.locator('#pf-product').selectOption({ label: 'gcube edge' })
  const owned = dialog.getByRole('checkbox', { name: /기존 STD 고객/ })
  await expect(owned).toBeVisible({ timeout: 15_000 })
  await expect(dialog.getByText(/지난 계약: |지난 계약에서 찾지 못함/).first()).toBeVisible()
  if (!(await owned.isChecked())) await owned.check()
  await dialog.getByRole('checkbox', { name: 'ENT', exact: true }).check()
  await dialog.getByRole('button', { name: '계산', exact: true }).click()
  // 조건 목록에도 같은 이름의 체크가 있다 — 계산 결과의 근거 문장으로 본다
  await expect(dialog.getByText(/ENT 전환 구축 1식: 지난 계약에서 STD/).first()).toBeVisible({ timeout: 30_000 })
  // 끄면 빠진다
  await owned.uncheck()
  await dialog.getByRole('button', { name: '계산', exact: true }).click()
  await expect(dialog.getByText(/줄 \d+개/)).toBeVisible({ timeout: 30_000 })
  await expect(dialog.getByText(/ENT 전환 구축 1식: 지난 계약에서/)).toHaveCount(0)
  await page.screenshot({ path: shot('3-owned-std') })
})

test('390px 에서 탭이 넘치지 않는다', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await openDeal(page, '?tab=timeline')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await expect(page.getByPlaceholder('무슨 일이 있었나요?')).toBeVisible()
  await page.screenshot({ path: shot('4-tabs-390') })
})
