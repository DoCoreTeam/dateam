/**
 * 계좌를 **읽기만 해서** 화면에 올린다
 *
 * 사용자 지시 2026-09-30: 「계좌를 직접 볼 수 있으면 그것도 하고 직접 매매는 안해도
 * 데이터는 받을수있으니」.
 *
 * 조회 창구만 부른다. 주문 창구는 같은 경로에 살고 **끝 글자로만 갈린다**(조회 R · 주문 U) —
 * 그래서 여기서는 `AccountClient` 의 조회 넷만 쓰고 주문 쪽은 이름도 안 가져온다.
 *
 * 실패하면 증권사 코드를 그대로 안 쓴다. 실측 2026-09-30 지금 상태가 `APAC0071` 이고
 * 그 뜻은 「증권사에 그 계좌번호가 없습니다」인데, 화면에 코드만 찍으면 사흘 동안 아무도
 * 못 고친다(2026-09-28 전례). 증권사 원문(`msg1`)은 계좌나 내부 구조가 섞여 나올 수 있어
 * 화면에 안 싣는다(S3) — 우리가 적은 말과 코드만 싣는다.
 */

import { kisCodeMeaning } from './kis-codes.ts'
import type { DepositSummary, Position } from './account-request.ts'

export const ACCOUNT_VIEW_LABEL = {
  title: '증권사 계좌',
  read: '계좌 읽기',
  reading: '읽는 중…',
  note: '조회만 합니다. 주문은 안 나갑니다',
  none: '아직 안 읽었습니다',
  noPosition: '계좌에 들고 있는 것이 없습니다',
  cash: '예수금',
  orderable: '주문 가능 현금',
  evalPnl: '평가 손익',
  realizedPnl: '실현 손익',
  margin: '추가 증거금',
} as const

export interface AccountMoneyRow {
  name: string
  /** 원 단위 값. 못 받았으면 null — 0 으로 때우지 않는다 */
  won: number | null
  /** 0 이 아니면 위험한 값인가 (추가 증거금) */
  danger?: boolean
}

export interface AccountPositionRow {
  contractCode: string
  productName: string
  direction: 'long' | 'short' | null
  quantity: number
  avgPrice: number | null
  evalPnlKrw: number | null
}

export type AccountView =
  | { ok: true; money: readonly AccountMoneyRow[]; positions: readonly AccountPositionRow[] }
  | { ok: false; why: string; how: string; code: string | null }

/** 예수금 한 벌을 화면 줄로. **안 받은 값은 안 그린다** — 0원은 「돈이 0원」이라는 사실이다 */
export function moneyRows(deposit: DepositSummary | null): AccountMoneyRow[] {
  if (!deposit) return []
  return [
    { name: ACCOUNT_VIEW_LABEL.cash, won: deposit.cashKrw },
    { name: ACCOUNT_VIEW_LABEL.orderable, won: deposit.orderableCashKrw },
    { name: ACCOUNT_VIEW_LABEL.evalPnl, won: deposit.evalPnlKrw },
    { name: ACCOUNT_VIEW_LABEL.realizedPnl, won: deposit.realizedPnlKrw },
    // 0 이 아니면 마진콜이다. 이 줄만 색이 다르다
    { name: ACCOUNT_VIEW_LABEL.margin, won: deposit.additionalMarginKrw, danger: true },
  ]
}

export function positionRows(positions: readonly Position[]): AccountPositionRow[] {
  return positions.map((p) => ({
    contractCode: p.contractCode,
    productName: p.productName,
    direction: p.direction,
    quantity: p.quantity,
    avgPrice: p.avgPrice,
    evalPnlKrw: p.evalPnlKrw,
  }))
}

/**
 * 못 읽었을 때 화면에 쓸 말.
 *
 * **증권사 원문을 안 싣는다.** 사유 표식에서 코드만 떼어 우리 표로 뜻을 찾고,
 * 모르는 코드는 뜻을 지어내지 않는다 — 지어낸 뜻은 읽는 사람을 엉뚱한 곳으로 보낸다.
 */
export function accountFailureView(reason: string): { why: string; how: string; code: string | null } {
  const code = /([A-Z]{4}\d{4}|EGW\d{5}|KIOK\d{4}|SKFT\d{4})/.exec(reason)?.[1] ?? null
  const meaning = code ? kisCodeMeaning(code) : null
  if (meaning) return { why: meaning.why, how: meaning.how, code }
  return {
    why: '증권사에서 계좌를 못 읽었습니다',
    how: '트레이딩 설정의 증권사 자격증명을 확인해 주세요',
    code,
  }
}
