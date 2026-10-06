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

test('견적서가 수량 칸에 「17 × 2개월」을 적고 합계가 원본과 같다', async ({ page }) => {
  test.setTimeout(240_000)
  await page.setViewportSize({ width: 1280, height: 1000 })

  /*
    **서버 창구로 만든다.** 품목 고르기 모달은 카탈로그를 찾아오는 동안 열려 있고,
    이 시험이 보려는 것은 거기가 아니라 **만들어진 견적서가 두 축을 어떻게 적는가**다.
    창구를 그대로 쓰므로 화이트리스트·검증·금액 계산은 사람이 저장할 때와 같은 길을 지난다.
  */
  await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
  const firstDeal = page.locator('a[href^="/crm/deals/"]').first()
  await expect(firstDeal).toBeVisible({ timeout: 60_000 })
  const dealId = (await firstDeal.getAttribute('href'))!.split('/').pop()!

  const made = await page.request.post('/api/crm/quotes', {
    data: {
      dealId,
      title: '[P0117 확인용] GPU 임대 견적',
      lines: [{
        name: 'RTX5090 서버', kind: 'QUANTITY',
        quantity: '17', unit: '대',
        durationValue: '2', durationUnit: 'MONTH',
        unitPriceMinor: '936000', discountPercent: '0', taxRate: '10',
      }],
    },
  })
  expect(made.ok(), `만들기 실패 ${made.status()} ${await made.text()}`).toBeTruthy()
  const quote = await made.json()
  const id: string = quote.id ?? quote.item?.id
  expect(id, `견적 id 를 못 받았다: ${JSON.stringify(quote).slice(0, 300)}`).toBeTruthy()

  try {
    // 서버가 센 금액이 두 축을 곱한 값이어야 한다 — 화면을 열기 전에 먼저 본다
    const totals = quote.totalMinor ?? quote.item?.totalMinor
    expect(String(totals), '서버 합계가 기간을 안 셌다').toBe('35006400')

    await page.goto(`/crm/quotes/${id}`, { waitUntil: 'domcontentloaded' })
    await closeUpdateNote(page)
    await expect(page.locator('table').first()).toBeVisible({ timeout: 30_000 })

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ')
    expect(body, '수량이 대수가 아니다').toContain('17')
    expect(body, '기간이 수량 칸에 안 섰다').toContain('× 2개월')
    expect(body, '공급가액이 두 축을 안 셌다').toContain('31,824,000')
    expect(body, '합계가 틀리다').toContain('35,006,400')

    await page.screenshot({ path: shot('03-sheet'), fullPage: true })
  } finally {
    /*
      **치운다.** 만든 것은 id 로 영구삭제한다 — 제목으로 지우면 남의 것을 지운다.
      finally 에 두는 이유: 단정이 깨져도 시험 찌꺼기는 남으면 안 된다.
    */
    const res = await page.request.delete(`/api/crm/quotes/${id}?mode=purge`)
    expect(res.ok(), `치우기 실패 ${res.status()}`).toBeTruthy()
  }
})

test('기간이 수량 칸에 있는 옛 줄에 안내가 선다. 금액은 안 바뀐다', async ({ page }) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 1280, height: 1000 })
  await openDeal(page)
  const modal = await openNewQuote(page)

  // 「유지보수 12개월」처럼 기간이 수량 칸을 차지한 옛 모양을 그대로 재현한다
  await modal.locator('#ln-qty-0').fill('12')
  await modal.locator('#ln-unit-0').fill('개월')
  await modal.locator('#ln-price-0').fill('1000000')

  const hint = modal.locator('p[class*="axisHint"]').first()
  await expect(hint, '옛 줄에 안내가 안 선다').toBeVisible({ timeout: 10_000 })
  const text = await hint.innerText()
  expect(text).toContain('기간이 수량 칸에 있어요')
  // 「틀렸다」고 말하지 않는다. 그 줄의 금액은 맞다
  expect(text).not.toContain('틀렸')

  // 금액은 한 축 그대로다
  const body = (await modal.innerText()).replace(/\s+/g, ' ')
  expect(body, '안내가 금액을 바꿨다').toContain('12,000,000')

  // 기간 칸을 채우면 안내가 사라진다. 고치는 길이 바로 옆에 있다
  await modal.locator('#ln-qty-0').fill('1')
  await modal.locator('#ln-unit-0').fill('식')
  await modal.locator('#ln-dur-0').fill('12')
  await modal.locator('#ln-durunit-0').selectOption('MONTH')
  await expect(hint).toBeHidden({ timeout: 10_000 })

  await page.screenshot({ path: shot('04-legacy-hint'), fullPage: false })
})

/* ──────────────────────────────────────────────────────────────────────────
   실제 원본 모양을 AI 가 읽는가 — **진짜 호출**이다

   스키마와 지시 가드는 「받을 준비가 됐다」까지만 말한다. 모델이 그 지시를 **실제로 따르는지**는
   돌려 봐야 안다. 사용자가 보여 준 원본(수량 17 · 단가 936,000 · 약정 기간 결제일로 부터 2개월)과
   같은 모양을 올려 기간이 폼까지 닿는지 본다.

   AI 한도·키가 막히면 읽기 자체가 실패할 수 있다. 그때도 **화면이 이유를 말하는지**까지가
   이 검사의 범위다 — 조용히 아무 일도 안 일어나는 것이 가장 나쁘다.
   ────────────────────────────────────────────────────────────────────────── */

