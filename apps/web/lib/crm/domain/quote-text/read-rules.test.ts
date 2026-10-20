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

test('「크레딧」은 「추가 크레딧」이 아니라 「gcube 크레딧」 — 뜻 있는 말은 안 뺀다', () => {
  const cat = { products: [], items: [{ id: 'g', name: 'gcube 크레딧', aliases: [] }, { id: 'a', name: '추가 크레딧', aliases: [] }] }
  assert.deepEqual(readText('크레딧 2.8억', cat)[0].itemIds, ['g'])
  assert.deepEqual(readText('추가 크레딧 1억', cat)[0].itemIds, ['a', 'g'])
})

// 실측 2026-10-20 — 「목적」 한 줄이 낱말 「GPU」 하나로 품목 「GPU」 1개(5,280만원)가 됐고 AI 는 안 불렸다
test('「목적:」처럼 사정을 적은 줄은 품목을 고르지 않고 AI 에게 넘긴다', () => {
  const withGpu: Catalog = { ...CATALOG, items: [...CATALOG.items, { id: 'gpu', name: 'GPU', aliases: [] }] }
  const r = readText('- 목적: 교내 12개의 독립적인 GPU 워크스테이션(RTX PRO 5000)을 묶어 클라우드처럼 서비스할 수 있는 솔루션 도입\n- 예산: 2000만원 (변동 가능)', withGpu)
  assert.equal(r[0].unread, true)
  assert.deepEqual(r[0].itemIds, [])
  // GPU 모델과 장수는 규칙이 지킨다 — AI 는 4번 중 1번 이 12장을 빠뜨려 견적의 가장 큰 줄이 사라졌다(실측 2026-10-20)
  assert.deepEqual(r[0].gpus, [{ model: 'RTX PRO 5000', count: 12 }])
  assert.deepEqual(r[0].counts, [])
  assert.equal(r[1].budgetMinor, BigInt(20_000_000))
  assert.equal(r[1].unread, false)
  // 사정 줄 안의 학교 말은 그대로 읽는다 — 표 줄이 아니라 기관 종류다
  assert.equal(readText('배경: 대학 연구실', CATALOG)[0].companyKind, 'school')
})

test('사정 줄의 수가 여럿이거나 없으면 GPU 장수를 짐작하지 않는다', () => {
  assert.deepEqual(readText('목적: RTX PRO 5000 장비 4대와 서버 2대를 묶음', CATALOG)[0].gpus, [{ model: 'RTX PRO 5000', count: null }])
  assert.deepEqual(readText('목적: RTX PRO 5000 클러스터', CATALOG)[0].gpus, [{ model: 'RTX PRO 5000', count: null }])
  assert.deepEqual(readText('목적: 교내 GPU 묶기', CATALOG)[0].gpus, [])
})

test('「RTX PRO 5000」은 GPU 모델이고 「12개의」는 수량이다', () => {
  assert.deepEqual(readText('RTX PRO 5000 4장', CATALOG)[0].gpus, [{ model: 'RTX PRO 5000', count: 4 }])
  assert.deepEqual(readText('12개의 장비', CATALOG)[0].counts, [{ value: 12, unit: '개' }])
  assert.deepEqual(readText('3개월', CATALOG)[0].counts, [])
})
