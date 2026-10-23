import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CrmError } from '../domain/errors.ts'
import { MAX_FILL_TEXT, QUOTE_PRICING_KEYS, linePricingData, quotePricingData, withoutPricingFields } from './quote-pricing-fields.ts'

test('쓴 글을 받고 빈 글은 비운다', () => {
  assert.deepEqual(quotePricingData({ fillText: '크레딧 2.8억' }), { fillText: '크레딧 2.8억' })
  assert.deepEqual(quotePricingData({ fillText: '   ' }), { fillText: null })
  assert.deepEqual(quotePricingData({}), {})
  assert.ok((QUOTE_PRICING_KEYS as readonly string[]).includes('fillText'))
})

test('글이 상한을 넘으면 거절', () => {
  assert.throws(() => quotePricingData({ fillText: 'a'.repeat(MAX_FILL_TEXT + 1) }), (e: unknown) => e instanceof CrmError && e.code === 'VALIDATION_FAILED')
})

test('상한이 마이그 312 의 CHECK 와 같다', () => {
  const sql = readFileSync(new URL('../../../../../supabase/migrations/312_crm_quote_fill_text.sql', import.meta.url), 'utf8')
  assert.match(sql, new RegExp(`<= ${MAX_FILL_TEXT}\\)`))
})

test('공개 API 로 쓴 글을 내보내지 않는다', () => {
  const row = withoutPricingFields({ id: 'q1', title: 't', fillText: '내부 메모', autoFilled: [] })
  assert.deepEqual(row, { id: 'q1', title: 't' })
})

test('제품으로 채운 줄은 가격 기준 제품과 버전을 함께 싣고, 하나만 오거나 틀린 값이면 둘 다 비운다', () => {
  assert.deepEqual(
    pick(linePricingData({ priceProductId: 'pp1', priceProductRevision: 3 }).data),
    { priceProductId: 'pp1', priceProductRevision: 3 },
  )
  for (const bad of [{ priceProductId: 'pp1' }, { priceProductRevision: 2 }, { priceProductId: 'pp1', priceProductRevision: 0 }, { priceProductId: 'x'.repeat(65), priceProductRevision: 1 }]) {
    assert.deepEqual(pick(linePricingData(bad).data), { priceProductId: null, priceProductRevision: null }, JSON.stringify(bad).slice(0, 60))
  }
})

function pick(d: Record<string, unknown>) {
  return { priceProductId: d.priceProductId, priceProductRevision: d.priceProductRevision }
}
