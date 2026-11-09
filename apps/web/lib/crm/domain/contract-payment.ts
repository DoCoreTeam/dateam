/**
 * 구조화된 대가 — 지급 일정 (P0184 I07)
 *
 * **글이 아니라 칸으로 받는다.** 「계약금 30% 잔금 70%」를 조항 글로 쓰면 합이 100 인지,
 * 금액이 견적과 맞는지 아무도 못 센다. 대가 종류마다 정해진 칸으로 받고 여기서 검사한다.
 *
 * **담는 자리는 계약 칸 값이다.** `contract.payment` 칸에 정리한 JSON 한 줄이 들어간다.
 * 칸 값은 계약서 버전마다 굳고 버전 비교에 잡히므로, 지급 일정을 바꾼 것도 버전 기록에 남는다.
 *
 * **금액은 정수 최소단위 문자열이다.** 원화 1,000원은 "1000", 달러 10.80 은 "1080".
 * 소수를 받지 않는다 — 100배 사고(통화 자리수)의 입구가 소수 입력이었다.
 */

import { z } from 'zod'
import { formatAmount } from '../../../app/(crm)/crm/deals/amount.ts'
import { escapeHtml } from './contract-fields.ts'
import { pctOfMinor, toMinor } from './money.ts'
import { CONTRACT_PAYMENT, CONTRACT_PAYMENT_MSG } from '../../terms/contract-doc.ts'

export const PAYMENT_KINDS = [
  'LUMP', 'INSTALLMENT', 'FIXED', 'USAGE', 'PREPAID', 'COMMITMENT', 'COMMISSION', 'POINT_CONVERSION', 'SUBSIDY',
] as const
export type PaymentKind = (typeof PAYMENT_KINDS)[number]

export const PAYMENT_PERIODS = ['MONTH', 'QUARTER', 'YEAR'] as const

const MAX_TEXT = 200
const MAX_INSTALLMENTS = 24
/** 비율은 소수 둘째 자리까지 — 합을 정수(백분의 일)로 세야 33.33 + 33.33 + 33.34 가 100 이 된다 */
const PERCENT_SCALE = 100

const minor = z.string().regex(/^\d{1,18}$/, CONTRACT_PAYMENT_MSG.badAmount)
const text = z.string().trim().min(1).max(MAX_TEXT)
const optText = z.string().trim().max(MAX_TEXT).optional()
const currency = z.string().regex(/^[A-Z]{3}$/, CONTRACT_PAYMENT_MSG.badCurrency)
const period = z.enum(PAYMENT_PERIODS)
const percent = z.number().finite().min(0).max(100)
  .refine((n) => Math.abs(n * PERCENT_SCALE - Math.round(n * PERCENT_SCALE)) < 1e-6, CONTRACT_PAYMENT_MSG.badPercent)

const base = { currency }

const PLAN = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('LUMP'), ...base, amountMinor: minor, due: text }).strict(),
  z.object({
    kind: z.literal('INSTALLMENT'), ...base, totalMinor: minor,
    installments: z.array(z.object({ label: text, percent, due: text }).strict()).min(2).max(MAX_INSTALLMENTS),
  }).strict(),
  z.object({ kind: z.literal('FIXED'), ...base, amountMinor: minor, period, dueDay: z.number().int().min(1).max(31) }).strict(),
  z.object({ kind: z.literal('USAGE'), ...base, unitPriceMinor: minor, unit: text, period, minimumMinor: minor.optional() }).strict(),
  z.object({ kind: z.literal('PREPAID'), ...base, amountMinor: minor, expiresAfterMonths: z.number().int().min(1).max(120).optional(), refund: optText }).strict(),
  z.object({ kind: z.literal('COMMITMENT'), ...base, committedMinor: minor, period, shortfall: text }).strict(),
  z.object({ kind: z.literal('COMMISSION'), ...base, ratePercent: percent, basis: text }).strict(),
  z.object({ kind: z.literal('POINT_CONVERSION'), ...base, points: z.number().int().min(1), convertedMinor: minor, settlement: text }).strict(),
  z.object({ kind: z.literal('SUBSIDY'), ...base, subsidyMinor: minor, ownShareMinor: minor, agency: text }).strict(),
])

export type PaymentPlan = z.infer<typeof PLAN>

export class PaymentInputError extends Error {}

