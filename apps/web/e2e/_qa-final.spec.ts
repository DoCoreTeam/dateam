import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
const DEAL = '/crm/deals/cmup57j5x0004l504gu6ygtu3'
const OUT = path.join(__dirname, '..', '..', '..', 'artifacts', 'qa-final')
const TITLE = 'QA 마무리 점검 (지워도 됨)'

async function pick(page: Page, i: number) {
  const dlg = page.getByRole('dialog').first()
  await dlg.locator(`#ln-name-${i}`).click()
  const picker = page.getByRole('dialog', { name: '품목 고르기' })
  await expect(picker).toBeVisible({ timeout: 15_000 })
  await picker.getByRole('textbox', { name: '품목 검색' }).fill('L40S')
  await page.waitForTimeout(1_200)
  await picker.locator('button').filter({ hasText: /L40S/i }).first().click()
  await expect(picker).toBeHidden({ timeout: 15_000 })
}

test('다섯을 다 본다', async ({ page }) => {
  test.setTimeout(420_000)
  fs.mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.goto(DEAL)
  await page.waitForLoadState('domcontentloaded')
  const nq = page.getByRole('button', { name: /새 견적|견적 만들기|견적 추가/ }).first()
  await expect(nq).toBeVisible({ timeout: 120_000 })
  if (await page.locator('.modal-backdrop').count() > 0) {
    await page.getByRole('button', { name: '닫기' }).first().click().catch(() => {})
  }
  await nq.click()
  const dlg = page.getByRole('dialog').first()
  await dlg.locator('#quote-title').fill(TITLE)

  // 1번 줄 — 기간요금인데 단위가 「식」 (시간 근거 없음)
  await dlg.locator('#ln-kind-0').selectOption('PERIOD')
  await pick(page, 0)
  await dlg.locator('#ln-unit-0').fill('식')
  await dlg.locator('#ln-qty-0').fill('1')
  await dlg.locator('#ln-price-0').fill('500000')
  await dlg.locator('#ln-remark-0').fill('providing the special discount for this two months rent.')
  // 2번 줄 — 날짜 없는 시간 품목
  await dlg.getByRole('button', { name: '항목 추가', exact: true }).click()
  await dlg.locator('#ln-kind-1').selectOption('PERIOD')
  await pick(page, 1)
  await dlg.locator('#ln-unit-1').fill('Hours')
  await dlg.locator('#ln-qty-1').fill('1440')
  await dlg.locator('#ln-price-1').fill('1388')

  for (const l of ['기간 총액', '월 금액', '시간당 금액', '기간', '총 시간', '월 기준 시간']) {
    const b = dlg.getByRole('checkbox', { name: l, exact: true })
    if (!(await b.isChecked())) await b.check()
  }
  await page.waitForTimeout(600)
  const modal = await dlg.innerText()
  fs.writeFileSync(path.join(OUT, 'modal.txt'), modal)
  await page.screenshot({ path: path.join(OUT, '01-modal.png'), fullPage: true })

  // ② 섞여도 선택지 옆이 빈칸이 아니다
  expect(modal, '730 옆이 빈칸이다').toContain('품목마다 달라요')
  expect(modal, '되는데 못 쓴다고 말한다')
    .not.toContain('기간을 적거나 수량을 시간 단위로 적어야')

  const posted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/api/crm/quotes' && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '저장', exact: true }).click()
  const id = (await (await posted).json())?.id
  expect(id).toBeTruthy()
  fs.writeFileSync(path.join(OUT, 'id.txt'), id)

  await page.goto(`/crm/quotes/${id}`)
  await page.waitForLoadState('domcontentloaded')
  const art = page.locator('article').first()
  await expect(art).toBeVisible({ timeout: 90_000 })
  const sheet = await art.innerText()
  fs.writeFileSync(path.join(OUT, 'sheet.txt'), sheet)
  await page.screenshot({ path: path.join(OUT, '02-sheet.png'), fullPage: true })

  // ① 「식」 줄에는 기간 총액이 안 붙고, 시간 줄에는 붙는다
  const rows = sheet.split('\n')
  const sikIdx = rows.findIndex((r) => r.includes('500,000원'))
  expect(sikIdx, '식 줄을 못 찾았다').toBeGreaterThan(-1)
  const sikBlock = rows.slice(sikIdx, sikIdx + 3).join(' ')
  expect(sikBlock, '기간이 없는 줄에 기간 총액이 붙었다').not.toContain('기간 총액')
  expect(sheet, '시간 줄에 기간 총액이 없다').toContain('기간 총액1,998,720원')
  expect(sheet, '시간 줄에 시간당이 없다').toContain('1,388원 × 1,440h')

  // ③④ 폭별 — 비고 낱말 끊김과 밀기 안내
  const widths: unknown[] = []
  for (const w of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width: w, height: 950 })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(art).toBeVisible({ timeout: 90_000 })
    await page.waitForTimeout(600)
    widths.push(await page.evaluate(() => {
      const table = document.querySelector('article table') as HTMLElement
      const wrap = table.parentElement as HTMLElement
      const cells = [...(table.querySelector('tbody tr') as HTMLElement).querySelectorAll('td')] as HTMLElement[]
      const cell = cells[cells.length - 1]
      const cs = getComputedStyle(cell)
      const inner = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const probe = document.createElement('span')
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`
      document.body.appendChild(probe)
      const tooWide = cell.innerText.split(/\s+/).filter(Boolean)
        .filter((wd) => { probe.textContent = wd; return probe.offsetWidth > inner })
      probe.remove()
      const hint = [...document.querySelectorAll('p')].some((p) => p.innerText.includes('옆으로 밀면'))
      return { overflow: wrap.scrollWidth - wrap.clientWidth, hint, inner: Math.round(inner), tooWide }
    }))
    await page.screenshot({ path: path.join(OUT, `03-w${w}.png`), fullPage: false })
  }
  fs.writeFileSync(path.join(OUT, 'widths.json'), JSON.stringify(widths, null, 1))
  const [w1440, w1280, w768, w390] = widths as { overflow: number; hint: boolean; tooWide: string[] }[]
  expect(w1440.hint, '안 넘치는데 밀어 보라고 한다').toBe(false)
  expect(w1280.hint, '안 넘치는데 밀어 보라고 한다').toBe(false)
  expect(w768.hint, '넘치는데 아무 말도 안 한다').toBe(true)
  expect(w390.hint, '넘치는데 아무 말도 안 한다').toBe(true)
  for (const [w, m] of [[1440, w1440], [1280, w1280], [768, w768], [390, w390]] as const) {
    expect(m.tooWide, `폭 ${w} 에서 낱말이 가운데서 끊긴다`).toEqual([])
  }

  // ⑤ 저장 뒤 반영 중
  await page.setViewportSize({ width: 1440, height: 950 })
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(art).toBeVisible({ timeout: 90_000 })
  const note = page.getByRole('status').filter({ hasText: '반영 중' })
  await expect(note).toHaveCount(0)
  await page.getByRole('button', { name: '수정', exact: true }).first().click()
  await expect(dlg).toBeVisible()
  const stamp = `QA-${Date.now()}`
  await dlg.locator('#quote-notes').fill(stamp)
  await dlg.getByRole('button', { name: '저장', exact: true }).click()
  await expect(note, '저장했는데 아무 말이 없다').toBeVisible({ timeout: 20_000 })
  await expect(note, '다 불러왔는데 표시가 안 사라진다').toHaveCount(0, { timeout: 30_000 })
  await expect(art).toContainText(stamp, { timeout: 30_000 })
  await page.screenshot({ path: path.join(OUT, '04-after-save.png'), fullPage: true })

  // 치운다
  await page.request.delete(`/api/crm/quotes/${id}`)
  const p2 = await page.request.delete(`/api/crm/quotes/${id}?mode=purge`)
  expect(p2.ok(), '치우기 실패').toBe(true)
})
