/**
 * 계좌 조회 — **진실은 계좌다**
 *
 * 우리 기록은 「이렇게 됐을 것이다」이고 계좌는 「이렇게 됐다」이다.
 * 그래서 여기서 응답을 고쳐 읽으면 안 된다 — 다르면 다른 채로 넘겨야 대조(I08)가 멈출 수 있다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  maskAccountNo, scrubAccountNumbers, accountKeyFor, accountTrId, accountHeaders, accountUrl,
  balanceParams, fillsParams, depositParams, num,
  parseBalance, parseFills, parseDeposit, openQuantity, accountFailure, brokerFailureStreak,
} from './account-request.ts'
import { KIS_ACCOUNT_QUERIES, KIS_HOST_REAL, KIS_HOST_PAPER } from './endpoints.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const AUTH = { accessToken: 'tok', appKey: 'ak', appSecret: 'as' }
const ACCT = { cano: '50123456', acntPrdtCd: '03' }

// ── 공식 예제와 맞는가 (기억으로 적지 않는다) ─────────────

test('★ TR ID 가 전부 조회꼴이다 — 끝이 R', () => {
  for (const [key, spec] of Object.entries(KIS_ACCOUNT_QUERIES)) {
    assert.match(spec.trId, /^[A-Z]{4}\d{4}R$/, `${key} 의 실전 TR 이 조회꼴이 아니다`)
    if (spec.paperTrId) assert.match(spec.paperTrId, /^[A-Z]{4}\d{4}R$/, `${key} 의 모의 TR 이 조회꼴이 아니다`)
  }
})

test('★ 2026-09-26 공식 예제에서 읽은 값 그대로다', () => {
  // koreainvestment/open-trading-api examples_llm/domestic_futureoption/<기능>/<기능>.py
  assert.equal(KIS_ACCOUNT_QUERIES.balance.trId, 'CTFO6118R')
  assert.equal(KIS_ACCOUNT_QUERIES.balance.paperTrId, 'VTFO6118R')
  assert.equal(KIS_ACCOUNT_QUERIES.fills.trId, 'TTTO5201R')
  assert.equal(KIS_ACCOUNT_QUERIES.deposit.trId, 'CTRP6550R')
  assert.equal(KIS_ACCOUNT_QUERIES.orderable.trId, 'TTTO5105R')
  assert.equal(KIS_ACCOUNT_QUERIES.nightBalance.trId, 'CTFN6118R')
  assert.equal(KIS_ACCOUNT_QUERIES.nightFills.trId, 'STTN5201R')
  assert.equal(KIS_ACCOUNT_QUERIES.nightMargin.trId, 'CTFN7107R')
})

test('★ 모의에 짝이 없으면 실전으로 몰래 넘어가지 않는다', () => {
  assert.deepEqual(accountTrId('deposit', 'paper'), { ok: false, reason: 'paper_unsupported' })
  assert.deepEqual(accountTrId('nightBalance', 'paper'), { ok: false, reason: 'paper_unsupported' })
  assert.deepEqual(accountTrId('balance', 'paper'), { ok: true, trId: 'VTFO6118R' })
  assert.deepEqual(accountTrId('balance', 'real'), { ok: true, trId: 'CTFO6118R' })
})

test('밤에는 밤 TR 로 간다', () => {
  assert.equal(accountKeyFor('balance', true), 'nightBalance')
  assert.equal(accountKeyFor('fills', true), 'nightFills')
  assert.equal(accountKeyFor('balance', false), 'balance')
  // 짝이 없는 것은 그대로 — 조용히 엉뚱한 TR 로 바뀌면 안 된다
  assert.equal(accountKeyFor('deposit', true), 'deposit')
})

// ── 주소와 머리 (보안 S4) ────────────────────────────────

test('★ 주소의 호스트와 경로에 바깥 값이 안 섞인다', () => {
  const url = accountUrl('real', 'balance', balanceParams({ cano: 'http://evil/', acntPrdtCd: '../..' }))
  assert.ok(url.startsWith(`${KIS_HOST_REAL}/uapi/domestic-futureoption/v1/trading/inquire-balance?`))
  assert.ok(accountUrl('paper', 'balance', {}).startsWith(KIS_HOST_PAPER))
  // 바깥 값은 질의 문자열에만 들어간다
  assert.match(url, /CANO=http%3A%2F%2Fevil%2F/)
})

test('요청 머리에 tr_id 와 개인 구분이 들어간다', () => {
  const h = accountHeaders(AUTH, 'CTFO6118R')
  assert.equal(h.tr_id, 'CTFO6118R')
  assert.equal(h.custtype, 'P')
  assert.equal(h.authorization, 'Bearer tok')
})

test('체결·미체결을 구분해서 묻는다', () => {
  const q = { acct: ACCT, startDate: '20260926', endDate: '20260926' } as const
  assert.equal(fillsParams({ ...q, which: 'filled' }).CCLD_NCCS_DVSN, '01')
  assert.equal(fillsParams({ ...q, which: 'open' }).CCLD_NCCS_DVSN, '02')
  assert.equal(fillsParams({ ...q, which: 'all' }).CCLD_NCCS_DVSN, '00')
  // 최근 것 먼저
  assert.equal(fillsParams({ ...q, which: 'all' }).SORT_SQN, 'DS')
  assert.deepEqual(depositParams(ACCT), { CANO: '50123456', ACNT_PRDT_CD: '03' })
})

// ── 계좌번호 가리기 (보안 S3) ────────────────────────────

test('★ 계좌번호가 가린 값으로만 나온다', () => {
  assert.equal(maskAccountNo('50123456'), '5012****')
  assert.equal(maskAccountNo('5012-3456-01'), '5012******')
  assert.equal(maskAccountNo(''), '')
  assert.equal(maskAccountNo(null), '')
  assert.equal(maskAccountNo('123'), '***')
})

test('★ 오류 사유에 섞여 온 계좌번호도 가려진다 — 사유는 로그에 남는다', () => {
  const f = accountFailure('kis', '계좌 50123456 의 잔고를 읽을 수 없습니다')
  assert.equal(/50123456/.test(f.reason), false, '사유에 계좌번호가 그대로 남았다')
  assert.match(f.reason, /5012\*{4}/)
  assert.equal(scrubAccountNumbers('odno=0000117057 cano=50123456'), 'odno=0000****** cano=5012****')
  // 짧은 숫자는 안 건드린다 — 수량·가격까지 가리면 기록이 못 쓰게 된다
  assert.equal(scrubAccountNumbers('qty=2 price=30125'), 'qty=2 price=30125')
})

test('★ 파싱 결과에 원본 계좌번호가 없다', () => {
  const [pos] = parseBalance([{ cano: '50123456', shtn_pdno: '101W12', cblc_qty: '2', sll_buy_dvsn_cd: '02' }])
  assert.equal(pos.accountMasked, '5012****')
  assert.equal(JSON.stringify(pos).includes('50123456'), false)
  const [fill] = parseFills([{ cano: '50123456', odno: '0000117057', ord_qty: '2', tot_ccld_qty: '2' }])
  assert.equal(JSON.stringify(fill).includes('50123456'), false)
})

// ── 응답 읽기 ────────────────────────────────────────────

test('★ 못 읽는 숫자는 0 이 아니라 null — 0 이면 「값이 없다」가 「0원이다」가 된다', () => {
  assert.equal(num(''), null)
  assert.equal(num('  '), null)
  assert.equal(num('abc'), null)
  assert.equal(num(undefined), null)
  assert.equal(num('1,234,500'), 1234500)
  assert.equal(num('-3.5'), -3.5)
  assert.equal(num(0), 0)
})

test('잔고를 포지션으로 읽는다 (공식 예제 칼럼명)', () => {
  const positions = parseBalance([
    {
      cano: '50123456', shtn_pdno: '101W12', prdt_name: '코스피200 선물 2612',
      sll_buy_dvsn_cd: '02', sll_buy_dvsn_name: '매수', cblc_qty: '2',
      ccld_avg_unpr1: '301.25', evlu_pfls_amt: '250000', lqd_psbl_qty: '2',
    },
  ])
  assert.deepEqual(positions, [{
    contractCode: '101W12', productName: '코스피200 선물 2612', direction: 'long',
    quantity: 2, avgPrice: 301.25, evalPnlKrw: 250000, liquidatableQty: 2,
    accountMasked: '5012****',
  }])
})

test('★ 수량 0 인 줄은 포지션이 아니다 — 청산한 종목이 0장으로 남아 온다', () => {
  assert.deepEqual(parseBalance([{ shtn_pdno: '101W12', cblc_qty: '0', sll_buy_dvsn_cd: '02' }]), [])
})

test('매도는 short 로 읽는다 — 방향이 뒤집히면 손절 방향이 뒤집힌다', () => {
  assert.equal(parseBalance([{ shtn_pdno: 'x', cblc_qty: '1', sll_buy_dvsn_cd: '01' }])[0].direction, 'short')
  assert.equal(parseBalance([{ shtn_pdno: 'x', cblc_qty: '1', sll_buy_dvsn_name: '매도' }])[0].direction, 'short')
  // 모르면 모른다고 한다. 찍으면 반이 틀린다
  assert.equal(parseBalance([{ shtn_pdno: 'x', cblc_qty: '1' }])[0].direction, null)
})

test('체결을 읽고 남은 수량을 센다', () => {
  const [fill] = parseFills([{
    odno: '0000117057', orgn_odno: '', ord_dt: '20260926', ord_tmd: '093012',
    pdno: '101W12', sll_buy_dvsn_cd: '02', ord_qty: '3', tot_ccld_qty: '1',
    avg_idx: '301.20', rjct_qty: '0', cano: '50123456',
  }])
  assert.equal(fill.orderNo, '0000117057')
  assert.equal(fill.filledQty, 1)
  assert.equal(openQuantity(fill), 2)
  // 거부된 수량은 미체결이 아니다 — 영원히 안 채워진다
  assert.equal(openQuantity({ ...fill, rejectedQty: 2 }), 0)
})

test('주문번호 없는 줄은 버린다 — 체결 유일 키(§14.3)가 주문번호다', () => {
  assert.deepEqual(parseFills([{ ord_qty: '1' }, { odno: '  ' }]), [])
})

test('예수금·증거금을 읽는다', () => {
  const d = parseDeposit({
    dnca_tota: '12000000', ord_psbl_cash: '8000000', add_mgna_tota: '0',
    mtnc_rt: '7.5', futr_trad_pfls: '-150000', futr_evlu_pfls_amt: '250000',
  })
  assert.deepEqual(d, {
    cashKrw: 12000000, orderableCashKrw: 8000000, additionalMarginKrw: 0,
    maintenanceRate: 7.5, realizedPnlKrw: -150000, evalPnlKrw: 250000,
  })
  // 빈 응답이어도 던지지 않고 전부 null — 조회 자체가 실패한 것과 구별된다
  assert.deepEqual(Object.values(parseDeposit(null)), [null, null, null, null, null, null])
})

// ── 실패와 SG-02 ─────────────────────────────────────────

test('★ 실패가 사유와 사람이 읽을 문장을 함께 낸다 — 조용히 안 지나간다', () => {
  const f = accountFailure('network', 'TimeoutError')
  assert.match(f.reason, /^network:TimeoutError/)
  assert.ok(f.userMessage.length > 0)
})

test('★ 연속 실패만 센다 — 누적으로 세면 한 달 전 실패가 오늘 신호를 막는다', () => {
  assert.equal(brokerFailureStreak([{ ok: false }, { ok: false }, { ok: true }, { ok: false }]), 2)
  assert.equal(brokerFailureStreak([{ ok: true }, { ok: false }]), 0)
  assert.equal(brokerFailureStreak([]), 0)
})

// ── M1 ──────────────────────────────────────────────────

test('★ 계좌 코드에 주문 TR·주문 경로가 없다 (M1)', () => {
  for (const name of readdirSync(HERE)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const src = readFileSync(join(HERE, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    assert.equal(/\b[A-Z]{4}\d{4}U\b/.test(src), false, `${name} 에 주문 TR 이 있다`)
    assert.equal(/trading\/(ngt-)?order\b/.test(src), false, `${name} 에 주문 경로가 있다`)
  }
})

test('★ 계좌 모듈이 값을 쓰는 창구를 안 만든다 — 조회만 한다', () => {
  const src = readFileSync(join(HERE, 'account.ts'), 'utf8')
  for (const verb of ['method: \'POST\'', 'method: \'PUT\'', 'method: \'DELETE\'']) {
    assert.equal(src.includes(verb), false, `계좌 모듈이 ${verb} 를 쓴다`)
  }
  assert.ok(src.includes("method: 'GET'"))
})
