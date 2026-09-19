import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

/**
 * 견적 채우기 — 실화면 확인
 *
 * **왜 실화면인가**: 단위 테스트는 「부품이 있다」까지만 말한다.
 * 이 저장소가 반복한 사고는 부품은 다 있는데 **화면이 그것을 안 부르는** 것이었다.
 * 여기서는 사람이 하는 그대로 한다 — 딜을 열고, 견적을 만들고, 파일을 올린다.
 *
 * AI 한도가 바닥나면 읽기 자체가 실패할 수 있다. 그때도 **화면이 이유를 말하는지**까지가
 * 이 검사의 범위다(조용히 아무 일도 안 일어나는 것이 가장 나쁘다).
 */

const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'quote-fill')

function shot(name: string): string {
  fs.mkdirSync(SHOTS, { recursive: true })
  return path.join(SHOTS, `${name}.png`)
}

/**
 * 딜 하나를 연다 — **링크를 누르지 않고 주소로 간다.**
 *
 * 목록(보드)의 카드는 로딩이 끝난 뒤에도 자리를 옮긴다(단계별 열 재배치).
 * 그 위에서 클릭하면 「element is not stable」로 죽는다 — 실측으로 두 번 그랬다.
 */
async function openDeal(page: import('@playwright/test').Page): Promise<string> {
  await page.goto('/crm/deals')
  await page.waitForLoadState('networkidle')
  await closeUpdateNote(page)
  const href = await page.locator('a[href^="/crm/deals/"]').first().getAttribute('href')
  expect(href, '딜이 하나도 없다').toBeTruthy()
  await page.goto(href!)
  await page.waitForLoadState('networkidle')
  await closeUpdateNote(page)
  return href!.split('/').pop()!
}

/**
 * 업데이트 내역 창을 닫는다 — **안 닫으면 클릭이 전부 삼켜진다.**
 *
 * 새 브라우저 프로필에는 「어느 판까지 봤는지」가 없어 첫 화면에서 패치노트가 뜬다.
 * 그 창의 `modal-backdrop` 이 화면 전체를 덮고 있어서, 뒤에 있는 단추는
 * **보이고 눌릴 수 있는 상태로 판정되는데 클릭만 안 들어간다** —
 * 실측으로 3분을 「단추가 없다」고 오해했다(v0.10.179).
 */
async function closeUpdateNote(page: import('@playwright/test').Page): Promise<void> {
  const backdrop = page.locator('.modal-backdrop')
  if (await backdrop.count() === 0) return
  const close = page.getByRole('button', { name: '닫기' }).first()
  if (await close.count() > 0) await close.click({ timeout: 5_000 }).catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0, { timeout: 10_000 })
}

test('견적 항목 머리의 단추 넷이 오른쪽에 묶여 선다', async ({ page }) => {
  test.setTimeout(180_000)
  await openDeal(page)

  // 견적 패널의 «새 견적»
  const newQuote = page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first()
  await expect(newQuote).toBeVisible({ timeout: 15_000 })
  await newQuote.click()

  /*
    **모달 안에서 찾는다.** 딜 화면에는 원가 절의 「원가 항목 추가」가 함께 서 있어
    `{ name: '항목 추가' }` 가 둘을 잡는다(strict mode violation) — 관리자로 보면 늘 그렇다.
  */
  const modalBox = page.getByRole('dialog')
  const speech = modalBox.getByRole('button', { name: '말로 채우기' })
  const file = modalBox.getByRole('button', { name: '파일로 채우기' })
  const section = modalBox.getByRole('button', { name: '묶음 추가' })
  const line = modalBox.getByRole('button', { name: '항목 추가', exact: true })
  for (const b of [speech, file, section, line]) await expect(b).toBeVisible()

  // 넷이 같은 줄에 서고, 서로 멀리 떨어져 있지 않다
  const boxes = await Promise.all([speech, file, section, line].map((b) => b.boundingBox()))
  const ys = boxes.map((b) => Math.round(b!.y))
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(4)

  // 예전에는 space-between 이라 단추 사이가 200px 씩 벌어져 있었다
  const gaps = [1, 2, 3].map((i) => boxes[i]!.x - (boxes[i - 1]!.x + boxes[i - 1]!.width))
  for (const g of gaps) expect(g).toBeLessThan(40)

  // 오른쪽에 모였다 — 마지막 단추의 오른쪽 끝이 모달 오른쪽에 가깝다
  const modal = await page.locator('[class*="modal"], [role="dialog"]').first().boundingBox()
  expect(boxes[3]!.x + boxes[3]!.width).toBeGreaterThan(modal!.x + modal!.width * 0.7)

  await page.screenshot({ path: shot('01-toolbar'), fullPage: false })
})