/** 사용자가 보여 준 원본의 표를 그대로 옮긴 모양 */
const ORIGINAL = [
  '# 견 적 서',
  '',
  '| 고객명 | 주식회사 톡키 |',
  '| 견적일 | 2026-09-29 |',
  '| 유효기간 | 견적일로부터 30일 |',
  '| 이용금액 | 하기 단가 참조 (단위: 원 VAT별도) |',
  '| 약정 기간 | 결제일로 부터 2개월 |',
  '| 결제 수단 | 이체 |',
  '',
  '| No. | 품명 | 규격 | 수량 | 단가 | 공급가액 | 할인가 | 세액 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  '| 1 | RTX5090 서버 | CPU: 12 코어 이상 / GPU: NVIDIA RTX 5090 (VRAM 32GB) / RAM: 32GB 이상 / Storage: NVMe SSD 500GB 이상 / OS: Ubuntu 22.04 | 17 | 936,000 | 15,912,000 | 15,900,000 | 1,590,000 |',
  '',
  '| 금액 | | | | | 31,800,000 | | 3,180,000 |',
  '| 총 금액 (VAT포함) | 2개월 | | | | 34,980,000 | | |',
  '',
].join('\n')

test('실제 원본 모양을 올리면 AI 가 17대와 2개월을 갈라 읽는다', async ({ page }) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openDeal(page)
  const modal = await openNewQuote(page)

  await modal.getByRole('button', { name: '파일로 채우기' }).click()
  await modal.locator('input[type="file"]').setInputFiles({
    name: '20260929_톡키_견적서.md', mimeType: 'text/markdown',
    buffer: Buffer.from(ORIGINAL, 'utf-8'),
  })

  // 「읽는 중」이 사라지는 것이 끝났다는 유일한 신호다
  const reading = page.getByRole('button', { name: /읽는 중/ })
  await expect(reading).toBeVisible({ timeout: 30_000 })
  await expect(reading).toBeHidden({ timeout: 240_000 })
  await page.screenshot({ path: shot('05-read'), fullPage: true })

  const body = (await modal.innerText()).replace(/\s+/g, ' ')

  /*
    **읽었거나 · 이유를 말하거나.** AI 한도가 막히면 읽기가 실패할 수 있고,
    그때도 화면이 왜 안 됐는지는 말해야 한다. 조용한 것이 가장 나쁘다.
  */
  const read = /읽었어요|찾았어요/.test(body)
  /*
    못 읽었을 때 화면이 **왜**를 말하는지. 실측으로 본 말들을 넓게 받는다 —
    「AI 응답이 시간 안에 오지 않았습니다」처럼 「실패」라는 글자가 없는 문장이 흔하다.
  */
  const said = read || /안 돼|안 왔|오지 않|실패|한도|오류|못 |다시 시도/.test(body)
  expect(said, `읽기가 끝났는데 화면이 아무 말도 안 한다:\n${body.slice(0, 600)}`).toBe(true)

  if (!read) {
    // 못 읽었으면 **못 읽었다고 적고** 여기서 멈춘다 — 가짜 통과를 만들지 않는다
    console.log('AI 읽기 실패(한도·키 등). 화면이 말한 것:', body.slice(0, 400))
    return
  }

  /*
    **「약정 기간」은 표 밖에 있다.** 그래서 모델이 그것을 **건의 기간**으로 읽는 것이 맞고,
    우리는 그 기간을 줄에 **자동으로 안 내린다** — 설치비 한 줄만 일시불인 견적이 흔해서다.
    사람이 누르는 자리가 있고, 여기서 그 길을 그대로 밟는다.
  */
  const suggest = modal.getByRole('button', { name: /기간이 빈 \d+개 항목에 넣기/ })
  const suggested = await suggest.count() > 0
  if (suggested) {
    console.log('문서 기간 제안:', await suggest.innerText())
    await suggest.click()
  }

  /*
    **체크부터 한다.** 위험 신호가 붙은 줄은 꺼진 채로 뜨고(켜는 행동이 「내가 봤다」는 뜻이다),
    이 문서는 줄 금액을 기간 전으로 적어 그 신호가 반드시 붙는다 — 안 켜면 넣기 단추가 안 선다.
  */
  const pick = modal.locator('input[type="checkbox"]').first()
  if (!(await pick.isChecked())) await pick.check()

  const apply = modal.getByRole('button', { name: /체크한 항목 넣기/ })
  await expect(apply).toBeEnabled({ timeout: 10_000 })
  await apply.click()

  const qty = await modal.locator('#ln-qty-0').inputValue()
  const unit = await modal.locator('#ln-unit-0').inputValue()
  const dur = await modal.locator('#ln-dur-0').inputValue()
  const durUnit = await modal.locator('#ln-durunit-0').inputValue()
  const price = await modal.locator('#ln-price-0').inputValue()
  console.log('읽은 값:', { qty, unit, dur, durUnit, price })

  expect(qty, '수량이 대수가 아니다').toBe('17')
  expect(unit, `단위가 「${unit}」다 — 기간 말이 수량 단위 자리에 들어갔다`).not.toMatch(/개월|월|시간|Hours/i)
  expect(price, '단가를 못 읽었다').toBe('936000')
  /*
    기간은 **줄에서 읽었거나 · 건에서 읽어 사람이 내렸거나** 둘 중 하나로 와야 한다.
    둘 다 아니면 「약정 기간 2개월」이 어디에서도 안 잡힌 것이고, 그건 이번 판이 고치려던 바로 그 결함이다.
  */
  expect(`${dur}${durUnit}`,
    `기간이 안 들어왔다 (문서 기간 제안 ${suggested ? '있었음' : '없었음'})`).toBe('2MONTH')

  await page.screenshot({ path: shot('06-applied'), fullPage: true })
})
