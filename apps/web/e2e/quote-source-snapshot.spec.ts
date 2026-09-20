import { test, expect } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'
import { dismissGlobalModals } from './_helpers'

/**
 * 원본 조각 — **실화면 확인**
 *
 * ## 왜 실화면이어야 하나
 *
 * 쪽을 그리는 길(pdfjs → 캔버스 → PNG)은 **브라우저에서만 돈다.** 타입 검사도 단위 시험도
 * 그 자리를 못 밟는다. 이 저장소가 반복한 사고가 정확히 그 모양이다 —
 * 부품은 다 있는데 화면이 안 부르거나, 불러도 브라우저에서만 죽는다.
 *
 * ## 무엇을 확인하나
 *
 *   ① 두 쪽짜리 견적서를 올리면 건이 둘로 읽히고, 건마다 몇 쪽인지 화면이 말한다
 *   ② 만들면 견적마다 **그 쪽만 오린 PNG** 가 첨부로 붙는다
 *   ③ 대조를 열면 왼쪽이 파일 1쪽이 아니라 **그 건의 쪽**이고, 제목 옆에 「원본 n쪽」이 붙는다
 *
 * ## 만든 것은 되돌린다
 *
 * 이 검사는 운영 DB 에 견적을 실제로 만든다. 끝나면 **만든 id 로** 지운다 —
 * 제목으로 지우면 남의 것을 지울 수 있다.
 *
 * AI 한도가 바닥나면 읽기 자체가 안 된다. 그때는 화면이 이유를 말하는지까지 보고 건너뛴다.
 */

const FIXTURE = path.join(__dirname, 'fixtures', 'two-quotes.pdf')
const SHOTS = path.join(__dirname, '..', '..', '..', 'artifacts', 'quote-snapshot')

function shot(name: string): string {
  fs.mkdirSync(SHOTS, { recursive: true })
  return path.join(SHOTS, `${name}.png`)
}

/** 업데이트 내역 창이 클릭을 삼킨다 — 보이고 눌릴 수 있는데 클릭만 안 들어간다 */
async function closeUpdateNote(page: import('@playwright/test').Page): Promise<void> {
  const backdrop = page.locator('.modal-backdrop')
  if (await backdrop.count() === 0) return
  const close = page.getByRole('button', { name: '닫기' }).first()
  if (await close.count() > 0) await close.click({ timeout: 5_000 }).catch(() => {})
  else await page.keyboard.press('Escape')
  await expect(backdrop).toHaveCount(0, { timeout: 10_000 })
}