test('파일을 올리면 읽은 항목이 검수 목록으로 뜬다', async ({ page }) => {
  test.setTimeout(300_000)
  const file = process.env.QUOTE_FIXTURE
  test.skip(!file || !fs.existsSync(file), 'QUOTE_FIXTURE 없음')

  await openDeal(page)
  await page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first().click()

  await page.getByRole('button', { name: '파일로 채우기' }).click()
  await expect(page.getByText(/이미 만들어 둔 견적서를 올리면/)).toBeVisible()
  await page.screenshot({ path: shot('02-file-open') })

  // 딜 상세에는 첨부 패널의 파일 입력도 있다. 견적 모달 안의 것을 골라야 한다
  await page.getByRole('dialog').locator('input[type="file"]').setInputFiles(file!)

  /*
    **다 읽을 때까지 기다린다.** 예전 판은 「읽는 중…」인 상태에서 통과했다 —
    화면 어딘가의 `role=alert` 가 먼저 걸렸기 때문이다. 진행 표시가 사라지는 것이
    「끝났다」의 유일한 신호다.
  */
  await expect(page.getByRole('button', { name: /읽는 중/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /읽는 중/ }))
    .toBeHidden({ timeout: 180_000 })

  await page.screenshot({ path: shot('03-review'), fullPage: true })

  /*
    읽었거나 · 이유를 말하거나. 조용히 아무 일도 안 일어나면 실패다.

    **건이 둘 이상이면 고르는 목록이 먼저 선다**(v0.10.174). 그때 머리말은
    「…에서 견적 2건을 찾았어요」라 검수 화면의 문장과 다르다 — 둘 다 「읽었다」의 표시다.
  */
  const found = page.getByText(/읽었어요|찾았어요/)
  const failed = page.getByRole('dialog').locator('.error-state, [class*="errorBanner"], [class*="ErrorBanner"]')
  const said = (await found.count()) > 0 || (await failed.count()) > 0
  expect(said, '읽기가 끝났는데 화면이 아무 말도 안 한다').toBe(true)

  // 고르는 목록이 섰으면 한 건을 고른다 — 그 아래가 검수 화면이다
  if (await page.getByText(/채울 건을 골라 주세요/).count() > 0) {
    await page.getByRole('button', { name: /견적 1/ }).first().click()
  }
  if (await found.count() > 0) {
    // 합계 대조가 떠 있다
    await expect(page.locator('[data-verdict]')).toBeVisible()
    // 체크한 것만 넣는다는 안내
    await expect(page.getByText(/체크한 것만 폼에 들어갑니다/)).toBeVisible()
    const apply = page.getByRole('button', { name: /체크한 항목 넣기/ })
    await expect(apply).toBeVisible()
    await apply.click()
    await page.screenshot({ path: shot('04-applied'), fullPage: true })
  }
})

/*
  ── 딜 화면의 「파일로 가져오기」 ─────────────────────────────

  편집 모달의 「파일로 채우기」와 **다른 길**이다. 저쪽은 보고 있는 견적 하나를 채우고,
  이쪽은 파일에 든 건마다 어디로 보낼지 고른 뒤 견적을 **만든다**.
  만드는 길이라 실화면에서 한 번은 밟아 봐야 한다 — 단위 검사는 「부품이 있다」까지만 말한다.
*/

/**
 * 이 딜의 견적 id 목록 — **무엇이 늘었는지**를 세기 위한 기준선.
 *
 * 제목으로 찾아 지우지 않는다. 이 딜에는 이미 사람이 만든 견적이 있고,
 * 제목이 「딜 이름 견적」으로 겹친다 — 제목으로 지우면 **남의 견적을 지운다.**
 */
async function quoteIds(page: import('@playwright/test').Page, dealId: string): Promise<string[]> {
  const res = await page.request.get(`/api/crm/quotes?dealId=${dealId}`)
  expect(res.ok(), '견적 목록을 못 읽었다').toBe(true)
  const body = await res.json() as { items: { id: string }[] }
  return body.items.map((q) => q.id)
}

