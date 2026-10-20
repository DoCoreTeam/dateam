import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SOOKMYUNG_LINES, SOOKMYUNG_SENTENCE, TEST_CATALOG } from './fixtures.ts'
import { parseAmount, readText, ruleReadRatio, splitClauses, type Catalog } from './read-rules.ts'

const CATALOG = TEST_CATALOG

test('금액 표현을 원으로 읽는다', () => {
  const cases: [string, number][] = [
    ['2.8억', 280_000_000], ['2억 8천', 280_000_000], ['2억8천만', 280_000_000], ['12억 5000', 1_250_000_000],
    ['5천만', 50_000_000], ['300만원', 3_000_000], ['280,000,000원', 280_000_000], ['시간당 1,300원', 1_300], ['8,000만원', 80_000_000],
  ]
  for (const [raw, want] of cases) assert.equal(parseAmount(raw)?.minor, BigInt(want), raw)
  assert.equal(parseAmount('H100 4장'), null)
  assert.equal(parseAmount('2MM'), null)
})

test('숫자 안의 쉼표로는 나누지 않는다', () => {
  const c = splitClauses('크레딧 280,000,000원, H100 4장')
  assert.deepEqual(c.map((x) => x.text), ['크레딧 280,000,000원', 'H100 4장'])
})

test('숙명여대 여섯 줄을 규칙만으로 읽는다', () => {
  const r = readText(SOOKMYUNG_LINES, CATALOG)
  const byText = (s: string) => r.find((x) => x.text.includes(s))!
  assert.equal(byText('숙명여대').companyKind, 'school')
  assert.equal(byText('크레딧').amountMinor, BigInt(280_000_000))
  assert.deepEqual(byText('크레딧').itemIds, ['credit'])
  assert.equal(byText('EDGE').productId, 'gcube-edge')
  assert.equal(byText('EDGE').edition, 'STD')
  assert.deepEqual(byText('H100').gpus, [{ model: 'H100', count: 4 }])
  assert.equal(byText('6000 Ada').gpus[0].count, 6)
  assert.match(byText('6000 Ada').gpus[0].model, /6000 Ada/)
  assert.equal(byText('노드').nodes, 30)
  const si = byText('SSO')
  assert.equal(si.grade, '고급')
  assert.equal(si.manMonths, 2)
  assert.equal(si.rest, 'SSO 정산 연동')
  assert.equal(byText('설치').install, true)
  assert.ok(ruleReadRatio(r) >= 0.8, `규칙으로 읽은 줄 ${ruleReadRatio(r)}`)
})

test('숙명여대 한 문장도 80% 이상 규칙으로 읽는다', () => {
  const r = readText(SOOKMYUNG_SENTENCE, CATALOG)
  assert.ok(ruleReadRatio(r) >= 0.8, `규칙으로 읽은 줄 ${ruleReadRatio(r)}`)
  assert.equal(r.find((x) => x.text.includes('크레딧'))?.amountMinor, BigInt(280_000_000))
  const si = r.find((x) => x.text.includes('SSO'))!
  assert.equal(si.manMonths, 2)
  assert.equal(si.grade, '고급')
})

test('수량 단위 기간 시간 부가세 예산 할인을 읽는다', () => {
  const [gpu] = readText('RTX 5090 17대 2개월', CATALOG)
  assert.deepEqual(gpu.gpus, [{ model: 'RTX 5090', count: 17 }])
  assert.equal(gpu.months, 2)
  const [h] = readText('A100 1,440시간', CATALOG)
  assert.equal(h.hours, 1440)
  const [v] = readText('부가세 포함 예산 8,000만원', CATALOG)
  assert.equal(v.vat, 'INCLUDED')
  assert.equal(v.budgetMinor, BigInt(80_000_000))
  assert.equal(v.amountMinor, null)
  const [d] = readText('교육기관이라 10% 할인', CATALOG)
  assert.equal(d.discountPct, 10)
  const [t] = readText('교육 2회 추가', CATALOG)
  assert.equal(t.training, 2)
  const [m] = readText('유지보수는 확장으로', CATALOG)
  assert.equal(m.maintenance, 'EXT')
  const [s] = readText('서버 랙 3식', CATALOG)
  assert.deepEqual(s.counts, [{ value: 3, unit: '식' }])
})

test('못 읽은 줄만 unread 로 남는다', () => {
  const r = readText('그쪽 담당자가 꼼꼼함\n크레딧 1억', CATALOG)
  assert.equal(r[0].unread, true)
  assert.equal(r[1].unread, false)
})

test('별칭으로 품목을 맞춘다', () => {
  const cat: Catalog = { products: [], items: [{ id: 'h100', name: 'H100 GPU 서버', aliases: ['에이치백'] }] }
  assert.deepEqual(readText('에이치백 서버 2대', cat)[0].itemIds, ['h100'])
})

test('글이 길어도 상한까지만 읽는다', () => {
  const long = '크레딧 1억\n'.repeat(5_000)
  assert.ok(readText(long, CATALOG).length <= 120)
})
