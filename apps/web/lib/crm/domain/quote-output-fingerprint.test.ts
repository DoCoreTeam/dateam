import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stableStringify, fingerprintDocument, compareFingerprints, isOutputUnchanged,
  type FingerprintSet,
} from './quote-output-fingerprint.ts'

// 견적 문서 결과의 모양을 줄여 둔 합성 견본 — 실제 고객 값은 저장소에 두지 않는다
const SAMPLE = {
  document: {
    meta: { quoteNo: 'DA-20261016-01', revision: 1, title: '시험 견적' },
    lines: [{ name: 'H100 서버', quantity: '2', unitPriceMinor: 8750000n, lineTotalMinor: 17500000n }],
    totals: { subtotalMinor: 17500000n, taxMinor: 1750000n, totalMinor: 19250000n },
  },
  images: { logo: '', seal: 'data:image/png;base64,AAAA' },
  violations: [],
  missingSupplier: [],
  source: null,
}

test('같은 입력은 같은 지문이다 — 키 순서가 달라도', () => {
  const reordered = {
    source: null, missingSupplier: [], violations: [],
    images: { seal: SAMPLE.images.seal, logo: '' },
    document: { totals: SAMPLE.document.totals, lines: SAMPLE.document.lines, meta: SAMPLE.document.meta },
  }
  assert.equal(fingerprintDocument(SAMPLE), fingerprintDocument(reordered))
})

test('★ 견본 한 칸을 바꾸면 지문이 달라진다 — 금액 1원, 글자 한 자, 직인 그림', () => {
  const base = fingerprintDocument(SAMPLE)
  const oneWon = structuredClone(SAMPLE)
  oneWon.document.totals.totalMinor = 19250001n
  assert.notEqual(fingerprintDocument(oneWon), base)

  const oneChar = structuredClone(SAMPLE)
  oneChar.document.meta.title = '시험 견젹'
  assert.notEqual(fingerprintDocument(oneChar), base)

  const seal = structuredClone(SAMPLE)
  seal.images.seal = ''
  assert.notEqual(fingerprintDocument(seal), base)
})

test('bigint 와 같은 숫자의 글자는 다른 값으로 친다 — 형이 바뀌는 것도 출력 변화다', () => {
  assert.notEqual(stableStringify({ a: 1n }), stableStringify({ a: '1' }))
  assert.notEqual(stableStringify({ a: 1n }), stableStringify({ a: 1 }))
})

test('undefined 칸은 JSON 처럼 빠지고 null 칸은 남는다', () => {
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}')
  assert.equal(stableStringify({ a: null }), '{"a":null}')
})

const BASE: FingerprintSet = {
  renderers: { 'QuoteSheet.tsx': 'r1', 'quote-xlsx.ts': 'x1' },
  quotes: [{ quoteId: 'q1', hash: 'h1' }, { quoteId: 'q2', hash: 'h2' }],
}

test('있던 견적이 그대로면 통과, 새 견적이 생긴 것은 바뀜이 아니다', () => {
  const now: FingerprintSet = { ...BASE, quotes: [...BASE.quotes, { quoteId: 'q3', hash: 'h3' }] }
  const diff = compareFingerprints(BASE, now)
  assert.deepEqual(diff.added, ['q3'])
  assert.equal(isOutputUnchanged(diff), true)
})

test('★ 지문이 다르거나 사라지거나 그리는 코드가 바뀌면 통과하지 않는다', () => {
  const changed = compareFingerprints(BASE, { ...BASE, quotes: [{ quoteId: 'q1', hash: 'X' }, BASE.quotes[1]] })
  assert.deepEqual(changed.changed, ['q1'])
  assert.equal(isOutputUnchanged(changed), false)

  const missing = compareFingerprints(BASE, { ...BASE, quotes: [BASE.quotes[0]] })
  assert.deepEqual(missing.missing, ['q2'])
  assert.equal(isOutputUnchanged(missing), false)

  const renderer = compareFingerprints(BASE, { ...BASE, renderers: { ...BASE.renderers, 'QuoteSheet.tsx': 'r2' } })
  assert.deepEqual(renderer.renderersChanged, ['QuoteSheet.tsx'])
  assert.equal(isOutputUnchanged(renderer), false)
})
