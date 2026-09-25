/**
 * KIS 계좌 조회를 만들고 읽는 자리 — 순수 함수
 *
 * ## 진실은 계좌다
 *
 * 우리 기록은 「이렇게 됐을 것이다」이고 계좌는 「이렇게 됐다」이다. 둘이 다르면 계좌가 맞다.
 * 그래서 이 모듈은 계좌 응답을 **고쳐 읽지 않는다** — 수량이 예상과 달라도 그대로 옮기고,
 * 다른 쪽(I08 대조)이 그 차이를 보고 멈춘다.
 *
 * ## 계좌번호는 여기서 가린다 (보안 S3)
 *
 * KIS 응답에는 종합계좌번호가 그대로 들어 있다. 그 값이 화면이나 로그에 한 번 찍히면
 * 지울 방법이 없다. 그래서 읽는 자리에서 가린다 — 쓰는 자리마다 조심하는 방식은
 * 언젠가 한 곳을 빠뜨린다.
 */

import {
  kisHost, KIS_ACCOUNT_QUERIES, NIGHT_EQUIVALENT, CCLD_DVSN, SLL_BUY_DVSN,
  type KisEnv, type KisAccountKey,
} from './endpoints.ts'
import type { KisAuth } from './kis-request.ts'

// ── 계좌번호 가리기 ──────────────────────────────────────

/** `12345678` → `1234****`. 뒤를 가린다 — 앞자리는 지점 번호라 사람이 계좌를 알아보는 데 쓴다 */
export function maskAccountNo(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '')
  if (digits.length === 0) return ''
  if (digits.length <= 4) return '*'.repeat(digits.length)
  return `${digits.slice(0, 4)}${'*'.repeat(digits.length - 4)}`
}

/**
 * 아무 글에서나 계좌번호꼴 숫자를 가린다. 오류 메시지·로그에 쓴다.
 *
 * KIS 오류 본문에 계좌번호가 섞여 오는 일이 있다. 사유를 그대로 기록하면 그때 샌다.
 */
export function scrubAccountNumbers(text: string): string {
  return text.replace(/\b\d{8,14}\b/g, (m) => maskAccountNo(m))
}

// ── 요청 ────────────────────────────────────────────────

export interface AccountRef {
  /** 종합계좌번호 8자리 */
  cano: string
  /** 계좌상품코드 2자리 (선물옵션은 보통 03) */
  acntPrdtCd: string
}

/** 야간 세션이면 밤 짝으로 바꾼다. 짝이 없으면 그대로 */
export function accountKeyFor(key: KisAccountKey, isNight: boolean): KisAccountKey {
  if (!isNight) return key
  return NIGHT_EQUIVALENT[key] ?? key
}

export type TrIdResult =
  | { ok: true; trId: string }
  /** 모의투자가 이 조회를 지원 안 한다. **조용히 실전으로 넘어가지 않는다** */
  | { ok: false; reason: 'paper_unsupported' }

/**
 * 어떤 TR 로 물을 것인가.
 *
 * 모의에 짝이 없으면 실전 TR 로 대신 부르지 않는다. 그렇게 하면 모의 계좌를 본다고 믿으면서
 * **실제 계좌를 보게 된다** — 확인하려던 것과 반대되는 일이 조용히 일어난다.
 */
export function accountTrId(key: KisAccountKey, env: KisEnv): TrIdResult {
  const spec = KIS_ACCOUNT_QUERIES[key]
  if (env === 'paper') {
    if (!spec.paperTrId) return { ok: false, reason: 'paper_unsupported' }
    return { ok: true, trId: spec.paperTrId }
  }
  return { ok: true, trId: spec.trId }
}

