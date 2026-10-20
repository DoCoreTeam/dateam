import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CrmError } from '../../domain/errors.ts'
import { GCUBE_EDGE } from '../../domain/pricebook/gcube-edge.ts'
import { TEST_CATALOG } from '../../domain/quote-text/fixtures.ts'
import { buildReviewInput, fillCore, parseTextFillInput, reviewCore, type CallAi, type CallReview } from '../../services/quote-text-fill.ts'
import { parseReview, reviewToFixes, ReviewFindingSchema } from './quote-text-review.ts'

const line = (key: string, over: Record<string, unknown> = {}) => ({
  key, textKey: null, itemId: null, name: key, kind: 'QUANTITY', section: '라이선스', quantity: '40', unit: '장',
  unitPriceMinor: '7300000', listPriceMinor: '7300000', durationValue: '', durationUnit: '', ratioPct: null,
  ratioOfSectionName: null, remark: '', discountPercent: '0', lockedFields: [], ...over,
})

test('수량 어긋남과 이름 통일만 고칠 값, 빠진 것은 알림, 표에 없는 키는 버림', () => {
  const out = parseReview(JSON.stringify({ findings: [
    { kind: 'QTY_MISMATCH', key: 'gpu', note: '글은 4장', quantity: 4 },
    { kind: 'NAMING', key: 'srv', note: '이름 통일', name: 'H100 서버' },
    { kind: 'MISSING', key: null, note: '교육 2회가 빠졌어요' },
    { kind: 'QTY_MISMATCH', key: 'ghost', note: '없는 줄', quantity: 2 },
    { kind: 'QTY_MISMATCH', key: 'locked', note: '잠긴 줄', quantity: 2 },
  ] }))
  const r = reviewToFixes(out, [{ key: 'gpu', lockedFields: [] }, { key: 'srv', lockedFields: [] }, { key: 'locked', lockedFields: ['quantity'] }])
  assert.deepEqual(r.fixes.map((f) => [f.key, f.field, f.value]), [['gpu', 'quantity', '4'], ['srv', 'name', 'H100 서버']])
  assert.deepEqual(r.notices, [{ kind: 'MISSING', note: '교육 2회가 빠졌어요' }])
})

test('AI 검토 출력에 금액 칸이 없다, 입력에 금액이 없다', () => {
  assert.throws(() => ReviewFindingSchema.parse({ kind: 'NAMING', key: 'a', note: 'x', unitPriceMinor: 1 }))
  const input = buildReviewInput(parseTextFillInput({ text: 'H100 4장', lines: [line('gpu')], mode: 'review' }))
  assert.doesNotMatch(JSON.stringify(input), /price|Minor|cost|원가/i)
})

test('사람이 누를 때만 — 자동 정리에서는 검토를 안 부른다', async () => {
  let reviews = 0
  const review: CallReview = async () => { reviews += 1; return { output: { findings: [] }, runId: 'r' } }
  const fillAi: CallAi = async () => ({ output: { readings: [] }, runId: null })
  const loaded = { catalog: TEST_CATALOG, products: [GCUBE_EDGE], items: [], laborGrades: [], gpuPrice: () => null }
  await fillCore(loaded, parseTextFillInput({ text: 'H100 4장', lines: [line('gpu')] }), fillAi)
  assert.equal(reviews, 0)
  await reviewCore(parseTextFillInput({ text: 'H100 4장', lines: [line('gpu')], mode: 'review' }), review)
  assert.equal(reviews, 1)
  const src = readFileSync(new URL('../../../../app/api/crm/quotes/text-fill/route.ts', import.meta.url), 'utf8')
  assert.match(src, /input\.mode === 'review'/)
})

test('AI 가 안 되면 던지지 않고 상태로 말한다', async () => {
  const quota: CallReview = async () => { throw new CrmError('PROVIDER_QUOTA', 'q') }
  const r = await reviewCore(parseTextFillInput({ text: 'H100 4장', lines: [line('gpu')], mode: 'review' }), quota)
  assert.equal(r.aiStatus, 'QUOTA')
  assert.deepEqual(r.fixes, [])
})