test('두 건짜리 PDF 를 올리면 견적마다 자기 쪽 조각을 갖고, 대조가 그 쪽을 연다', async ({ page }) => {
  test.setTimeout(420_000)
  expect(fs.existsSync(FIXTURE), '붙박이 PDF 가 없다').toBe(true)

  /** 끝나고 되돌릴 것 — **id 로** 지운다 */
  const madeQuoteIds: string[] = []

  try {
    // 딜은 주소로 간다 — 보드의 카드는 로딩 뒤에도 자리를 옮겨 클릭이 불안정하다
    await page.goto('/crm/deals')
    await page.waitForLoadState('networkidle')
    await closeUpdateNote(page)
    await dismissGlobalModals(page)
    const href = await page.locator('a[href^="/crm/deals/"]').first().getAttribute('href')
    expect(href, '딜이 하나도 없다').toBeTruthy()
    await page.goto(href!)
    await page.waitForLoadState('networkidle')
    await closeUpdateNote(page)

    await page.getByRole('button', { name: '파일로 가져오기' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.locator('input[type="file"]').setInputFiles(FIXTURE)

    // 진행 표시가 사라지는 것이 「끝났다」의 유일한 신호다
    await expect(page.getByRole('button', { name: /읽는 중/ })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /읽는 중/ })).toBeHidden({ timeout: 300_000 })
    await page.screenshot({ path: shot('01-read'), fullPage: true })

    const failed = dialog.locator('.error-state, [class*="errorBanner"], [class*="ErrorBanner"]')
    if (await failed.count() > 0) {
      const why = await failed.first().innerText()
      test.skip(true, `읽기가 안 됐다(화면이 이유를 말한다): ${why.slice(0, 120)}`)
    }

    // ① 건마다 몇 쪽인지 화면이 말한다
    const pageBadge = dialog.getByText(/원본 \d+(-\d+)?쪽/)
    expect(await pageBadge.count(), '건 카드에 쪽이 안 적혀 있다').toBeGreaterThan(0)

    /*
      ② 항목을 켠다.

      **단가를 못 읽은 줄은 기본으로 꺼져 있다**(0원짜리 줄이 조용히 들어가지 않게).
      이 붙박이 PDF 는 제안가만 있고 단가 칸이 없어 전부 꺼진 채로 뜬다 —
      사람이 하는 그대로 카드를 펴고 켠다.
    */
    await dialog.getByRole('button', { name: /항목 보기/ }).first().click()
    const boxes = dialog.locator('input[type="checkbox"]')
    const n = await boxes.count()
    expect(n, '검수 목록에 줄이 없다').toBeGreaterThan(0)
    for (let i = 0; i < n; i += 1) {
      const box = boxes.nth(i)
      if (!(await box.isChecked())) await box.check()
    }

    const submit = dialog.getByRole('button', { name: /\d+건 가져오기/ }).last()
    await expect(submit).toBeEnabled({ timeout: 10_000 })
    await submit.click()
    await expect(dialog).toBeHidden({ timeout: 300_000 })
    await page.waitForLoadState('networkidle')
    await page.screenshot({ path: shot('02-made'), fullPage: true })

    // 이 딜의 견적 가운데 방금 만든 것 — 파일에서 온 표시가 붙어 있다
    const dealId = href!.split('/').pop()!
    const listRes = await page.request.get(`/api/crm/quotes?dealId=${dealId}`)
    expect(listRes.ok(), '견적 목록을 못 읽었다').toBe(true)
    const list = await listRes.json() as { items?: Array<{ id: string; fromFileAt?: string | null; sourcePageStart?: number | null }> }
    const fromFile = (list.items ?? []).filter((q) => q.fromFileAt)
    expect(fromFile.length, '파일에서 만든 견적이 없다').toBeGreaterThan(0)
    madeQuoteIds.push(...fromFile.map((q) => q.id))

    // ③ 쪽이 실제로 저장됐다
    const withPage = fromFile.filter((q) => typeof q.sourcePageStart === 'number')
    expect(withPage.length, '쪽이 하나도 저장되지 않았다').toBeGreaterThan(0)

    // ④ 그 견적에 조각(png)이 붙어 있다 — 오려 붙이는 길이 브라우저에서 실제로 돌았다는 증거
    const target = withPage[0]

    /*
      ④ 구성이 **저장까지** 살아 있다.

      화면에서는 여러 줄이었는데 저장하며 한 줄로 뭉치던 자리가 있었다
      (`normalizeText` 가 줄바꿈까지 공백으로 눕혔다). 화면만 보면 안 보이고
      타입 검사도 단위 시험도 못 밟는 자리라, 저장된 값을 직접 본다.
    */
    const detail = await (await page.request.get(`/api/crm/quotes/${target.id}`)).json() as
      { lines?: Array<{ name: string; descriptionMd?: string | null }> }
    const composed = (detail.lines ?? []).filter((l) => (l.descriptionMd ?? '').includes('\n'))
    expect(composed.length,
      `구성이 저장에서 한 줄로 뭉쳤다: ${(detail.lines ?? []).map((l) => l.name).join(', ')}`)
      .toBeGreaterThan(0)

    const attRes = await page.request.get(`/api/crm/attachments?target=QUOTE&targetId=${target.id}`)
    const atts = await attRes.json() as { items?: Array<{ id: string; fileName: string; mimeType: string | null }> }
    const cut = (atts.items ?? []).find((a) => (a.mimeType ?? '').startsWith('image/'))
    expect(cut, `조각이 안 붙었다 (첨부: ${(atts.items ?? []).map((a) => a.fileName).join(', ')})`).toBeTruthy()
    expect(cut!.fileName).toMatch(/\d+쪽\.png$/)

    // ⑤ 대조를 열면 그 쪽이 뜨고 제목 옆에 몇 쪽인지 붙는다
    await page.goto(`/crm/quotes/${target.id}`)
    await page.waitForLoadState('networkidle')
    await closeUpdateNote(page)

    /*
      **구성이 줄로 보이는지 눈으로 남긴다.** 한 문단으로 이어져 보이던 것이
      이 검사의 출발점이었다(사용자 지적 2026-09-21).
    */
    const sheetComponents = page.locator('ul[class*="components"] li')
    expect(await sheetComponents.count(), '견적서에 구성이 줄로 안 나온다').toBeGreaterThan(0)
    // 항목 표가 아래에 있어 그냥 찍으면 머리글만 나온다 — 그 자리로 옮기고 찍는다
    await sheetComponents.first().scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: shot('05-sheet') })

    await page.getByRole('button', { name: '원본 대조' }).first().click()

    const overlay = page.getByRole('dialog', { name: '원본 대조' })
    await expect(overlay).toBeVisible({ timeout: 15_000 })
    await expect(overlay.getByText(new RegExp(`원본 ${target.sourcePageStart}`))).toBeVisible({ timeout: 15_000 })
    // 조각은 그림이라 프레임이 아니라 img 로 그려진다
    await expect(overlay.locator('img').first()).toBeVisible({ timeout: 20_000 })
    await expect(overlay.getByRole('button', { name: '파일 전체 보기' })).toBeVisible()
    await page.screenshot({ path: shot('03-compare'), fullPage: false })
  } finally {
    // **만든 것은 id 로 되돌린다.** 제목으로 지우면 남의 것을 지운다
    for (const id of madeQuoteIds) {
      await page.request.delete(`/api/crm/quotes/${id}`).catch(() => {})
    }
  }
})

