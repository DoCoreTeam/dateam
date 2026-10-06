import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 「얼마를 얼마 동안」 — 실화면 확인
 *
 * **왜 실화면인가**: 단위 시험은 「span 합이 12다」까지만 말한다. 그런데 실측 2026-10-04 에
 * **넘침이 0 인데 칸이 접혀** 품목명이 석 줄이 된 일이 있었다 — scrollWidth 만 재면
 * 「괜찮다」가 나온다. 그래서 칸 폭과 줄 수를 **함께** 잰다.
 *
 * 그리고 이 기능의 핵심은 「17대 × 2개월」이 **금액에 닿는가**다. 산식 줄과 합계를
 * 같은 화면에서 읽어 둘이 같은 말을 하는지 본다.
 */

const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'quote-duration')

function shot(name: string): string {
  fs.mkdirSync(SHOTS, { recursive: true })
  return path.join(SHOTS, `${name}.png`)
}

async function closeUpdateNote(page: import('@playwright/test').Page): Promise<void> {
  const backdrop = page.locator('.modal-backdrop')
  if (await backdrop.count() === 0) return
  const close = page.getByRole('button', { name: '닫기' }).first()
  if (await close.count() > 0) await close.click({ timeout: 5_000 }).catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0, { timeout: 10_000 })
}

/** 딜 하나를 연다 — 목록 카드는 자리를 옮기므로 주소로 간다 */
async function openDeal(page: import('@playwright/test').Page): Promise<void> {
  /*
    **networkidle 을 안 쓴다.** dev 서버는 HMR 소켓을 계속 물고 있어 「조용해지는 순간」이
    영영 안 오고, 실측으로 세 판이 180초를 그 자리에서 다 썼다. 기다릴 것을 **이름으로** 적는다.
  */
  await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
  await closeUpdateNote(page)
  const first = page.locator('a[href^="/crm/deals/"]').first()
  await expect(first).toBeVisible({ timeout: 60_000 })
  const href = await first.getAttribute('href')
  expect(href, '딜이 하나도 없다').toBeTruthy()
  await page.goto(href!, { waitUntil: 'domcontentloaded' })
  await closeUpdateNote(page)
}

async function openNewQuote(page: import('@playwright/test').Page) {
  const newQuote = page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first()
  await expect(newQuote).toBeVisible({ timeout: 20_000 })
  await newQuote.click()
  const modal = page.getByRole('dialog')
  await expect(modal).toBeVisible({ timeout: 15_000 })
  return modal
}

test('17대 × 2개월을 적으면 산식과 합계가 같은 말을 한다', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 900 })
  await openDeal(page)
  const modal = await openNewQuote(page)

  // 기간 칸은 **종류를 안 가린다** — 기본 종류(수량)에서 바로 보여야 한다
  const qty = modal.locator('#ln-qty-0')
  const unit = modal.locator('#ln-unit-0')
  const dur = modal.locator('#ln-dur-0')
  const durUnit = modal.locator('#ln-durunit-0')
  for (const f of [qty, unit, dur, durUnit]) await expect(f).toBeVisible()

  await qty.fill('17')
  await unit.fill('대')
  await dur.fill('2')
  await durUnit.selectOption('MONTH')
  await modal.locator('#ln-price-0').fill('936000')
  await modal.locator('#ln-name-0').fill('RTX5090 서버').catch(() => {})

  // 산식이 두 축을 다 적는다
  const formula = modal.locator('p[class*="lineFormula"]').first()
  await expect(formula).toBeVisible()
  const text = (await formula.innerText()).replace(/\s+/g, ' ')
  expect(text, `산식: ${text}`).toContain('17대')
  expect(text, `산식: ${text}`).toContain('2개월')
  expect(text, `산식: ${text}`).toContain('31,824,000')

  // 합계도 같은 숫자를 말한다 — 줄 밑과 합계가 갈리면 둘 다 못 믿는다
  const body = (await modal.innerText()).replace(/\s+/g, ' ')
  expect(body, '합계가 기간을 안 셌다').toContain('31,824,000')

  await page.screenshot({ path: shot('01-1280'), fullPage: false })
})

for (const width of [1280, 390]) {
  test(`${width} 에서 줄이 안 접힌다 — 넘침 0 만 보지 않고 칸 폭과 줄 수를 함께 잰다`, async ({ page }) => {
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 900 })
    await openDeal(page)
    const modal = await openNewQuote(page)

    await modal.locator('#ln-qty-0').fill('1440')
    await modal.locator('#ln-unit-0').fill('Hours')
    await modal.locator('#ln-dur-0').fill('2')
    await modal.locator('#ln-durunit-0').selectOption('MONTH')
    await modal.locator('#ln-price-0').fill('936000')

    const m = await page.evaluate(() => {
      const q = (s: string) => document.querySelector(s) as HTMLElement | null
      const lines = (el: HTMLElement | null) => {
        if (!el) return 0
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
        return Math.round(el.getBoundingClientRect().height / lh)
      }
      const name = q('#ln-name-0')?.closest('div[class*="colName"]') as HTMLElement | null
      const amount = q('#ln-qty-0')?.closest('div[class*="colAmount"]') as HTMLElement | null
      const row = q('#ln-qty-0')?.closest('div[class*="axisRow"]') as HTMLElement | null
      const box = (el: Element | null) => (el ? el.getBoundingClientRect() : null)
      return {
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        nameLines: lines(q('#ln-name-0')),
        nameWidth: Math.round(box(name)?.width ?? 0),
        amountWidth: Math.round(box(amount)?.width ?? 0),
        // 묶음 안의 네 칸이 모두 한 덩어리 안에 있는가 — 기간만 따로 떨어지면 안 된다
        inOneCell: ['#ln-qty-0', '#ln-unit-0', '#ln-dur-0', '#ln-durunit-0']
          .every((s) => !!q(s)?.closest('div[class*="colAmount"]')),
        // 묶음 안쪽이 몇 줄인가 — 390 에서는 두 줄까지 괜찮다
        axisRows: row
          ? new Set(['#ln-qty-0', '#ln-unit-0', '#ln-dur-0', '#ln-durunit-0']
            .map((s) => Math.round(box(q(s))?.top ?? 0))).size
          : 0,
        // 칸 하나라도 20px 밑으로 눌리면 글자가 안 들어간다
        minFieldWidth: Math.min(...['#ln-qty-0', '#ln-unit-0', '#ln-dur-0', '#ln-durunit-0']
          .map((s) => Math.round(box(q(s))?.width ?? 0))),
      }
    })

    expect(m.bodyOverflow, `가로 넘침 ${m.bodyOverflow}px`).toBeLessThanOrEqual(0)
    expect(m.nameLines, `품목명이 ${m.nameLines}줄이다 — 칸이 눌려 접혔다`).toBeLessThanOrEqual(2)
    expect(m.inOneCell, '기간이 묶음 밖으로 나갔다').toBe(true)
    expect(m.axisRows, `묶음 안쪽이 ${m.axisRows}줄이다`).toBeLessThanOrEqual(width < 520 ? 2 : 1)
    expect(m.minFieldWidth, `가장 좁은 칸이 ${m.minFieldWidth}px 다`).toBeGreaterThanOrEqual(40)

    await page.screenshot({ path: shot(`02-${width}`), fullPage: false })
  })
}