/** 밖에서 온 지급 일정을 검사하고 정리한 새 객체를 돌려준다. 분할은 비율 합이 100 이어야 한다 */
export function checkPaymentPlan(input: unknown): PaymentPlan {
  const r = PLAN.safeParse(input)
  if (!r.success) {
    const kind = (input as { kind?: unknown } | null)?.kind
    if (!PAYMENT_KINDS.includes(kind as PaymentKind)) throw new PaymentInputError(CONTRACT_PAYMENT_MSG.badKind)
    throw new PaymentInputError(r.error.issues[0]?.message ?? CONTRACT_PAYMENT_MSG.badShape)
  }
  const plan = r.data
  if (plan.kind === 'INSTALLMENT') {
    const sum = plan.installments.reduce((s, i) => s + Math.round(i.percent * PERCENT_SCALE), 0)
    if (sum !== 100 * PERCENT_SCALE) throw new PaymentInputError(CONTRACT_PAYMENT_MSG.percentSum(sum / PERCENT_SCALE))
  }
  return plan
}

/** 칸 값(JSON 글자) → 정리한 지급 일정. 칸에 넣기 전에 늘 이 길을 지난다 */
export function parsePaymentValue(value: string): PaymentPlan {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { throw new PaymentInputError(CONTRACT_PAYMENT_MSG.badShape) }
  return checkPaymentPlan(raw)
}

/** 정리한 지급 일정 → 칸 값. 키 순서를 고정해 같은 일정은 같은 글자가 된다(버전 비교가 헛바뀜을 안 잡게) */
export function paymentValue(plan: PaymentPlan): string {
  return JSON.stringify(plan, Object.keys(plan).sort().concat(['label', 'percent', 'due']))
}

/** 분할 줄 금액 — 반올림 나머지는 마지막 줄이 갖는다 (합이 총액과 같아야 한다) */
export function installmentAmounts(totalMinor: string, percents: readonly number[]): string[] {
  const total = toMinor(totalMinor)
  const parts = percents.map((p) => pctOfMinor(total, p, 'floor'))
  const rest = total - parts.reduce((s, p) => s + p, BigInt(0))
  return parts.map((p, i) => (i === parts.length - 1 ? p + rest : p).toString())
}

const money = (m: string, cur: string): string => escapeHtml(formatAmount(m, cur) ?? '')
const row = (cells: string[]): string => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`
const table = (head: string[], rows: string[]): string =>
  `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
const t = (s: string): string => escapeHtml(s)

/** 지급 일정 → 계약서에 인쇄하는 표. 글자는 전부 escape 한다 (보안 S4) */
export function renderPaymentSchedule(plan: PaymentPlan): string {
  const L = CONTRACT_PAYMENT
  const c = plan.currency
  const kind = L.kind[plan.kind]
  switch (plan.kind) {
    case 'LUMP':
      return table([L.colKind, L.colAmount, L.colDue], [row([kind, money(plan.amountMinor, c), t(plan.due)])])
    case 'INSTALLMENT': {
      const amounts = installmentAmounts(plan.totalMinor, plan.installments.map((i) => i.percent))
      return table([L.colStage, L.colPercent, L.colAmount, L.colDue], [
        ...plan.installments.map((i, n) => row([t(i.label), L.percent(i.percent), money(amounts[n], c), t(i.due)])),
        row([L.total, L.percent(100), money(plan.totalMinor, c), '']),
      ])
    }
    case 'FIXED':
      return table([L.colKind, L.colAmount, L.colPeriod, L.colDue], [row([kind, money(plan.amountMinor, c), L.period[plan.period], L.dueDay(plan.dueDay)])])
    case 'USAGE':
      return table([L.colKind, L.colUnitPrice, L.colPeriod, L.colMinimum], [
        row([kind, `${money(plan.unitPriceMinor, c)} / ${t(plan.unit)}`, L.period[plan.period], plan.minimumMinor ? money(plan.minimumMinor, c) : L.none]),
      ])
    case 'PREPAID':
      return table([L.colKind, L.colAmount, L.colExpiry, L.colRefund], [
        row([kind, money(plan.amountMinor, c), plan.expiresAfterMonths ? L.months(plan.expiresAfterMonths) : L.none, plan.refund ? t(plan.refund) : L.none]),
      ])
    case 'COMMITMENT':
      return table([L.colKind, L.colAmount, L.colPeriod, L.colShortfall], [row([kind, money(plan.committedMinor, c), L.period[plan.period], t(plan.shortfall)])])
    case 'COMMISSION':
      return table([L.colKind, L.colPercent, L.colBasis], [row([kind, L.percent(plan.ratePercent), t(plan.basis)])])
    case 'POINT_CONVERSION':
      return table([L.colKind, L.colPoints, L.colAmount, L.colSettlement], [row([kind, L.points(plan.points), money(plan.convertedMinor, c), t(plan.settlement)])])
    case 'SUBSIDY':
      return table([L.colKind, L.colSubsidy, L.colOwnShare, L.colAgency], [row([kind, money(plan.subsidyMinor, c), money(plan.ownShareMinor, c), t(plan.agency)])])
  }
}
