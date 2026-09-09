/**
 * 낙찰과 계약 연동 가드 (설계서 3.2.3, F7)
 *
 * 여기서 잠그는 것 셋
 * - 응답이 rfp_outcomes 로 사상되고 참여 여부와 순위가 구분되는가
 * - 같은 공고를 두 번 수집해도 한 행인가
 * - 사람이 적은 값을 자동 수집이 덮지 않는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  toAwardInfo, toOutcome, toDbOutcome, findUs, normalizeCompany, mergeWithManual,
  type AwardBidder, type AwardInfo,
} from './award.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const 우리 = { name: '데이터얼라이언스', bizNo: '123-45-67890' }

const 입찰자 = (over: Partial<AwardBidder> & { name: string }): AwardBidder => ({
  bizNo: null, amount: null, rank: null, won: false, ...over,
})

function 낙찰(over: Partial<AwardInfo> = {}): AwardInfo {
  return {
    noticeNo: '20260300123',
    winner: 입찰자({ name: '경쟁사', amount: 1_800_000_000, rank: 1, won: true }),
    bidders: [
      입찰자({ name: '경쟁사', amount: 1_800_000_000, rank: 1, won: true }),
      입찰자({ name: '(주)데이터얼라이언스', bizNo: '1234567890', amount: 1_850_000_000, rank: 2 }),
    ],
    contractAmount: 1_800_000_000,
    awardedAt: '20260420',
    cancelled: false,
    ...over,
  }
}

// 회사 이름 맞추기

test('회사 이름 표기가 흔들려도 맞춘다', () => {
  assert.equal(normalizeCompany('(주)데이터얼라이언스'), '데이터얼라이언스')
  assert.equal(normalizeCompany('주식회사 데이터얼라이언스'), '데이터얼라이언스')
  assert.equal(normalizeCompany('㈜ 데이터 얼라이언스'), '데이터얼라이언스')
})

test('사업자번호가 있으면 이름보다 먼저 본다', () => {
  const hit = findUs([
    입찰자({ name: '전혀 다른 이름', bizNo: '123-45-67890' }),
  ], 우리)
  assert.equal(hit?.name, '전혀 다른 이름')
})

test('사업자번호가 없으면 이름으로 찾는다', () => {
  const hit = findUs([입찰자({ name: '(주)데이터얼라이언스' })], { name: '데이터얼라이언스', bizNo: null })
  assert.ok(hit)
})

test('없으면 없다고 한다', () => {
  assert.equal(findUs([입찰자({ name: '경쟁사' })], 우리), null)
})

// 결과 사상

test('내고 떨어진 것과 안 낸 것을 구분한다', () => {
  const 냈다 = toOutcome('c1', 낙찰(), 우리)
  // 안 낸 것은 판정 정확도의 증거가 아니다
  assert.equal(냈다.submitted, true)
  assert.equal(냈다.result, 'lost')
  assert.equal(냈다.ourRank, 2)

  const 안냈다 = toOutcome('c1', 낙찰({ bidders: [입찰자({ name: '경쟁사', rank: 1, won: true })] }), 우리)
  assert.equal(안냈다.submitted, false)
  assert.equal(안냈다.result, 'lost')
  // 안 냈으면 순위가 없다. 0 으로 두면 「1등 아님」과 섞인다
  assert.equal(안냈다.ourRank, null)
})

test('우리가 따가면 won 이다', () => {
  const r = toOutcome('c1', 낙찰({
    winner: 입찰자({ name: '(주)데이터얼라이언스', bizNo: '1234567890', rank: 1, won: true }),
    bidders: [입찰자({ name: '(주)데이터얼라이언스', bizNo: '1234567890', amount: 1_700_000_000, rank: 1, won: true })],
  }), 우리)
  assert.equal(r.result, 'won')
  assert.equal(r.submitted, true)
  assert.equal(r.ourRank, 1)
})

test('유찰이면 cancelled 다', () => {
  const r = toOutcome('c1', 낙찰({ cancelled: true }), 우리)
  assert.equal(r.result, 'cancelled')
})

test('낙찰 업체와 금액을 싣는다', () => {
  const r = toOutcome('c1', 낙찰(), 우리)
  assert.equal(r.awardedTo, '경쟁사')
  assert.equal(r.awardedAmount, 1_800_000_000)
  assert.equal(r.source, 'g2b')
})

// 응답 읽기

test('응답을 낙찰 정보로 옮긴다', () => {
  const info = toAwardInfo([
    { bidNtceNo: '20260300123', prcbdrNm: '경쟁사', bidprcAmt: '1,800,000,000', opengRank: '1', sucsfbidYn: 'Y', sucsfbidAmt: '1,800,000,000', opengDt: '20260420' },
    { bidNtceNo: '20260300123', prcbdrNm: '(주)데이터얼라이언스', bizno: '1234567890', bidprcAmt: '1,850,000,000', opengRank: '2' },
  ])
  assert.ok(info)
  assert.equal(info!.bidders.length, 2)
  assert.equal(info!.winner?.name, '경쟁사')
  assert.equal(info!.contractAmount, 1_800_000_000)
})

test('빈 응답은 없다고 한다', () => {
  assert.equal(toAwardInfo([]), null)
  assert.equal(toAwardInfo([{ 아무것도: '없음' }]), null)
})

test('이름 없는 입찰자는 빼고 센다', () => {
  const info = toAwardInfo([
    { bidNtceNo: 'x', prcbdrNm: '경쟁사', opengRank: '1' },
    { bidNtceNo: 'x', prcbdrNm: '  ' },
  ])
  assert.equal(info!.bidders.length, 1)
})

// 두 번 수집해도 한 행

test('같은 공고를 두 번 수집해도 결과가 같다', () => {
  const a = toOutcome('c1', 낙찰(), 우리)
  const b = toOutcome('c1', 낙찰(), 우리)
  // 행이 늘면 「몇 건 이겼나」가 부풀고 그 숫자로 가중치를 보정하면 조용히 틀린다
  assert.deepEqual(a, b)
  assert.deepEqual(toDbOutcome(a, 'o1'), toDbOutcome(b, 'o1'))
})

test('DB 유니크로 한 행이 보장된다', () => {
  const sql = readFileSync(path.join(HERE, '../../../../../supabase/migrations/248_rfp_growth.sql'), 'utf8')
  // 애플리케이션 판단만으로는 크론 두 개가 동시에 넣을 때 못 막는다
  assert.match(sql, /create table if not exists rfp_outcomes[\s\S]*?unique \(case_id\)/)
})

test('라우트가 upsert 로 넣는다', () => {
  const route = readFileSync(path.join(HERE, '../../../app/api/rfp/g2b/award/route.ts'), 'utf8')
  assert.match(route, /\.upsert\(/)
  assert.match(route, /onConflict: 'case_id'/)
})

// 사람이 적은 값 보호

test('사람이 적은 참여 여부를 자동 수집이 안 덮는다', () => {
  const patch = mergeWithManual(
    { source: 'manual', submitted: false, decision: 'no_go' },
    toOutcome('c1', 낙찰(), 우리),
  )
  // 담당자가 적어 둔 것을 크론이 뒤집으면 그 사람은 다시는 이 화면을 안 믿는다
  assert.equal('submitted' in patch, false)
  assert.equal(patch.result, 'lost')
  assert.equal(patch.awarded_to, '경쟁사')
})

test('자동으로 만든 행은 그대로 갱신한다', () => {
  const patch = mergeWithManual({ source: 'g2b', submitted: true, decision: null }, toOutcome('c1', 낙찰(), 우리))
  assert.equal(patch.submitted, true)
})

test('행이 없으면 전부 채운다', () => {
  const patch = mergeWithManual(null, toOutcome('c1', 낙찰(), 우리))
  assert.equal(patch.submitted, true)
  assert.equal(patch.our_rank, 2)
})
