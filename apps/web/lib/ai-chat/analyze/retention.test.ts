import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractEntities, computeRetention } from './retention.ts'

test('extractEntities: 요구 ID와 단위 수치를 뽑는다', () => {
  const e = extractEntities('FR-101 로그인. 닉네임 2~20자, 유예 30일, 가용성 99.5%, P50 3초.')
  assert.ok(e.ids.includes('FR-101'))
  assert.ok(e.numbers.some((n) => n.includes('30일')))
  assert.ok(e.numbers.some((n) => n.includes('99.5%')))
  assert.ok(e.numbers.includes('P50'))
})

test('computeRetention: 원문을 그대로 담으면 100% 보존(증강 모드 안심 신호)', () => {
  const src = 'FR-103 성인 인증은 PASS로 한다. 유예 30일, 재시도 3회.'
  const r = computeRetention(src, `${src}\n\n분석: 추가 설명...`)
  assert.equal(r.idKept, r.idTotal)
  assert.equal(r.numKept, r.numTotal)
  assert.equal(r.missing.length, 0)
})

test('computeRetention: 재서술로 ID·수치가 빠지면 누락으로 잡는다', () => {
  const src = 'FR-209 신고 5건 또는 10건 도달 시 블라인드. FR-210 태그 5개.'
  // 결과가 ID/수치를 잃고 두루뭉술하게 재서술
  const r = computeRetention(src, '신고가 많이 들어오면 캐릭터를 가린다. 태그도 지원한다.')
  assert.ok(r.missing.includes('FR-209'))
  assert.ok(r.missing.includes('FR-210'))
  assert.ok(r.idKept < r.idTotal)
})

test('computeRetention: 공백/표 재배치가 있어도 토큰이 있으면 보존으로 센다', () => {
  const src = 'NFR-03 가용성 99.5%'
  const r = computeRetention(src, '| NFR-03 | 가용성 99.5 % |')
  assert.equal(r.idKept, 1)
})

test('computeRetention: 추적 엔티티가 없으면 empty=true', () => {
  const r = computeRetention('세계관 배경 설명입니다.', '분석 결과')
  assert.equal(r.empty, true)
})
