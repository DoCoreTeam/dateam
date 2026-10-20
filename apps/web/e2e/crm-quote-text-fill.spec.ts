import { test, expect, type Page, type Locator } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 말로 채우기 편집기 — 실화면 한 바퀴 (P0136 I12)
 *
 * 기획서 「화면」 절의 숙명여대 글을 쓰고 3초 멈추면 표가 채워지는지,
 * 표에서 고친 단가가 글을 바꿔도 남는지, 저장한 뒤 다시 열면 글이 그대로인지 본다.
 * 만든 견적은 끝에서 **id 로** 지운다(제목으로 지우면 남의 것을 지운다).
 *
 * 돌리는 법: 로컬 운영 판을 :3300 에 올리고
 *   E2E_BASE_URL=http://localhost:3300 E2E_DEAL_ID=<딜 id> pnpm exec playwright test crm-quote-text-fill --project=chromium --no-deps
 */

const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'quote-text-fill')
const DEAL_ID = process.env.E2E_DEAL_ID ?? ''
const TEXT = [
  '숙명여대 교수 연구용',
  '크레딧 2.8억',
  'EDGE 표준형, H100 4장, 6000 Ada 6장',
  '노드는 30대 정도',
  'SSO 정산 연동 고급 2MM',
  '설치는 우리가 다 해줌',
].join('\n')

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

/** 이름 칸 값으로 줄의 순번을 찾는다 */
async function lineIndex(dialog: Locator, name: RegExp): Promise<number> {
  const names = dialog.locator('[id^="ln-name-"]')
  const n = await names.count()
  for (let i = 0; i < n; i += 1) {
    const text = (await names.nth(i).innerText().catch(() => '')) || (await names.nth(i).inputValue().catch(() => ''))
    if (name.test(text)) return Number((await names.nth(i).getAttribute('id'))!.replace('ln-name-', ''))
  }
  return -1
}

async function waitFill(page: Page): Promise<void> {
  const res = await page.waitForResponse((r) => r.url().endsWith('/api/crm/quotes/text-fill') && r.request().method() === 'POST', { timeout: 60_000 })
  expect(res.status()).toBe(200)
}

test('글을 쓰고 멈추면 표가 채워지고, 고친 칸은 남고, 글은 저장된다', async ({ page }) => {
  test.setTimeout(240_000)
  expect(DEAL_ID, 'E2E_DEAL_ID 가 없다').not.toBe('')
  let quoteId: string | null = null
  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto(`/crm/deals/${DEAL_ID}`)
    await page.waitForLoadState('domcontentloaded')
    await closeUpdateNote(page)

    await page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first().click()
    const dialog = page.getByRole('dialog')
    const editor = dialog.locator('#quote-text-fill')
    await expect(editor).toBeVisible()

    // 「말로 채우기」 단추는 늘 열린 글 상자로 데려간다
    await dialog.getByRole('button', { name: '말로 채우기' }).click()
    await expect(editor).toBeFocused()

    // ① 쓰고 3초 멈추면 표가 채워진다
    const started = Date.now()
    await editor.fill(TEXT)
    await waitFill(page)
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_900)
    await expect(dialog.getByText(/표를 고쳤어요/)).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: shot('1-filled-1280'), fullPage: false })

    const credit = await lineIndex(dialog, /크레딧/)
    expect(credit).toBeGreaterThanOrEqual(0)
    await expect(dialog.locator(`#ln-price-${credit}`)).toHaveValue('280000000')
    const si = await lineIndex(dialog, /SSO/)
    await expect(dialog.locator(`#ln-price-${si}`)).toHaveValue('7800000')
    const dc = await lineIndex(dialog, /데이터센터/)
    await expect(dialog.locator(`#ln-qty-${dc}`)).toHaveValue('4')
    await expect(dialog.getByText(/노드 30대/).first()).toBeAttached()

    // ② 표에서 단가를 고치면 잠기고, 글을 바꿔도 남는다
    await dialog.locator(`#ln-price-${dc}`).fill('7000000')
    await expect(dialog.getByText('사람이 고침').first()).toBeVisible()
    await editor.fill(TEXT.replace('H100 4장', 'H100 6장'))
    await waitFill(page)
    const dc2 = await lineIndex(dialog, /데이터센터/)
    await expect(dialog.locator(`#ln-price-${dc2}`)).toHaveValue('7000000')
    await expect(dialog.locator(`#ln-qty-${dc2}`)).toHaveValue('6')

    // ③ 표의 「글 N째 줄」을 누르면 그 줄을 고른다
    await dialog.getByRole('button', { name: '글 2째 줄' }).first().click()
    const picked = await editor.evaluate((el: HTMLTextAreaElement) => el.value.slice(el.selectionStart, el.selectionEnd))
    expect(picked).toBe('크레딧 2.8억')

    // ④ 저장하고 다시 열면 글이 남는다
    const saved = page.waitForResponse((r) => /\/api\/crm\/quotes$/.test(r.url()) && r.request().method() === 'POST')
    await dialog.getByRole('button', { name: '저장', exact: true }).click()
    const res = await saved
    expect(res.status()).toBeLessThan(300)
    quoteId = ((await res.json()) as { id: string }).id
    const back = await page.request.get(`/api/crm/quotes/${quoteId}`)
    const body = await back.json() as { fillText: string; lines: { name: string }[] }
    expect(body.fillText).toBe(TEXT.replace('H100 4장', 'H100 6장'))
    expect(body.lines.some((l) => /크레딧/.test(l.name))).toBe(true)
  } finally {
    if (quoteId) await page.request.delete(`/api/crm/quotes/${quoteId}`)
  }
})

test('390px 에서도 글 상자와 표가 넘치지 않는다', async ({ page }) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/crm/deals/${DEAL_ID}`)
  await page.waitForLoadState('domcontentloaded')
  await closeUpdateNote(page)
  await page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first().click()
  const dialog = page.getByRole('dialog')
  const editor = dialog.locator('#quote-text-fill')
  await expect(editor).toBeVisible()
  const box = await editor.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
  await page.screenshot({ path: shot('2-editor-390'), fullPage: false })
})
