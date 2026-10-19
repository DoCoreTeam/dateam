import { test, expect, type Page } from '@playwright/test'

/**
 * 가격 기준 견적의 출력 — 견적서 화면과 엑셀이 같은 1회 합계와 매년 줄을 낸다 (P0135 I19)
 *
 * 시험 딜 하나에 제품으로 채운 견적을 창구로 만들고(운영 gcube edge 의 품목에 잇는다 — 새 품목이 안 생긴다),
 * 견적 상세 화면과 엑셀 내려받기를 본다. 정리는 그 딜 id 로만 한다.
 */

const COMPANY_ID = process.env.E2E_COMPANY_ID ?? 'cmuw74fko0003jq046zzszpe0'
const PIPELINE = { pipelineId: 'pl_gpu', stageId: 'st_gpu_3' }

async function api<T>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, { method: m as string, headers: b === undefined ? undefined : { 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${m} ${u} ${res.status} ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }, [method, url, body] as const) as Promise<T>
}

const won = (v: string) => Number(v).toLocaleString('ko-KR')

test('제품으로 채운 견적: 견적서 화면 합계와 연 유지보수 줄, 엑셀 내려받기가 막히지 않는다', async ({ page }) => {
  test.setTimeout(180_000)
  const tag = Date.now().toString(36)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* */ } })
  await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
  const deal = await api<{ id: string }>(page, 'POST', '/api/crm/deals', { name: `F10 출력 ${tag}`, companyId: COMPANY_ID, ...PIPELINE })
  try {
    const products = await api<{ items: { id: string; name: string }[] }>(page, 'GET', '/api/crm/pricebook/products?q=gcube')
    const edge = products.items.find((p) => p.name === 'gcube edge')!
    const detail = await api<{ product: { sections: { name: string; roundingUnit: number }[] }; items: { id: string; name: string }[] }>(page, 'GET', `/api/crm/pricebook/products/${edge.id}`)
    const std = detail.items.find((i) => i.name.trim() === 'STD')
    const pv = await api<{ result: { lines: Record<string, unknown>[]; onceSupplyMinor: string; annualSupplyMinor: string } }>(page, 'POST', `/api/crm/pricebook/products/${edge.id}/preview`, {
      conditions: { picked: std ? [std.id] : [], gpus: [{ model: 'H100 SXM', count: 4, timed: false }], nodes: null, training: null, companyKind: null, discount: 'none' },
    })
    const sections = detail.product.sections
    const names = sections.map((s) => s.name)
    const lines = pv.result.lines.map((l) => ({
      productId: l.itemId, name: l.name, quantity: String(l.quantity), unit: l.unit, unitPriceMinor: String(l.unitPriceMinor),
      discountPercent: String(l.discountPercent ?? 0), taxRate: l.taxRate, sectionIndex: names.indexOf(String(l.sectionKey)),
      listPriceMinor: l.listPriceMinor, priceSource: 'LIST', billing: l.billing, ratioPct: l.ratioPct, ratioOfSectionName: l.ratioOfSectionKey,
    }))
    const q = await api<{ id: string; totalMinor: string; taxMinor: string; annualMinor: string }>(page, 'POST', '/api/crm/quotes', {
      dealId: deal.id, title: `F10 출력 ${tag}`, validUntil: '2026-12-31', sections, lines,
    })
    expect(q.annualMinor).toBe(pv.result.annualSupplyMinor)

    await page.goto(`/crm/quotes/${q.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('연 유지보수(매년, 합계 별도)').first()).toBeVisible({ timeout: 90_000 })
    await expect(page.getByText(`${won(pv.result.annualSupplyMinor)}원`).first()).toBeVisible()
    await expect(page.getByText(`${won(q.totalMinor)}원`).first()).toBeVisible()
    await expect(page.getByText(/\(매년\)/).first()).toBeVisible()
    await page.screenshot({ path: 'apps/web/e2e/.out/quote-outputs-sheet.png', fullPage: true })

    const res = await page.request.get(`/api/crm/quotes/${q.id}/document?format=xlsx`)
    expect(res.status(), await res.text().catch(() => '')).toBe(200)
    expect((await res.body()).length).toBeGreaterThan(1000)
    expect(errors).toEqual([])
  } finally {
    await api(page, 'DELETE', `/api/crm/deals/${deal.id}?mode=purge`).catch((e) => console.log(`CLEANUP ${deal.id} ${e}`))
  }
})