export function accountHeaders(auth: KisAuth, trId: string, continuation?: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Bearer ${auth.accessToken}`,
    appkey: auth.appKey,
    appsecret: auth.appSecret,
    tr_id: trId,
    tr_cont: continuation ?? '',
    custtype: 'P',
  }
}

/** 호스트는 상수 둘 중 하나, 경로는 상수 표에서 온다 (보안 S4) */
export function accountUrl(
  env: KisEnv, key: KisAccountKey, params: Readonly<Record<string, string>>,
): string {
  const url = new URL(KIS_ACCOUNT_QUERIES[key].path, kisHost(env))
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value)
  return url.toString()
}

export interface Continuation { fk200: string; nk200: string }
const EMPTY_CONT: Continuation = { fk200: '', nk200: '' }

export function balanceParams(acct: AccountRef, cont: Continuation = EMPTY_CONT): Record<string, string> {
  return {
    CANO: acct.cano,
    ACNT_PRDT_CD: acct.acntPrdtCd,
    // 01 게시 · 02 유지. 우리가 보는 것은 지금 걸린 증거금이라 게시
    MGNA_DVSN: '01',
    // 1 정산 · 2 본정산
    EXCC_STAT_CD: '1',
    CTX_AREA_FK200: cont.fk200,
    CTX_AREA_NK200: cont.nk200,
  }
}

export interface FillsQuery {
  acct: AccountRef
  /** `20260926` */
  startDate: string
  endDate: string
  /** 체결만 · 미체결만 · 전부 */
  which: keyof typeof CCLD_DVSN
}

export function fillsParams(query: FillsQuery, cont: Continuation = EMPTY_CONT): Record<string, string> {
  return {
    CANO: query.acct.cano,
    ACNT_PRDT_CD: query.acct.acntPrdtCd,
    STRT_ORD_DT: query.startDate,
    END_ORD_DT: query.endDate,
    SLL_BUY_DVSN_CD: SLL_BUY_DVSN.all,
    CCLD_NCCS_DVSN: CCLD_DVSN[query.which],
    // DS 역순 = 최근 것 먼저. 우리가 찾는 것은 방금 난 체결이다
    SORT_SQN: 'DS',
    PDNO: '',
    STRT_ODNO: '',
    MKET_ID_CD: '',
    CTX_AREA_FK200: cont.fk200,
    CTX_AREA_NK200: cont.nk200,
  }
}

export function depositParams(acct: AccountRef): Record<string, string> {
  return { CANO: acct.cano, ACNT_PRDT_CD: acct.acntPrdtCd }
}

// ── 응답 읽기 ────────────────────────────────────────────

/** 숫자꼴 문자열을 숫자로. 못 읽으면 null — **0 으로 만들지 않는다** */
export function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/,/g, '')
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export interface Position {
  /** 단축 종목코드 (`shtn_pdno`). 우리 봉·신호가 쓰는 코드와 같은 자리 */
  contractCode: string
  productName: string
  /** 매수면 long, 매도면 short */
  direction: 'long' | 'short' | null
  quantity: number
  /** 체결 평균 단가 */
  avgPrice: number | null
  evalPnlKrw: number | null
  liquidatableQty: number | null
  /** 가린 계좌번호. 원본은 어디에도 안 남는다 */
  accountMasked: string
}

const SIDE_TO_DIRECTION: Record<string, 'long' | 'short'> = {
  '01': 'short', '02': 'long',
}

function directionFrom(raw: Record<string, unknown>): 'long' | 'short' | null {
  const code = typeof raw.sll_buy_dvsn_cd === 'string' ? raw.sll_buy_dvsn_cd : ''
  if (SIDE_TO_DIRECTION[code]) return SIDE_TO_DIRECTION[code]
  const name = typeof raw.sll_buy_dvsn_name === 'string' ? raw.sll_buy_dvsn_name : ''
  if (name.includes('매수')) return 'long'
  if (name.includes('매도')) return 'short'
  return null
}

/**
 * 잔고 응답 → 포지션.
 *
 * 수량 0 은 버린다 — 청산한 종목이 잔고에 0장으로 남아 오고, 그것을 포지션으로 세면
 * 「아직 들고 있다」가 된다.
 */
export function parseBalance(output1: readonly unknown[]): Position[] {
  const out: Position[] = []
  for (const row of output1) {
    if (typeof row !== 'object' || row === null) continue
    const raw = row as Record<string, unknown>
    const qty = num(raw.cblc_qty) ?? 0
    if (qty === 0) continue
    out.push({
      contractCode: String(raw.shtn_pdno ?? raw.pdno ?? '').trim(),
      productName: String(raw.prdt_name ?? '').trim(),
      direction: directionFrom(raw),
      quantity: Math.abs(qty),
      avgPrice: num(raw.ccld_avg_unpr1),
      evalPnlKrw: num(raw.evlu_pfls_amt),
      liquidatableQty: num(raw.lqd_psbl_qty),
      accountMasked: maskAccountNo(typeof raw.cano === 'string' ? raw.cano : ''),
    })
  }
  return out
}

export interface Fill {
  /** 주문번호 */
  orderNo: string
  originalOrderNo: string
  orderDate: string
  orderTime: string
  contractCode: string
  direction: 'long' | 'short' | null
  orderQty: number
  filledQty: number
  /** 체결 평균 지수 */
  avgPrice: number | null
  rejectedQty: number
  accountMasked: string
}

export function parseFills(output1: readonly unknown[]): Fill[] {
  const out: Fill[] = []
  for (const row of output1) {
    if (typeof row !== 'object' || row === null) continue
    const raw = row as Record<string, unknown>
    const orderNo = String(raw.odno ?? '').trim()
    if (!orderNo) continue
    out.push({
      orderNo,
      originalOrderNo: String(raw.orgn_odno ?? '').trim(),
      orderDate: String(raw.ord_dt ?? '').trim(),
      orderTime: String(raw.ord_tmd ?? '').trim(),
      contractCode: String(raw.pdno ?? '').trim(),
      direction: directionFrom(raw),
      orderQty: num(raw.ord_qty) ?? 0,
      filledQty: num(raw.tot_ccld_qty) ?? 0,
      avgPrice: num(raw.avg_idx),
      rejectedQty: num(raw.rjct_qty) ?? 0,
      accountMasked: maskAccountNo(typeof raw.cano === 'string' ? raw.cano : ''),
    })
  }
  return out
}

/** 아직 안 채워진 수량. 미체결을 따로 묻지 않고도 여기서 나온다 */
export function openQuantity(fill: Fill): number {
  return Math.max(0, fill.orderQty - fill.filledQty - fill.rejectedQty)
}

export interface DepositSummary {
  /** 예수금 총액 */
  cashKrw: number | null
  /** 주문 가능 현금 */
  orderableCashKrw: number | null
  /** 추가 증거금(마진콜). 0 이 아니면 위험하다 */
  additionalMarginKrw: number | null
  /** 위탁증거금 유지율 */
  maintenanceRate: number | null
  /** 선물 실현 손익 */
  realizedPnlKrw: number | null
  /** 선물 평가 손익 */
  evalPnlKrw: number | null
}

export function parseDeposit(output: unknown): DepositSummary {
  const raw = (typeof output === 'object' && output !== null ? output : {}) as Record<string, unknown>
  return {
    cashKrw: num(raw.dnca_tota),
    orderableCashKrw: num(raw.ord_psbl_cash),
    additionalMarginKrw: num(raw.add_mgna_tota),
    maintenanceRate: num(raw.mtnc_rt),
    realizedPnlKrw: num(raw.futr_trad_pfls),
    evalPnlKrw: num(raw.futr_evlu_pfls_amt),
  }
}

// ── 실패 ────────────────────────────────────────────────

export interface AccountFailure {
  reason: string
  userMessage: string
}

/**
 * 실패를 사유와 함께 만든다. **사유에 계좌번호가 안 실린다.**
 *
 * 조용한 실패 금지 — 무엇 때문에 못 읽었는지가 남아야 다음 실행이 판단하고,
 * 연속 실패 수가 SG-02 로 이어진다.
 */
export function accountFailure(kind: string, detail: string): AccountFailure {
  return {
    reason: scrubAccountNumbers(`${kind}:${detail}`).slice(0, 300),
    userMessage: '증권사 계좌를 조회하지 못했습니다',
  }
}

/**
 * 연속 실패 수 (SG-02 로 들어간다). 최근 것부터 세고 성공을 만나면 멈춘다.
 *
 * 누적 실패가 아니라 **연속** 실패다. 누적으로 세면 한 달 전 실패가 오늘 신호를 막는다.
 */
export function brokerFailureStreak(recent: readonly { ok: boolean }[]): number {
  let streak = 0
  for (const r of recent) {
    if (r.ok) break
    streak += 1
  }
  return streak
}