/**
 * 엑셀 원본 — **표로 펴서 세운다**
 *
 * 견적서는 엑셀로 오는 일이 흔한데, 그동안 대조 화면은 「이 형식은 화면 안에 못 그려요」로
 * 끝났다. 대조하러 연 화면이 대조를 못 하는 상태다. 엑셀에는 쪽이 없어 오릴 수도 없으니
 * 셀을 그대로 편다 — **우리가 읽은 결과가 아니라 그 파일**이어야 대조가 된다.
 */
test('엑셀 원본을 붙이면 대조 왼쪽이 그 표를 그린다', async ({ page }) => {
  test.setTimeout(180_000)
  const xlsx = path.join(__dirname, 'fixtures', 'quote-sheet.xlsx')
  expect(fs.existsSync(xlsx), '붙박이 엑셀이 없다').toBe(true)

  let quoteId: string | null = null
  try {
    await page.goto('/crm/deals')
    await page.waitForLoadState('networkidle')
    await closeUpdateNote(page)
    const href = await page.locator('a[href^="/crm/deals/"]').first().getAttribute('href')
    expect(href, '딜이 하나도 없다').toBeTruthy()
    const dealId = href!.split('/').pop()!

    // 견적 하나를 만들고 엑셀을 원본으로 붙인다 — 화면을 거치지 않고 창구로 간다
    const made = await page.request.post('/api/crm/quotes', {
      data: {
        dealId,
        title: '[E2E] 엑셀 원본 대조',
        currency: 'KRW',
        lines: [{ name: '검사용 항목', quantity: '1', unitPriceMinor: '1000', taxRate: '10' }],
        sourceFileName: 'quote-sheet.xlsx',
      },
    })
    expect(made.ok(), `견적을 못 만들었다: ${await made.text()}`).toBe(true)
    quoteId = (await made.json()).id as string

    const up = await page.request.post('/api/crm/attachments', {
      multipart: {
        file: {
          name: 'quote-sheet.xlsx',
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          buffer: fs.readFileSync(xlsx),
        },
        target: 'QUOTE',
        targetId: quoteId,
        kind: 'SUPPLY_QUOTE',
      },
    })
    expect(up.ok(), `원본을 못 붙였다: ${await up.text()}`).toBe(true)

    await page.goto(`/crm/quotes/${quoteId}`)
    await page.waitForLoadState('networkidle')
    await closeUpdateNote(page)
    await page.getByRole('button', { name: '원본 대조' }).first().click()

    const overlay = page.getByRole('dialog', { name: '원본 대조' })
    await expect(overlay).toBeVisible({ timeout: 15_000 })

    // 「못 그려요」가 아니라 그 파일의 셀이 보여야 한다
    await expect(overlay.getByText('원본 파일의 표를 그대로 폈어요')).toBeVisible({ timeout: 20_000 })
    await expect(overlay.getByText('GIGABYTE R283-Z96-AAJ1').first()).toBeVisible()
    await expect(overlay.getByText('Dual AMD EPYC 9005/9004 Server Processors')).toBeVisible()
    await expect(overlay.getByText(/이 형식은 화면 안에 못 그려요/)).toHaveCount(0)
    // 내려받기 길은 그대로 남아야 한다
    await expect(overlay.getByRole('button', { name: '원본 내려받기' })).toBeVisible()

    await page.screenshot({ path: shot('04-sheet'), fullPage: false })
  } finally {
    if (quoteId) await page.request.delete(`/api/crm/quotes/${quoteId}`).catch(() => {})
  }
})
