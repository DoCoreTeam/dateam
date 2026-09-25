/**
 * 주문을 만드는 자리 — 순수 함수 (설계 §4 · M1')
 *
 * ## 왜 이 폴더 안에만 있나
 *
 * M1 을 버린 것이 아니라 **경계를 옮겼다.** 주문 TR 과 주문 경로는 `lib/trading/order/**`
 * 안에서만 쓰고, 밖에서는 지금까지처럼 0건을 센다. 그래야 「조회 하나 더」처럼 보이는 줄이
 * 엉뚱한 곳에 생기는 일이 여전히 막힌다.
 *
 * ## 조회와 주문은 끝 글자로 갈린다
 *
 * 같은 경로 아래 살고 앞 네 글자도 겹친다 — `TTTO5201R` 은 조회, `TTTO1101U` 는 주문.
 * TR 값은 공식 저장소 `examples_llm/domestic_futureoption/order`·`order_rvsecncl` 에서
 * 읽었다(2026-09-26). 기억으로 적으면 야간 TR 을 놓친다.
 */

import { kisHost, type KisEnv } from '../broker/endpoints.ts'
import { maskAccountNo, type AccountRef } from '../broker/account-request.ts'
import type { KisAuth } from '../broker/kis-request.ts'

/** 주문 경로 둘. **이 둘뿐이다** */
export const ORDER_PATHS = {
  place: '/uapi/domestic-futureoption/v1/trading/order',
  reviseCancel: '/uapi/domestic-futureoption/v1/trading/order-rvsecncl',
} as const

/**
 * 주문 TR. 공식 예제에서 읽은 값 그대로.
 *
 * 모의는 **주간만** 있다 — 야간 모의 주문 TR 이 예제에 없다. 없으면 실전으로 대신
 * 부르지 않고 거절한다(모의를 본다고 믿으면서 실계좌에 주문하게 된다).
 */
export const ORDER_TR = {
  place: { realDay: 'TTTO1101U', realNight: 'STTN1101U', paperDay: 'VTTO1101U', paperNight: null },
  reviseCancel: { realDay: 'TTTO1103U', realNight: 'TTTN1103U', paperDay: 'VTTO1103U', paperNight: null },
} as const

export type OrderApi = keyof typeof ORDER_TR
export type Session = 'day' | 'night'

export type TrResult =
  | { ok: true; trId: string }
  | { ok: false; reason: 'paper_night_unsupported' }

export function orderTrId(api: OrderApi, env: KisEnv, session: Session): TrResult {
  const row = ORDER_TR[api]
  if (env === 'paper') {
    if (session === 'night') return { ok: false, reason: 'paper_night_unsupported' }
    return { ok: true, trId: row.paperDay }
  }
  return { ok: true, trId: session === 'night' ? row.realNight : row.realDay }
}

/** 매도매수 구분. **방향이 부호를 정한다** — 뒤집히면 반대로 주문한다 */
export const SLL_BUY: Record<'long' | 'short', string> = { short: '01', long: '02' }

/** 호가 유형. 01 지정가 · 02 시장가 · 03 조건부 · 04 최유리 */
export const NMPR_TYPE = { limit: '01', market: '02', conditional: '03', best: '04' } as const
/** 한국거래소 호가 조건. 0 없음 · 3 IOC · 4 FOK */
export const KRX_CONDITION = { none: '0', ioc: '3', fok: '4' } as const
/** 주문 처리 구분. 02 주문 전송 */
export const ORD_PRCS = '02'

/** **늘 1이다** (D-11). 2 이상을 허용하는 릴리스에서 부분 체결과 함께 다시 설계한다 */
export const FIXED_QUANTITY = 1

export interface PlaceOrderInput {
  acct: AccountRef
  contractCode: string
  direction: 'long' | 'short'
  quantity: number
  /** 시장가면 0 */
  unitPrice: number
  /** 시장가인가 지정가인가 */
  priceType: 'market' | 'limit'
}

export type BuildResult =
  | { ok: true; body: Record<string, string> }
  | { ok: false; reason: string; userMessage: string }

/**
 * 주문 본문을 만든다.
 *
 * 수량이 1 이 아니면 **만들지 않는다.** DB 검사 제약이 한 번 더 막지만, 여기서 먼저
 * 걸러야 KIS 를 안 부르고 끝난다 — 주문은 되돌릴 수 없다.
 */
