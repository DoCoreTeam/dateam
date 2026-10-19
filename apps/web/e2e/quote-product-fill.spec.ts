import { test, expect, type Page } from '@playwright/test'

/**
 * 견적에서 제품으로 채우기 — 고르고 계산하고 넣고 저장까지 (P0135 I16)
 *
 * 시험 전용 딜 하나를 만들어 거기에만 견적을 둔다. 정리는 그 딜 id 로만 한다(딜을 지우면 견적과 금액 이력이 따라간다).
 * 가격 기준 제품은 운영에 들어 있는 gcube edge 를 쓴다(I13 에서 실제 가격표로 채움). 고치지 않는다.
 *
 * 금액을 숫자로 박지 않는다. 운영 가격표가 바뀌면 숫자가 바뀐다 — 대신 **미리 계산 창구가 낸 1회분과
 * 저장된 견적의 1회분이 같은지**를 본다. 화면과 저장이 같은 엔진을 지나는지가 이 시험의 질문이다.
 */

const COMPANY_ID = process.env.E2E_COMPANY_ID ?? 'cmuw74fko0003jq046zzszpe0'
const PIPELINE = { pipelineId: 'pl_gpu', stageId: 'st_gpu_3' }

async function api<T>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, { method: m as string, headers: b === undefined ? undefined : { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${m} ${u} ${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }, [method, url, body] as const) as Promise<T>
}

async function noOverflow(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, `${where} 에서 가로 넘침`).toBe(0)
}

test('제품으로 채우기: gcube edge STD H100 4장 → 묶음과 출처가 서고 저장한 1회분이 미리 계산과 같다', async ({ page }) => {
  test.setTimeout(240_000)
  const tag = Date.now().toString(36)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* */ } })
  await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
  const deal = await api<{ id: string }>(page, 'POST', '/api/crm/deals', { name: `F10 제품으로 채우기 ${tag}`, companyId: COMPANY_ID, ...PIPELINE })
  try {
    const products = await api<{ items: { id: string; name: string }[] }>(page, 'GET', '/api/crm/pricebook/products?q=gcube')
    const edge = products.items.find((p) => p.name === 'gcube edge')
    expect(edge, '운영에 gcube edge 가 있어야 한다(I13)').toBeTruthy()
    const detail = await api<{ items: { id: string; name: string; basis: string }[] }>(page, 'GET', `/api/crm/pricebook/products/${edge!.id}`)
    const std = detail.items.find((i) => i.name.trim() === 'STD')

    await page.goto(`/crm/deals/${deal.id}`, { waitUntil: 'domcontentloaded' })
    await expect(async () => {
      await page.getByRole('button', { name: '새 견적' }).first().click()
      await expect(page.getByRole('button', { name: '제품으로 채우기' })).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 90_000 })
    await page.getByRole('button', { name: '제품으로 채우기' }).click()
    await page.locator('#pf-product').selectOption({ label: 'gcube edge' })
    if (std) await page.getByLabel('STD', { exact: true }).check()
    await page.getByLabel('GPU 모델').first().fill('H100 SXM')
    await page.getByLabel('장수').first().fill('4')
    await page.getByRole('button', { name: '계산', exact: true }).click()
    await expect(page.getByText('초기 도입 금액')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: '견적에 넣기' }).click()
    // 줄이 여럿 서고 단가가 채워졌다 — 묶음 셋(라이선스 구축 유지보수)의 줄들
    await expect.poll(async () => page.locator('[id^="ln-price-"]').count(), { timeout: 10_000 }).toBeGreaterThan(2)
    await expect(page.locator('[id^="ln-price-"]').first()).toHaveValue(/^\d+$/)
    await expect(page.getByText('가격 기준', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/자동으로 채운 값 \d+개/)).toBeVisible()
    await page.screenshot({ path: 'apps/web/e2e/.out/quote-product-fill-1280.png', fullPage: false })

    await page.setViewportSize({ width: 390, height: 844 })
    await noOverflow(page, '견적 편집 390')
    await page.screenshot({ path: 'apps/web/e2e/.out/quote-product-fill-390.png', fullPage: false })
    await page.setViewportSize({ width: 1280, height: 900 })

    await page.getByRole('dialog').getByRole('button', { name: '저장', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 30_000 })

    // 저장한 견적 — 줄마다 출처와 그날 정상가, 1회분은 미리 계산과 같다
    const list = await api<{ items: { id: string }[] }>(page, 'GET', `/api/crm/quotes?dealId=${deal.id}`)
    expect(list.items.length).toBe(1)
    const q = await api<{ subtotalMinor: string; discountMinor: string; sectionRoundingMinor: string; annualMinor: string; lines: { priceSource: string | null; listPriceMinor: string | null; provenance: unknown }[] }>(page, 'GET', `/api/crm/quotes/${list.items[0].id}`)
    expect(q.lines.length).toBeGreaterThan(2)
    expect(q.lines.every((l) => l.priceSource === 'LIST')).toBe(true)
    const preview = await api<{ result: { onceSupplyMinor: string; annualSupplyMinor: string } }>(page, 'POST', `/api/crm/pricebook/products/${edge!.id}/preview`, {
      conditions: { picked: std ? [std.id] : [], gpus: [{ model: 'H100 SXM', count: 4, timed: false }], nodes: null, training: null, companyKind: null, discount: 'none' },
    })
    const saved = BigInt(q.subtotalMinor) - BigInt(q.discountMinor) - BigInt(q.sectionRoundingMinor)
    expect(String(saved)).toBe(preview.result.onceSupplyMinor)
    expect(q.annualMinor).toBe(preview.result.annualSupplyMinor)
    // 딜의 견적 금액 = 그 1회분
    const d = await api<{ quotedNetMinor: string | null }>(page, 'GET', `/api/crm/deals/${deal.id}`)
    expect(d.quotedNetMinor).toBe(String(saved))
    expect(errors, '콘솔 예외').toEqual([])
    // eslint-disable-next-line no-console
    console.log(`SAVED once=${saved} annual=${q.annualMinor}`)
  } finally {
    await api(page, 'DELETE', `/api/crm/deals/${deal.id}?mode=purge`).catch((e) => console.log(`CLEANUP ${deal.id} ${e}`))
  }
})
