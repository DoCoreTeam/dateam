import { test, expect, type Page } from '@playwright/test'

/**
 * 보내기 전 기준 대조 — 막을 것은 막고 알릴 것은 확인창에 싣는다 (P0135 I18)
 *
 * 시험 전용 딜 하나에 창구로 견적을 만들고 정리는 그 딜 id 로만 한다.
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

test('실사 후 견적 줄이 있으면 보냄 체크가 막히고, 빼면 정상가와 다른 단가를 확인창에 싣고 보낸다', async ({ page }) => {
  test.setTimeout(180_000)
  const tag = Date.now().toString(36)
  await page.addInitScript(() => { try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* */ } })
  await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
  const deal = await api<{ id: string }>(page, 'POST', '/api/crm/deals', { name: `F10 기준 대조 ${tag}`, companyId: COMPANY_ID, ...PIPELINE })
  try {
    // 줄을 운영 가격 기준의 품목에 잇는다 — 안 이으면 「처음 쓴 항목」으로 운영에 품목이 새로 생긴다
    const products = await api<{ items: { id: string; name: string }[] }>(page, 'GET', '/api/crm/pricebook/products?q=gcube')
    const edge = products.items.find((p) => p.name === 'gcube edge')!
    const items = (await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/crm/pricebook/products/${edge.id}`)).items
    const gpuItem = items.find((i) => /데이터센터/.test(i.name))!.id
    const surveyItem = items.find((i) => /저장소/.test(i.name))!.id
    const q = await api<{ id: string; version: number }>(page, 'POST', '/api/crm/quotes', {
      dealId: deal.id, title: `F10 기준 대조 ${tag}`, validUntil: '2026-12-31',
      lines: [
        { productId: gpuItem, name: 'GPU 라이선스', quantity: 1, unitPriceMinor: '6000000', listPriceMinor: '7300000', priceSource: 'LIST', taxRate: 10 },
        { productId: surveyItem, name: '저장소 네트워크 보안 구성', quantity: 1, unitPriceMinor: '0', listPriceMinor: null, priceSource: 'LIST', taxRate: 10 },
      ],
    })
    await page.goto(`/crm/deals/${deal.id}`, { waitUntil: 'domcontentloaded' })
    const sent = page.getByRole('checkbox', { name: /보냄/ }).first()
    await expect(sent).toBeVisible({ timeout: 90_000 })
    await expect(async () => {
      await sent.click({ force: true })
      await expect(page.getByText(/실사 후 견적/)).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
    await page.screenshot({ path: 'apps/web/e2e/.out/quote-baseline-block.png', fullPage: false })

    // 실사 후 견적 줄을 빼면 보낼 수 있고, 확인창에 정상가와 다른 단가가 실린다
    const cur = await api<{ version: number }>(page, 'GET', `/api/crm/quotes/${q.id}`)
    await api(page, 'PATCH', `/api/crm/quotes/${q.id}`, {
      version: cur.version,
      // 정상가 대비 4.1% — 승인 기준(15%) 안이라 보낼 수 있다. 17.8% 였다면 승인 전에는 못 보낸다(정상가 대비 승인)
      lines: [{ productId: gpuItem, name: 'GPU 라이선스', quantity: 1, unitPriceMinor: '7000000', listPriceMinor: '7300000', priceSource: 'LIST', taxRate: 10 }],
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(async () => {
      await page.getByRole('checkbox', { name: /보냄/ }).first().click({ force: true })
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
    await expect(page.getByRole('dialog').getByText(/기준 대조: GPU 라이선스 단가가 정상가 7,300,000원과 300,000원 달라요/)).toBeVisible()
    await page.screenshot({ path: 'apps/web/e2e/.out/quote-baseline-warn.png', fullPage: false })
    await page.getByRole('dialog').getByRole('button', { name: '보냄으로 표시' }).click()
    await expect.poll(async () => (await api<{ status: string }>(page, 'GET', `/api/crm/quotes/${q.id}`)).status, { timeout: 30_000 }).toBe('SENT')
  } finally {
    await api(page, 'DELETE', `/api/crm/deals/${deal.id}?mode=purge`).catch((e) => console.log(`CLEANUP ${deal.id} ${e}`))
  }
})