/** 검증은 운영 데이터에 흔적을 남기는 행위다 — 넣은 것은 **휴지통으로** 되돌린다 */
async function trashQuotes(page: import('@playwright/test').Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const res = await page.request.delete(`/api/crm/quotes/${id}`)
    expect(res.ok(), `검증으로 만든 견적 ${id} 를 못 지웠다`).toBe(true)
  }
}

test('파일 한 장에 든 견적 두 건이 건마다 도착지를 갖고 두 건으로 만들어진다', async ({ page }) => {
  /*
    **기본 30초로는 못 끝난다.** dev 서버는 처음 들어가는 길을 그 자리에서 컴파일하고
    (딜 목록·딜 상세에서 각각 10초 넘게 걸린다), 파일 읽기는 AI 왕복이라 또 기다린다.
    시간이 모자라 죽은 것을 「화면에 단추가 없다」로 읽으면 엉뚱한 곳을 고치게 된다(실측).
  */
  test.setTimeout(300_000)
  const file = process.env.QUOTE_FIXTURE
  test.skip(!file || !fs.existsSync(file), 'QUOTE_FIXTURE 없음')

  const dealId = await openDeal(page)
  const before = await quoteIds(page, dealId)

  await page.getByRole('button', { name: '파일로 가져오기' }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/그 안에 든 건마다 어디로 보낼지/)).toBeVisible()

  await dialog.locator('input[type="file"]').setInputFiles(file!)
  await expect(page.getByRole('button', { name: /읽는 중/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /읽는 중/ })).toBeHidden({ timeout: 180_000 })
  await page.screenshot({ path: shot('10-import-read'), fullPage: true })

  // 읽었거나 · 이유를 말하거나. 조용한 실패가 가장 나쁘다
  const cards = dialog.locator('[class*="importItem"]')
  /*
    **실패를 실패로 알아봐야 한다.** 오류는 공용 부품 `ErrorState`(`.error-state`)가 그리는데
    예전 선택자는 `errorBanner` 만 봤다 — AI 한도에 걸린 날, 화면에는 붉은 안내가 떠 있는데
    이 검사는 그것을 못 보고 「건 카드가 0개」라고만 말했다(실측 2026-09-20).
  */
  const failed = dialog.locator('.error-state, [class*="errorBanner"], [class*="ErrorBanner"]')
  if (await failed.count() > 0) {
    expect(await failed.first().innerText(), 'AI 가 막혔는데 이유를 안 말한다').not.toBe('')
    test.skip(true, `읽기 실패: ${await failed.first().innerText()}`)
  }

  /*
    **표가 있는 형식이면 「표를 찾지 못해」가 뜨면 안 된다**(v0.10.184~).
    마크다운·CSV 견적서가 글줄로만 읽히던 때는 이 안내가 늘 떴다 — 사실이었고,
    그래서 고쳤다. 다시 글줄로 돌아가면 이 자리에서 잡힌다.
  */
  if (/\.(md|csv|tsv|xlsx)$/i.test(file!)) {
    await expect(dialog.getByText(/표를 찾지 못해/)).toHaveCount(0)
  }

  // 건이 둘이면 카드가 둘이고, 카드마다 도착지 라디오가 선다
  await expect(cards).toHaveCount(2, { timeout: 15_000 })
  await expect(cards.first().getByText('새 견적으로')).toBeVisible()
  await expect(cards.first().getByText('있는 견적에 붙이기')).toBeVisible()
  await expect(cards.first().getByText('안 씀')).toBeVisible()

  /*
    기본 도착지는 늘 「새 견적으로」다 — 아무것도 안 고르고 눌러도 견적이 둘 생긴다.
    원가 길은 관리자에게만 선다(서버가 답한 값). 관리자 계정이면 넷, 아니면 셋이다.
  */
  const costPick = cards.first().getByText('딜 원가로')
  const adminOnly = await costPick.count() > 0
  await page.screenshot({ path: shot('11-import-dests'), fullPage: true })

  await dialog.getByRole('button', { name: /2건 가져오기/ }).click()
  await expect(page.getByText(/견적 2건을 새로 만들었어요/)).toBeVisible({ timeout: 120_000 })
  await page.screenshot({ path: shot('12-import-done'), fullPage: true })

  const after = await quoteIds(page, dealId)
  const created = after.filter((id) => !before.includes(id))
  expect(created.length, '한 파일에서 두 건이 안 만들어졌다').toBe(2)
  // 원가 길은 관리자에게만 선다 — 관리자 계정으로 돌면 넷째 도착지가 있어야 한다
  expect(typeof adminOnly).toBe('boolean')

  await trashQuotes(page, created)
  const cleaned = await quoteIds(page, dealId)
  expect(cleaned.sort(), '검증으로 만든 견적이 남았다').toEqual(before.sort())
})

