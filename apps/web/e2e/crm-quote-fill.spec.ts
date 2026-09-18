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

test('견적 항목 머리의 단추 넷이 오른쪽에 묶여 선다', async ({ page }) => {
  await page.goto('/crm/deals')
  await page.waitForLoadState('networkidle')

  // 딜 하나로 들어간다 — 어느 것이든 좋다
  const firstDeal = page.locator('a[href^="/crm/deals/"]').first()
  await expect(firstDeal).toBeVisible({ timeout: 15_000 })
  await firstDeal.click()
  await page.waitForLoadState('networkidle')

  // 견적 패널의 «새 견적»
  const newQuote = page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first()
  await expect(newQuote).toBeVisible({ timeout: 15_000 })
  await newQuote.click()

  const speech = page.getByRole('button', { name: '말로 채우기' })
  const file = page.getByRole('button', { name: '파일로 채우기' })
  const section = page.getByRole('button', { name: '묶음 추가' })
  const line = page.getByRole('button', { name: '항목 추가' })
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
  const file = process.env.QUOTE_FIXTURE
  test.skip(!file || !fs.existsSync(file), 'QUOTE_FIXTURE 없음')

  await page.goto('/crm/deals')
  await page.waitForLoadState('networkidle')
  await page.locator('a[href^="/crm/deals/"]').first().click()
  await page.waitForLoadState('networkidle')
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

  // 읽었거나 · 이유를 말하거나. 조용히 아무 일도 안 일어나면 실패다
  const found = page.getByText(/건을 읽었어요/)
  const failed = page.getByRole('dialog').locator('[class*="errorBanner"], [class*="ErrorBanner"]')
  const said = (await found.count()) > 0 || (await failed.count()) > 0
  expect(said, '읽기가 끝났는데 화면이 아무 말도 안 한다').toBe(true)

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