export function buildPlaceOrder(input: PlaceOrderInput): BuildResult {
  if (input.quantity !== FIXED_QUANTITY) {
    return {
      ok: false,
      reason: `quantity_not_one:${input.quantity}`,
      userMessage: 'Release 4 는 1계약만 주문합니다',
    }
  }
  if (input.contractCode.trim() === '') {
    return { ok: false, reason: 'no_contract', userMessage: '종목이 비어 있습니다' }
  }
  const price = input.priceType === 'market' ? 0 : input.unitPrice
  if (input.priceType === 'limit' && !(price > 0)) {
    return { ok: false, reason: 'bad_limit_price', userMessage: '지정가가 0 이하입니다' }
  }
  return {
    ok: true,
    body: {
      ORD_PRCS_DVSN_CD: ORD_PRCS,
      CANO: input.acct.cano,
      ACNT_PRDT_CD: input.acct.acntPrdtCd,
      SLL_BUY_DVSN_CD: SLL_BUY[input.direction],
      SHTN_PDNO: input.contractCode.trim(),
      ORD_QTY: String(FIXED_QUANTITY),
      // 시장가·최유리는 0 을 넣는다(공식 예제)
      UNIT_PRICE: String(price),
      NMPR_TYPE_CD: NMPR_TYPE[input.priceType],
      KRX_NMPR_CNDT_CD: KRX_CONDITION.none,
      ORD_DVSN_CD: NMPR_TYPE[input.priceType],
      CTAC_TLNO: '',
      FUOP_ITEM_DVSN_CD: '',
    },
  }
}

export interface CancelOrderInput {
  acct: AccountRef
  originalOrderNo: string
}

/** 취소. 전량만 — 1계약이라 부분이 없다 */
export function buildCancelOrder(input: CancelOrderInput): BuildResult {
  if (input.originalOrderNo.trim() === '') {
    return { ok: false, reason: 'no_order_no', userMessage: '원주문번호가 없습니다' }
  }
  return {
    ok: true,
    body: {
      ORD_PRCS_DVSN_CD: ORD_PRCS,
      CANO: input.acct.cano,
      ACNT_PRDT_CD: input.acct.acntPrdtCd,
      // 01 정정 · 02 취소
      RVSE_CNCL_DVSN_CD: '02',
      ORGN_ODNO: input.originalOrderNo.trim(),
      // 0 이면 전량
      ORD_QTY: '0',
      UNIT_PRICE: '0',
      NMPR_TYPE_CD: NMPR_TYPE.market,
      KRX_NMPR_CNDT_CD: KRX_CONDITION.none,
      RMN_QTY_YN: 'Y',
      ORD_DVSN_CD: NMPR_TYPE.market,
      FUOP_ITEM_DVSN_CD: '',
    },
  }
}

/** 주소. 호스트는 상수 둘 중 하나, 경로는 상수 표에서 (S4) */
export function orderUrl(env: KisEnv, api: OrderApi): string {
  return new URL(ORDER_PATHS[api === 'place' ? 'place' : 'reviseCancel'], kisHost(env)).toString()
}

export function orderHeaders(auth: KisAuth, trId: string): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    authorization: `Bearer ${auth.accessToken}`,
    appkey: auth.appKey,
    appsecret: auth.appSecret,
    tr_id: trId,
    custtype: 'P',
  }
}

/**
 * 주문 결과를 사람이 볼 한 줄로. **계좌번호는 가린다** (S3).
 *
 * 주문 응답에 계좌번호가 들어 있고, 그 값이 화면이나 로그에 한 번 찍히면 지울 수 없다.
 */
export function describeOrder(body: Readonly<Record<string, string>>): string {
  const side = body.SLL_BUY_DVSN_CD === SLL_BUY.long ? '매수' : '매도'
  return `${maskAccountNo(body.CANO)} · ${body.SHTN_PDNO} ${side} ${body.ORD_QTY}장`
}

/** KIS 응답에서 주문번호를 읽는다. 없으면 나갔는지 모른다 */
export function readOrderNo(output: unknown): string | null {
  if (typeof output !== 'object' || output === null) return null
  const o = output as Record<string, unknown>
  const no = o.ODNO ?? o.odno
  if (typeof no !== 'string' || no.trim() === '') return null
  return no.trim()
}
