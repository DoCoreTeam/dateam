import { test, expect } from '@playwright/test'

/**
 * 품목 복제 — 실화면 (P0138 후속)
 *
 * 실제 제품을 건드리지 않게 시험용 제품을 만들어 그 안에서 복제하고, 끝나면 제품을 지운다(휴지통).
 * 가격 이력은 지울 수 없는 원장이라 두 줄이 기록으로 남는다.
 */

test('품목 줄의 복제를 누르면 「이름 복사본」이 같은 묶음 끝에 생긴다', async ({ page }) => {
  test.setTimeout(120_000)
  const name = `시험 제품 ${Date.now()}`
  const made = await page.request.post('/api/crm/pricebook/products', { data: { name, businessTypeKey: 'SOLUTION', sections: [{ name: '시험 묶음', roundingUnit: 0 }] } })
  expect(made.ok()).toBe(true)
  const productId = ((await made.json()) as { id: string }).id
  try {
    const item = await page.request.post(`/api/crm/pricebook/products/${productId}/items`, { data: { name: '시험 품목', section: '시험 묶음', basis: 'FIXED', listPriceMinor: '1000000', unit: '식' } })
    expect(item.ok()).toBe(true)
    await page.goto(`/crm/products/${productId}?view=items`)
    await expect(page.getByRole('tab', { name: /기본 정보/ })).toBeVisible({ timeout: 30_000 })
    const backdrop = page.locator('.modal-backdrop')
    if (await backdrop.count() > 0) await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '시험 품목 복제' }).click()
    const region = page.getByRole('region', { name: /^시험 묶음/ })
    await expect(region.locator('button[class*="boardName"]', { hasText: '시험 품목 복사본' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('1개를 바꿨어요')).toBeVisible()
    const names = await region.locator('button[class*="boardName"]').allInnerTexts()
    expect(names.map((n) => n.split('\n')[0])).toEqual(['시험 품목', '시험 품목 복사본'])
  } finally {
    await page.request.delete(`/api/crm/pricebook/products/${productId}`)
  }
})