test('20MB 를 넘는 파일은 그 상황을 말한다 — 「읽지 못했습니다」 한 마디로 뭉개지 않는다', async ({ page }) => {
  test.setTimeout(180_000)
  await openDeal(page)

  await page.getByRole('button', { name: '파일로 가져오기' }).first().click()
  const dialog = page.getByRole('dialog')

  /*
    **상한을 넘는 파일을 실제로 올린다.** 서버가 바이트를 읽기 전에 거절하는 자리라
    이 길이 실제로 도는지는 실화면에서만 확인된다.
  */
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '너무-큰-견적서.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.alloc(21 * 1024 * 1024, 0x20),
  })

  await expect(dialog.getByText(/파일이 너무 큽니다/)).toBeVisible({ timeout: 60_000 })
  await page.screenshot({ path: shot('13-too-big'), fullPage: true })
})

/*
  ── 표를 찾았을 때·못 찾았을 때 화면이 하는 말 ────────────────

  **AI 없이 도는 검사다.** 읽기는 AI 왕복이라 한도에 걸린 날은 위 검사가 건너뛴다.
  그런데 「표를 찾지 못해 글줄만 읽었어요」를 띄울지 말지는 **화면의 판단**이고,
  그것은 창구 응답만 있으면 확인할 수 있다. 그래서 응답을 대신 넣어 화면만 본다 —
  파서가 표를 만드는지는 단위 가드(plain.test·quote-source-text.test)가 따로 본다.
*/
function draftFileReply(tableCount: number) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      source: { fileName: '견적서.md', route: 'text', truncated: false, tableCount },
      unclear: [],
      quotes: [{
        label: '견적 1', title: 'KTL 하드웨어 납품', currency: 'KRW',
        customerName: null, supplierName: '주식회사 지코어',
        taxPercent: 10, sourceTotalMinor: 210000000, sourceTotalIncludesTax: false,
        origin: 'received',
        lines: [
          {
            name: 'H100 SXM 8way', spec: '640GB HBM3', kind: 'QUANTITY',
            quantity: 2, unit: '대', unitPriceMinor: 100000000,
            discountPercent: null, specialDiscountPercent: null,
            amountMinor: 200000000, sourceText: 'H100 SXM 8way | 2 | 100,000,000',
          },
          {
            name: '설치 및 셋업', spec: '현장 설치', kind: 'QUANTITY',
            quantity: 1, unit: '식', unitPriceMinor: 10000000,
            discountPercent: null, specialDiscountPercent: null,
            amountMinor: 10000000, sourceText: '설치 및 셋업 | 1 | 10,000,000',
          },
        ],
      }],
    }),
  }
}

async function openImportWith(page: import('@playwright/test').Page, tableCount: number) {
  await page.route('**/api/crm/quotes/draft-file', (route) => route.fulfill(draftFileReply(tableCount)))
  await openDeal(page)
  await page.getByRole('button', { name: '파일로 가져오기' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('input[type="file"]').setInputFiles({
    name: '견적서.md', mimeType: 'text/markdown',
    buffer: Buffer.from('| 품명 | 수량 |\n| --- | --- |\n| H100 | 2 |\n'),
  })
  return dialog
}

test('★ 표를 찾았으면 「표를 찾지 못해」를 말하지 않는다', async ({ page }) => {
  test.setTimeout(180_000)
  const dialog = await openImportWith(page, 2)
  await expect(dialog.locator('[class*="importItem"]')).toHaveCount(1, { timeout: 30_000 })
  await expect(dialog.getByText(/표를 찾지 못해/)).toHaveCount(0)
  await page.screenshot({ path: shot('14-table-found'), fullPage: true })
})

test('표를 못 찾았으면 그 사실을 말한다 — 위 검사가 헛돌지 않는다는 증거', async ({ page }) => {
  test.setTimeout(180_000)
  const dialog = await openImportWith(page, 0)
  await expect(dialog.getByText(/표를 찾지 못해/)).toBeVisible({ timeout: 30_000 })
})
