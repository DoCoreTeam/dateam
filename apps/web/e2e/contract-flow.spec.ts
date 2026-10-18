import { test, expect, type Page } from '@playwright/test'

/**
 * 계약서 한 바퀴 — 파일로 템플릿 만들기부터 체결까지 (P0132 I16)
 *
 * **왜 실화면인가**: 단위 시험은 창구 하나하나가 맞다는 것까지만 말한다. 이 기능의 값은
 * 견적이 계약서가 되어 체결이 딜 금액을 정하는 «흐름»이고, 흐름은 화면을 지나야만 끊긴 곳이 보인다.
 * (실측 2026-10-19: 기본 템플릿이 아니면 딜 카드가 「템플릿이 없다」고 하던 것, 지우기 창의 영구 삭제를
 * 창구가 모르던 것 — 둘 다 단위 시험 9천여 개가 초록인 채로 실화면에서만 잡혔다.)
 *
 * **시험 자료는 이 시험이 만든 딜 하나에만 둔다.** 정리는 그 id 로만 한다 —
 * 종류로 지우면 남의 것이 함께 걸린다(lib/policy/test-db-safety.test.ts 와 같은 규칙).
 * 템플릿은 딜에 딸리지 않으므로 그 id 로 영구 삭제하고, 원본 파일도 그때 함께 지운다.
 */

const COMPANY_ID = process.env.E2E_COMPANY_ID ?? 'cmuw74fko0003jq046zzszpe0'
const PIPELINE = { pipelineId: 'pl_gpu', stageId: 'st_gpu_3' }
const CONTRACT_TEXT = [
  '제1조 (목적) 주식회사 데이터얼라이언스(이하 갑)와 고객사(이하 을)는 GPU 서버 임대에 합의한다.',
  '제2조 (대금 지급) 을은 계약일로부터 15일 안에 대금을 지급한다.',
].join('\n')
const MIN_PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
const AI_WAIT_MS = 90_000

interface Made { dealId?: string; templateId?: string; signedId?: string }

