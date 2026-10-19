/**
 * 기준 대조 — 견적 줄을 출처 기준과 맞춰 본다 (순수 함수)
 *
 * 「원본 대조」가 올린 파일과 맞춰 보는 것이라면, 이것은 가격 기준(정상가, 규칙)과 맞춰 본다.
 * 막는 것과 알리는 것을 가른다.
 *   막음  가격 기준에서 왔는데 금액이 없는 줄(실사 후 견적). 단가를 어느 길로도 못 찾은 줄이다
 *   알림  정상가와 다른 단가, 정상가와 10배 넘게 다른 단가, 확인 전 가격, 그 사이 정상가가 바뀐 줄
 *
 * 막는 것은 이것 하나뿐이다 — 나머지는 사람이 알고 보내면 된다. 정상가보다 깎은 것은 승인이 따로 잡는다.
 */

import { withJosa, iGa } from '../../../ui/josa.ts'

export type BaselineLevel = 'block' | 'warn' | 'ok'

export interface BaselineLine {
  name: string
  unitPriceMinor: string | number | bigint
  listPriceMinor?: string | number | bigint | null
  priceSource?: string | null
  ratioPct?: string | number | null
  productId?: string | null
  provenance?: unknown
}

export interface BaselineFinding {
  level: BaselineLevel
  index: number
  message: string
}

const TENFOLD = 10

const big = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === '') return null
  try { return BigInt(String(v)) } catch { return null }
}

function sourceOf(p: unknown): string | null {
  const u = (p as { unitPrice?: { source?: unknown; note?: unknown } } | null)?.unitPrice
  return typeof u?.source === 'string' ? u.source : null
}

function isIncludedFree(p: unknown): boolean {
  const u = (p as { unitPrice?: { source?: unknown; note?: unknown } } | null)?.unitPrice
  return u?.source === 'RULE' && typeof u.note === 'string' && u.note.includes('포함')
}

/**
 * currentListPrice: 지금 가격 기준의 정상가(품목 id → 원). 견적을 만든 뒤 바뀌었는지 보는 데 쓴다. 비면 그 검사는 건너뛴다.
 */
export function baselineCheck(lines: readonly BaselineLine[], currentListPrice: ReadonlyMap<string, bigint> = new Map()): BaselineFinding[] {
  const out: BaselineFinding[] = []
  // 금액은 늘 「원」으로 끝나 받침이 있다 — 조사는 과, 으로
  const fmt = (v: bigint) => `${Number(v).toLocaleString('ko-KR')}원`
  lines.forEach((l, index) => {
    if (l.ratioPct !== null && l.ratioPct !== undefined && String(l.ratioPct) !== '') return
    const unit = big(l.unitPriceMinor) ?? BigInt(0)
    const list = big(l.listPriceMinor)
    const fromBook = l.priceSource === 'LIST'
    if (fromBook && list === null && unit === BigInt(0) && !isIncludedFree(l.provenance)) {
      out.push({ level: 'block', index, message: `${withJosa(l.name, iGa)} 「실사 후 견적」이라 금액이 없어요. 금액을 정하거나 항목을 빼야 보낼 수 있어요.` })
      return
    }
    if (sourceOf(l.provenance) === 'UNVERIFIED') {
      out.push({ level: 'warn', index, message: `${l.name} 가격이 아직 확인 전이에요.` })
    }
    if (list !== null && list > BigInt(0) && unit !== list) {
      const far = unit * BigInt(TENFOLD) < list || unit > list * BigInt(TENFOLD)
      out.push({
        level: 'warn', index,
        message: far
          ? `${l.name} 단가 ${fmt(unit)}이 정상가 ${fmt(list)}과 10배 넘게 달라요. 자리수를 확인하세요.`
          : `${l.name} 단가가 정상가 ${fmt(list)}과 ${fmt(unit > list ? unit - list : list - unit)} 달라요.`,
      })
    }
    const now = l.productId ? currentListPrice.get(l.productId) : undefined
    if (list !== null && now !== undefined && now !== list) {
      out.push({ level: 'warn', index, message: `${l.name} 정상가가 ${fmt(list)}에서 ${fmt(now)}으로 바뀌었어요. 이 견적은 바뀌기 전 값이에요.` })
    }
  })
  return out
}

export function blocks(findings: readonly BaselineFinding[]): BaselineFinding[] {
  return findings.filter((f) => f.level === 'block')
}
