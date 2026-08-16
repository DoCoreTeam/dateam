import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mapDeal, mapAccount, mapContact, toDomain, toAmountMinor,
  findDuplicateKeys, STAGE_MAP, HOST_STAGES, LOSSY_STAGES,
} from './v04-map.ts'

const deal = (over: Record<string, unknown> = {}) => ({
  id: 'd1', title: '삼성SDS 신규 협력', stage: '신규', value: null,
  close_date: null, fit_score: null, account_id: 'a1', ...over,
}) as any

// ------------------------------------------------------------
// 스테이지 매핑
// ------------------------------------------------------------

test('호스트 스테이지 8종이 전부 매핑돼 있다', () => {
  for (const s of HOST_STAGES) {
    assert.ok(STAGE_MAP[s], `${s} 매핑 없음`)
  }
})

test('수주·실패만 WON·LOST 이고 나머지는 OPEN 이다', () => {
  const byStatus: Record<string, string[]> = { OPEN: [], WON: [], LOST: [] }
  for (const s of HOST_STAGES) byStatus[STAGE_MAP[s].status].push(s)
  assert.deepEqual(byStatus.WON, ['수주'])
  assert.deepEqual(byStatus.LOST, ['실패'])
  assert.equal(byStatus.OPEN.length, 6)
})

test('PoC 는 순서가 아니라 뜻으로 매핑된다 (호스트는 PoC 가 제안보다 앞이다)', () => {
  assert.equal(STAGE_MAP['PoC'].stageId, 'st_gpu_4')   // 기술검증(PoC)
  assert.equal(STAGE_MAP['제안'].stageId, 'st_gpu_3')  // 견적·제안
})

test('검증과 컨택이 한 스테이지로 합쳐지고, 그 사실이 목록으로 노출된다', () => {
  assert.equal(STAGE_MAP['검증'].stageId, STAGE_MAP['컨택'].stageId)
  assert.deepEqual([...LOSSY_STAGES].sort(), ['검증', '컨택'])
})

test('모르는 스테이지는 조용히 넘어가지 않는다', () => {
  const m = mapDeal(deal({ stage: '보류' }))
  assert.equal(m.verdict, 'unknown_stage')
  assert.match(m.reason!, /보류/)
})

test('스테이지가 비어 있어도 unknown 으로 잡는다', () => {
  assert.equal(mapDeal(deal({ stage: null })).verdict, 'unknown_stage')
})

// ------------------------------------------------------------
// DB CHECK 와 충돌하는 원본을 미리 잡는다
// ------------------------------------------------------------

test('금액 없는 수주는 이관하지 않고 사람에게 넘긴다 (chk_won)', () => {
  const m = mapDeal(deal({ stage: '수주', value: null }))
  assert.equal(m.verdict, 'needs_input')
  assert.match(m.reason!, /chk_won/)
})

test('금액이 있는 수주는 이관 가능하다', () => {
  const m = mapDeal(deal({ stage: '수주', value: 300000000 }))
  assert.equal(m.verdict, 'ok')
  assert.equal(m.amountMinor, 300000000n)
  assert.equal(m.currency, 'KRW')
})

test('실패는 사유 필드가 원본에 없으므로 항상 사람이 채워야 한다 (chk_lost)', () => {
  const m = mapDeal(deal({ stage: '실패', value: 1000 }))
  assert.equal(m.verdict, 'needs_input')
  assert.match(m.reason!, /chk_lost/)
})

// ------------------------------------------------------------
// 값 변환
// ------------------------------------------------------------

test('금액은 원 단위 그대로 BigInt minor 가 된다 (KRW 는 minor 가 원이다)', () => {
  assert.equal(toAmountMinor(1234), 1234n)
  assert.equal(toAmountMinor('5000'), 5000n)
  assert.equal(toAmountMinor(null), null)
  assert.equal(toAmountMinor(''), null)
  assert.equal(toAmountMinor('숫자아님'), null)
})

test('소수점 금액은 반올림한다 (numeric → BigInt)', () => {
  assert.equal(toAmountMinor(1234.6), 1235n)
})

test('website 를 도메인으로 정규화한다', () => {
  assert.equal(toDomain('https://www.Data-Alliance.com/about?x=1'), 'data-alliance.com')
  assert.equal(toDomain('data-alliance.com'), 'data-alliance.com')
  assert.equal(toDomain(''), null)
  assert.equal(toDomain(null), null)
  assert.equal(toDomain('그냥 회사 홈페이지'), null, '도메인이 아니면 null 이어야 한다')
})

test('이메일은 소문자로 정규화한다 (중복 판정 기준)', () => {
  const m = mapContact({ id: 'c1', name: '홍길동', email: '  Hong@Example.COM ', phone: null, mobile: null, title: null, notes: null, account_id: 'a1' })
  assert.equal(m.email, 'hong@example.com')
})

test('전화는 phone 이 없으면 mobile 을 쓴다', () => {
  const m = mapContact({ id: 'c1', name: '홍', email: null, phone: null, mobile: '010-0000-0000', title: null, notes: null, account_id: null })
  assert.equal(m.phone, '010-0000-0000')
})

test('마감일은 KST 자정으로 해석한다 (날짜가 하루 밀리지 않게)', () => {
  const m = mapDeal(deal({ close_date: '2026-09-30' }))
  assert.equal(m.expectedCloseDate!.toISOString(), '2026-09-29T15:00:00.000Z')
})

// ------------------------------------------------------------
// 대응 필드가 없는 값은 버리지 않는다
// ------------------------------------------------------------

test('유형·제품·다음 액션·설명을 메모로 모아 보존한다', () => {
  const m = mapDeal(deal({ lead_type: '기업형', product: '하이퍼큐브', next_action: '견적 발송', description: '초기 문의' }))
  assert.match(m.carriedNote!, /유형: 기업형/)
  assert.match(m.carriedNote!, /제품: 하이퍼큐브/)
  assert.match(m.carriedNote!, /다음 액션: 견적 발송/)
  assert.match(m.carriedNote!, /설명: 초기 문의/)
})

test('보존할 것이 없으면 메모를 만들지 않는다', () => {
  assert.equal(mapDeal(deal()).carriedNote, null)
})

// ------------------------------------------------------------
// 유니크 충돌 사전 탐지
// ------------------------------------------------------------

test('같은 도메인이 여러 건이면 이관 전에 잡아낸다', () => {
  const rows = [{ d: 'a.com' }, { d: 'a.com' }, { d: 'b.com' }, { d: null }]
  const dup = findDuplicateKeys(rows, (r) => r.d)
  assert.equal(dup.get('a.com'), 2)
  assert.equal(dup.has('b.com'), false)
  assert.equal(dup.size, 1)
})

test('null 은 중복으로 세지 않는다 (Postgres 가 null 을 중복으로 보지 않는다)', () => {
  assert.equal(findDuplicateKeys([{ d: null }, { d: null }], (r) => r.d).size, 0)
})

// ------------------------------------------------------------
// 이름이 비어 있는 원본
// ------------------------------------------------------------

test('회사명·인물명이 비면 이관하지 않고 사람에게 넘긴다', () => {
  assert.equal(mapAccount({ id: 'a', name: '  ', website: null, industry: null, region: null, description: null }).verdict, 'needs_input')
  assert.equal(mapContact({ id: 'c', name: null, email: null, phone: null, mobile: null, title: null, notes: null, account_id: null }).verdict, 'needs_input')
})