async function api<T>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
  return page.evaluate(async ([m, u, b]) => {
    const res = await fetch(u as string, {
      method: m as string,
      headers: b === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`${m} ${u} ${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : null
  }, [method, url, body] as const) as Promise<T>
}

async function quietModals(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('changelog_seen_version', '999.999.999') } catch { /* 저장소 막힘 */ } })
}

async function noOverflow(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, `${where} 에서 가로 넘침`).toBe(0)
}

/** 시험 전용 딜과 보낼 견적 하나 — 화면이 아니라 창구로 만든다(이 시험이 보려는 것이 아니다) */
async function seedDeal(page: Page, tag: string, made: Made): Promise<{ quoteTitle: string }> {
  const deal = await api<{ id: string }>(page, 'POST', '/api/crm/deals', { name: `F10 e2e 딜 ${tag}`, companyId: COMPANY_ID, ...PIPELINE })
  made.dealId = deal.id
  const quoteTitle = `F10 e2e 견적 ${tag}`
  const q = await api<{ id: string; version: number }>(page, 'POST', '/api/crm/quotes', { dealId: deal.id, title: quoteTitle, validUntil: '2026-12-31' })
  await api(page, 'PATCH', `/api/crm/quotes/${q.id}`, { version: q.version, lines: [{ name: 'GPU 서버 임대', quantity: 1, unitPriceMinor: '1000000' }] })
  return { quoteTitle }
}

async function templateFromFile(page: Page, tag: string, made: Made): Promise<string> {
  const name = `F10 e2e 템플릿 ${tag}`
  await page.goto('/crm/settings', { waitUntil: 'domcontentloaded' })
  // 설정 탭은 주소가 아니라 화면 안에서 고른다
  const tab = page.getByRole('tab', { name: '계약' })
  // 하이드레이션 전에 누르면 초점만 가고 선택은 안 된다 — 선택될 때까지 다시 누른다
  await expect(async () => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
  await page.getByRole('button', { name: '파일로 만들기' }).click()
  await page.locator('#ct-file').setInputFiles({ name: `contract-${tag}.txt`, mimeType: 'text/plain', buffer: Buffer.from(CONTRACT_TEXT) })
  await page.getByRole('button', { name: '읽기' }).click()
  // AI 가 칸 자리를 못 찾아도 글은 들어온다 — 어느 쪽이든 편집 창이 「만들었습니다」로 열린다
  await expect(page.getByText('템플릿을 만들었습니다')).toBeVisible({ timeout: AI_WAIT_MS })
  await page.locator('#ct-name').fill(name)
  await page.getByRole('button', { name: /버전 1 발행/ }).click()
  await expect.poll(async () => {
    const list = await api<{ items: { id: string; name: string; currentVersionNo: number | null }[] }>(page, 'GET', '/api/crm/contract-templates')
    const row = list.items.find((t) => t.name === name)
    if (row) made.templateId = row.id
    return row?.currentVersionNo ?? 0
  }, { timeout: 30_000 }).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  return name
}

async function sendQuoteAndCreateContract(page: Page, dealId: string, quoteTitle: string, templateName: string): Promise<void> {
  await page.goto(`/crm/deals/${dealId}`, { waitUntil: 'domcontentloaded' })
  const card = page.locator('li', { hasText: quoteTitle })
  // 확인을 받은 뒤에야 체크되는 칸이라 check() 가 아니라 누르기다
  await card.getByRole('checkbox', { name: '보냄' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '보냄으로 표시' }).click()
  await expect(card.getByRole('button', { name: '계약서 만들기' })).toBeVisible({ timeout: 30_000 })
  await noOverflow(page, '딜 화면')
  await card.getByRole('button', { name: '계약서 만들기' }).click()
  // 발행 템플릿이 둘 이상이면 고르는 창이 뜬다 — 이 시험이 만든 것을 고른다
  const chooser = page.getByRole('dialog').getByRole('button', { name: templateName })
  await Promise.race([
    page.waitForURL(/\/crm\/contracts\//, { timeout: 60_000 }),
    chooser.click({ timeout: 60_000 }).then(() => page.waitForURL(/\/crm\/contracts\//, { timeout: 60_000 })),
  ])
  await expect(page.getByText('버전 기록')).toBeVisible({ timeout: 60_000 })
}

async function aiEdit(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'AI로 고치기' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('textbox').fill('대금 지급 기한을 30일로 바꿔 주세요')
  await dlg.getByRole('button', { name: '제안 받기' }).click()
  const pick = dlg.getByRole('checkbox').first()
  await expect(pick).toBeVisible({ timeout: AI_WAIT_MS })
  if (!(await pick.isChecked())) await pick.check()
  await dlg.getByRole('button', { name: /고른 \d+개 반영/ }).click()
  await expect(page.getByText(/버전 2.? 남겼습니다/)).toBeVisible({ timeout: 30_000 })
}

async function sendAndConclude(page: Page, dealId: string, made: Made): Promise<void> {
  await page.getByRole('button', { name: '보냄으로 표시' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '보냄으로 표시' }).click()
  await expect(page.getByText(/보냄 \d{4}-\d{2}-\d{2} · 버전/).first()).toBeVisible({ timeout: 30_000 })

  // 서명본 — 파일 고르기 창은 화면 밖이라 창구로 올린다(올리기 자체는 첨부 시험이 본다)
  made.signedId = await page.evaluate(async ([pdf, deal]) => {
    const fd = new FormData()
    fd.append('file', new File([pdf], 'F10-e2e-signed.pdf', { type: 'application/pdf' }))
    fd.append('target', 'DEAL'); fd.append('targetId', deal); fd.append('kind', 'CONTRACT')
    const res = await fetch('/api/crm/attachments', { method: 'POST', body: fd })
    return (await res.json()).id as string
  }, [MIN_PDF, dealId] as const)

  await page.getByRole('button', { name: '체결', exact: true }).click()
  const dlg = page.getByRole('dialog')
  await expect(dlg.getByRole('radio').first()).toBeChecked({ timeout: 30_000 })
  await dlg.getByRole('button', { name: '체결', exact: true }).click()
  await expect(page.getByRole('button', { name: '변경 계약서 만들기' })).toBeVisible({ timeout: 30_000 })
  await noOverflow(page, '체결한 계약서 화면')
}

async function cleanup(page: Page, made: Made): Promise<void> {
  const tries: Promise<unknown>[] = []
  if (made.signedId) tries.push(api(page, 'DELETE', `/api/crm/attachments/${made.signedId}`).catch(() => {}))
  await Promise.all(tries)
  // 딜을 영구 삭제하면 그 딜의 견적과 계약서와 버전이 FK 로 함께 사라진다
  if (made.dealId) await api(page, 'DELETE', `/api/crm/deals/${made.dealId}?mode=purge`).catch(() => {})
  // 템플릿은 영구 삭제로 원본 파일까지 함께 지운다(관리자 창구)
  if (made.templateId) await api(page, 'DELETE', `/api/crm/contract-templates/${made.templateId}?mode=purge`).catch(() => {})
}

/** 만든 것의 id — 시간 초과로 본문이 끊겨도 afterEach 가 이것으로 치운다 */
let made: Made = {}

test.afterEach(async ({ page }) => {
  await cleanup(page, made)
  made = {}
})

for (const width of [1280, 390]) {
  test(`계약서 한 바퀴 ${width}`, async ({ page }) => {
    test.setTimeout(6 * 60_000)
    await page.setViewportSize({ width, height: 900 })
    await quietModals(page)
    await page.goto('/crm/deals', { waitUntil: 'domcontentloaded' })
    const tag = `${width}-${Date.now().toString(36)}`
    const { quoteTitle } = await seedDeal(page, tag, made)
    const templateName = await templateFromFile(page, tag, made)
    await sendQuoteAndCreateContract(page, made.dealId!, quoteTitle, templateName)
    await noOverflow(page, '계약서 화면')
    await aiEdit(page)
    await sendAndConclude(page, made.dealId!, made)
  })
}
