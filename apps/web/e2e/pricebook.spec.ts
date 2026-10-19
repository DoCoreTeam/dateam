import { test, expect, type Page } from '@playwright/test'

/**
 * 가격 기준 한 바퀴 — 제품 만들기, 품목 더하기, 미리 계산, 지우기, 되살리기 (P0135 I11 I20)
 *
 * **시험 자료는 이 시험이 만든 제품 하나에만 둔다.** 정리는 그 id 로만 한다(test-db-safety 규칙).
 * 품목을 더하면 가격 이력 줄이 생기는데 이력은 지울 수 없는 표다 — 남는 줄은 지운 품목 id 를
 * 가리켜 어느 화면에도 안 나온다. 그 수를 시험 끝에 적는다.
 */

interface Made { productId?: string; itemIds: string[] }

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
  await page.addInitScript(() => {
    try {
      localStorage.setItem('changelog_seen_version', '999.999.999')
      const d = new Date(); const day = d.getDay(); const mon = new Date(d); mon.setDate(d.getDate() - ((day + 6) % 7))
      localStorage.setItem(`weekly_reminder_seen_${mon.toISOString().slice(0, 10)}`, '1')
    } catch { /* 저장소 막힘 */ }
  })
}

async function noOverflow(page: Page, where: string): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, `${where} 에서 가로 넘침`).toBe(0)
}

async function clickTab(page: Page, name: string): Promise<void> {
  // 품목 탭은 수 배지가 붙어 이름이 「품목 2」가 된다 — 앞부분으로 찾는다
  const tab = page.getByRole('tab', { name: new RegExp(`^${name}( \\d+)?$`) })
  await expect(async () => {
    await tab.click()
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 2_000 })
  }).toPass({ timeout: 60_000 })
}

test('가격 기준: 제품 만들기 → 품목 → 미리 계산 → 지우기 → 되살리기', async ({ page }) => {
  test.setTimeout(240_000)
  const made: Made = { itemIds: [] }
  const tag = Date.now().toString(36)
  const name = `F10 가격 기준 ${tag}`
  await quietModals(page)
  try {
    await page.goto('/crm/products', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { name: '가격 기준' }).first()).toBeVisible({ timeout: 90_000 })
    for (const t of ['제품', '품목', '인건비 등급']) await expect(page.getByRole('tab', { name: t, exact: true })).toBeVisible()
    await page.screenshot({ path: 'apps/web/e2e/.out/pricebook-list-1280.png', fullPage: true })

    // 새 제품
    // 하이드레이션 전에 누르면 창이 안 열린다 — 열릴 때까지 다시 누른다
    await expect(async () => {
      await page.getByRole('button', { name: '새 제품' }).first().click()
      await expect(page.locator('#pp-name')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 60_000 })
    await page.locator('#pp-name').fill(name)
    await page.getByRole('button', { name: '저장' }).click()
    await page.waitForURL(/\/crm\/products\/[^/?]+/, { timeout: 60_000 })
    made.productId = page.url().split('/crm/products/')[1].split(/[?#]/)[0]
    await expect(page.getByRole('heading', { name })).toBeVisible({ timeout: 60_000 })

    // 품목 둘: 1식 15,000,000 + 단위당 7,300,000
    await clickTab(page, '품목')
    for (const [n, price, basis] of [['STD 기본 금액', '15000000', 'FIXED'], ['GPU 라이선스', '7300000', 'PER_UNIT']] as const) {
      await page.getByRole('button', { name: '새 품목' }).first().click()
      await page.locator('#it-name').fill(n)
      await page.locator('#it-section').fill('라이선스')
      await page.locator('#it-basis').selectOption(basis)
      await page.locator('#it-price').fill(price)
      await page.getByRole('button', { name: '저장' }).click()
      await expect(page.getByRole('cell', { name: n, exact: false }).first()).toBeVisible({ timeout: 30_000 })
    }
    const detail = await api<{ items: { id: string; name: string }[] }>(page, 'GET', `/api/crm/pricebook/products/${made.productId}`)
    made.itemIds = detail.items.map((i) => i.id)
    expect(detail.items.length).toBe(2)

    // 미리 계산: STD 를 고르면 15,000,000
    await clickTab(page, '미리 계산')
    await page.getByLabel('STD 기본 금액').check()
    await page.getByRole('button', { name: '계산', exact: true }).click()
    await expect(page.getByText('15,000,000').first()).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: 'apps/web/e2e/.out/pricebook-preview-1280.png', fullPage: true })

    // 변경 이력: 품목 둘의 정상가가 남았다
    await clickTab(page, '변경 이력')
    await expect(page.getByText('7,300,000').first()).toBeVisible({ timeout: 30_000 })

    // 390 폭
    await page.setViewportSize({ width: 390, height: 844 })
    await clickTab(page, '품목')
    await noOverflow(page, '제품 상세 390')
    await page.screenshot({ path: 'apps/web/e2e/.out/pricebook-detail-390.png', fullPage: true })
    await page.setViewportSize({ width: 1280, height: 900 })

    // 지우기 → 목록에서 빠짐 → 휴지통 → 되살리기
    await page.getByRole('button', { name: '삭제' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: '삭제' }).click()
    await page.waitForURL(/tab=product/, { timeout: 60_000 })
    const after = await api<{ items: { id: string }[] }>(page, 'GET', `/api/crm/pricebook/products?q=${encodeURIComponent(tag)}`)
    expect(after.items.length).toBe(0)
    const trash = await api<{ items: { id: string }[] }>(page, 'GET', `/api/crm/pricebook/products?trash=1&q=${encodeURIComponent(tag)}`)
    expect(trash.items.map((x) => x.id)).toContain(made.productId)
    await api(page, 'POST', `/api/crm/pricebook/products/${made.productId}/restore`)
    const back = await api<{ items: { id: string }[] }>(page, 'GET', `/api/crm/pricebook/products?q=${encodeURIComponent(tag)}`)
    expect(back.items.map((x) => x.id)).toContain(made.productId)

    // 설정 검색에 「노임단가」 → 가격 기준 카드
    await page.goto('/crm/settings', { waitUntil: 'domcontentloaded' })
    const search = page.getByRole('searchbox', { name: '설정 검색' })
    await expect(search).toBeVisible({ timeout: 60_000 })
    // 하이드레이션 전에 친 글자는 검색 상태에 안 닿는다 — 카드가 뜰 때까지 다시 친다
    await expect(async () => {
      await search.fill('')
      await search.fill('노임단가')
      await expect(page.getByRole('heading', { name: '가격 기준' })).toBeVisible({ timeout: 3_000 })
    }).toPass({ timeout: 60_000 })
    await page.screenshot({ path: 'apps/web/e2e/.out/pricebook-settings-search.png' })
  } finally {
    if (made.productId) {
      await api(page, 'DELETE', `/api/crm/pricebook/products/${made.productId}`).catch(() => null)
    }
    for (const id of made.itemIds) await api(page, 'DELETE', `/api/crm/products/${id}`).catch(() => null)
    // eslint-disable-next-line no-console
    console.log(`MADE product=${made.productId ?? ''} items=${made.itemIds.join(',')}`)
  }
})
