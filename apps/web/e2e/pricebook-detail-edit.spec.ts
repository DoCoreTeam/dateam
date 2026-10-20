import { test, expect, type Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 가격 기준 제품 상세 — 끌어 놓기와 빠졌던 기능 (P0138 I06)
 *
 * 바꾼 것은 화면으로 되돌린다(묶음, 판매 상태, 규칙 켬, 묶음 이름). 화면으로 못 되돌리는 것(할인 확정)은
 * 돌리는 쪽이 시험 전에 뜬 사본으로 DB 에서 되돌린다.
 *
 *   E2E_BASE_URL=http://localhost:3300 E2E_PRODUCT_ID=<제품 id> pnpm exec playwright test pricebook-detail-edit --project=chromium --no-deps
 */

const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'pricebook-detail')
const PRODUCT = process.env.E2E_PRODUCT_ID ?? ''
const shot = (name: string) => { fs.mkdirSync(SHOTS, { recursive: true }); return path.join(SHOTS, `${name}.png`) }

async function closeUpdateNote(page: Page): Promise<void> {
  const backdrop = page.locator('.modal-backdrop')
  if (await backdrop.count() === 0) return
  const close = page.getByRole('button', { name: '닫기' }).first()
  if (await close.count() > 0) await close.click({ timeout: 5_000 }).catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0, { timeout: 10_000 })
}

async function open(page: Page, view: string): Promise<void> {
  await page.goto(`/crm/products/${PRODUCT}?view=${view}`)
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('tab', { name: /기본 정보/ })).toBeVisible({ timeout: 30_000 })
  await closeUpdateNote(page)
}

/** 한 번 저장 응답을 기다린다 */
const saved = (page: Page, re: RegExp, method = 'PUT') =>
  page.waitForResponse((r) => re.test(r.url()) && r.request().method() === method && r.status() < 300, { timeout: 30_000 })

test.describe.configure({ mode: 'serial' })

test('품목: 손잡이를 끌어 다른 묶음에 놓으면 옮겨지고, 새로 고쳐도 남는다, 키보드 길로 되돌린다', async ({ page }) => {
  test.setTimeout(120_000)
  expect(PRODUCT).not.toBe('')
  await page.setViewportSize({ width: 1280, height: 900 })
  await open(page, 'items')
  const license = page.getByRole('region', { name: /^라이선스/ })
  const build = page.getByRole('region', { name: /^구축비/ })
  const handle = license.locator('[title*="개인 스토리지"][draggable="true"]')
  const done = saved(page, /\/items\/order$/)
  await handle.dragTo(build.locator('header'))
  await done
  // 이름 단추만 — 위로 아래로 복제 단추에도 같은 이름이 들어 있다
  const nameIn = (region: ReturnType<Page['getByRole']>) => region.locator('button[class*="boardName"]', { hasText: '개인 스토리지' })
  await expect(nameIn(build)).toBeVisible()
  await page.screenshot({ path: shot('1-moved') })
  await page.reload()
  await expect(nameIn(page.getByRole('region', { name: /^구축비/ }))).toBeVisible({ timeout: 30_000 })
  // 키보드 길: 줄의 묶음 고르기로 되돌린다
  const back = saved(page, /\/items\/order$/)
  await page.getByRole('combobox', { name: '개인 스토리지 묶음 옮기기' }).selectOption({ label: '라이선스 (영구, 1회 구매)' })
  await back
  await expect(nameIn(page.getByRole('region', { name: /^라이선스/ }))).toBeVisible()
})

test('품목: 위아래 단추로 순서를 바꾸고 되돌린다', async ({ page }) => {
  test.setTimeout(90_000)
  await open(page, 'items')
  const s = saved(page, /\/items\/order$/)
  await page.getByRole('button', { name: 'STD 아래로' }).click()
  await s
  const names = page.getByRole('region', { name: /^라이선스/ }).locator('button[class*="boardName"]')
  await expect(names.nth(0)).toContainText('ENT')
  const s2 = saved(page, /\/items\/order$/)
  await page.getByRole('button', { name: 'STD 위로' }).click()
  await s2
  await expect(names.nth(0)).toContainText('STD')
})

test('품목: 둘을 골라 판매 중지하고 다시 판매', async ({ page }) => {
  test.setTimeout(90_000)
  await open(page, 'items')
  await page.getByRole('checkbox', { name: '추가 교육 선택' }).check()
  await page.getByRole('checkbox', { name: '추가 노드 편입 선택' }).check()
  const bar = page.getByRole('toolbar')
  await expect(bar).toContainText('선택 2')
  await bar.getByRole('button', { name: /판매 중지/ }).click()
  await expect(page.getByText('2개를 바꿨어요')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /추가 교육/ }).getByText('판매 중지')).toBeVisible()
  await page.screenshot({ path: shot('2-stopped') })
  await page.getByRole('checkbox', { name: '추가 교육 선택' }).check()
  await page.getByRole('checkbox', { name: '추가 노드 편입 선택' }).check()
  await page.getByRole('toolbar').getByRole('button', { name: /다시 판매/ }).click()
  await expect(page.getByText('2개를 바꿨어요')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: /추가 교육/ }).getByText('판매 중지')).toHaveCount(0)
})

test('찾기: 찾는 동안은 걸러진 목록이고 순서를 못 바꾼다고 말한다', async ({ page }) => {
  await open(page, 'items')
  await page.getByRole('searchbox', { name: '품목 찾기' }).fill('구축')
  await expect(page.getByText('찾는 동안에는 순서를 바꿀 수 없어요')).toBeVisible()
  await expect(page.getByText('STD 기본 구축')).toBeVisible()
  await expect(page.getByText('개인 스토리지')).toHaveCount(0)
})

test('규칙: 끄면 「사람이 끔」, 새로 고쳐도 꺼져 있고, 다시 켠다', async ({ page }) => {
  test.setTimeout(90_000)
  await open(page, 'rules')
  const row = page.locator('li', { hasText: '상한' }).first()
  const s = saved(page, /\/rules$/)
  await row.getByRole('button', { name: '끄기' }).click()
  await s
  await page.reload()
  const again = page.locator('li', { hasText: '꺼 둠: 사람이 끔' }).first()
  await expect(again).toBeVisible({ timeout: 30_000 })
  await page.screenshot({ path: shot('3-rule-off') })
  const s2 = saved(page, /\/rules$/)
  await again.getByRole('button', { name: '켜기' }).click()
  await s2
  await expect(page.getByText('꺼 둠: 사람이 끔')).toHaveCount(0)
})

test('규칙: 고치기 창이 그 값으로 열린다, 지우기는 확인창을 거친다(취소)', async ({ page }) => {
  await open(page, 'rules')
  const row = page.locator('li', { hasText: '상한' }).first()
  await row.getByRole('button', { name: '수정' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('규칙 수정')
  await expect(dialog.locator('#ra-num')).not.toHaveValue('')
  await dialog.getByRole('button', { name: '취소' }).click()
  await row.getByRole('button', { name: '삭제' }).click()
  await expect(page.getByRole('dialog')).toContainText('이 규칙을 지울까요?')
  await page.getByRole('dialog').getByRole('button', { name: '취소' }).click()
})

test('할인: 제안값 확정을 누르면 「제안값」이 빠진다', async ({ page }) => {
  test.setTimeout(90_000)
  await open(page, 'discounts')
  const row = page.locator('li', { hasText: '교육기관' }).first()
  await expect(row).toContainText('제안값')
  const s = saved(page, /\/rules$/)
  await row.getByRole('button', { name: '제안값 확정' }).click()
  await s
  await expect(page.locator('li', { hasText: '교육기관' }).first()).not.toContainText('(제안값)')
})

test('기본 정보: 총비용 칸이 없고, 묶음 이름을 바꾸면 품목도 따라오고, 되돌린다', async ({ page }) => {
  test.setTimeout(120_000)
  await open(page, 'info')
  await expect(page.getByText('총비용 기간')).toHaveCount(0)
  const input = page.getByRole('textbox', { name: '구축비 (1회) 묶음 이름' })
  await input.fill('구축비 (1회) 시험')
  const s = saved(page, new RegExp(`/products/${PRODUCT}$`), 'PATCH')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await s
  await open(page, 'items')
  await expect(page.getByRole('region', { name: /^구축비 \(1회\) 시험/ }).locator('button[class*="boardName"]', { hasText: 'STD 기본 구축' })).toBeVisible({ timeout: 30_000 })
  await open(page, 'info')
  await page.getByRole('textbox', { name: '구축비 (1회) 시험 묶음 이름' }).fill('구축비 (1회)')
  const s2 = saved(page, new RegExp(`/products/${PRODUCT}$`), 'PATCH')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await s2
  await open(page, 'items')
  await expect(page.getByRole('region', { name: /^구축비 \(1회\)$/ })).toBeVisible({ timeout: 30_000 })
})

test('미리 계산: 총비용 줄 아래에 계산 기간 칸이 있다', async ({ page }) => {
  await open(page, 'preview')
  await page.getByRole('button', { name: '계산', exact: true }).click()
  await expect(page.getByText('미리 계산에만 쓰이고 견적에는 안 쓰여요')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('textbox', { name: '총비용 기간' })).toBeVisible()
  await page.screenshot({ path: shot('4-preview-tco') })
})

test('390px: 품목 판이 넘치지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await open(page, 'items')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  // 넘침 0 이어도 부모가 숨기면 잘린다 — 가격과 묶음 고르기와 복제의 오른쪽 끝을 직접 잰다
  const rightEdges = await page.evaluate(() => [...document.querySelectorAll('[class*="boardRow"] > *, [class*="itemsBar"] > *')]
    .map((el) => Math.round(el.getBoundingClientRect().right)))
  expect(Math.max(...rightEdges)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: shot('5-items-390'), fullPage: false })
})

test('기본 정보: 묶음을 더하고 빈 묶음은 지울 수 있다, 품목이 남은 묶음은 지우기가 막혀 있다(저장 안 함)', async ({ page }) => {
  await open(page, 'info')
  await expect(page.getByRole('button', { name: '구축비 (1회) 삭제' })).toBeDisabled()
  await page.getByRole('textbox', { name: '새 묶음 이름' }).fill('시험 묶음')
  await page.getByRole('button', { name: /묶음 추가/ }).click()
  await expect(page.getByRole('textbox', { name: '시험 묶음 묶음 이름' })).toBeVisible()
  await expect(page.getByText('저장하지 않은 바뀐 것이 있어요').or(page.getByRole('status'))).toBeVisible()
  await page.getByRole('button', { name: '시험 묶음 삭제' }).click()
  await expect(page.getByRole('textbox', { name: '시험 묶음 묶음 이름' })).toHaveCount(0)
})
