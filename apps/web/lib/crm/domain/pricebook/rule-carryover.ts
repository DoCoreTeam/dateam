/**
 * 가격표를 다시 올릴 때 새 파일에 없는 기존 규칙을 찾는다 (REQ-003)
 *
 * 실측 2026-10-23: gcube edge 새 가격표를 올리자 규칙 19개가 16개가 됐다. 저장이 규칙을 전부 지우고
 * 새 파일 것만 넣어서다. 빠진 셋 중 하나가 「STD 고객이 ENT 를 고르면 ENT 전환 구축 1,200만 원」이라
 * 전환 견적에서 구축비가 조용히 빠졌다. 품목은 이미 「없어지면 판매 중지」로 남기고 있었다. 규칙만 그 길이 없었다.
 *
 * 같은 규칙인가는 **무엇에 걸리는지**로 본다(종류, 가리키는 품목 이름, 변수, 기관 종류, 묶음).
 * 숫자(상한, 할인율, 수량)는 안 본다. 새 파일이 같은 규칙의 숫자를 바꿨으면 그것은 새 값으로 바뀐 것이지 빠진 것이 아니다.
 * 기존 규칙은 실제 품목 id, 새 초안은 초안 id 를 가리키므로 둘 다 이름으로 바꿔 비교한다.
 */

import type { PriceRule } from './types.ts'

type NameOf = (id: string) => string | null

const SINGLE_REFS = ['item', 'from', 'to'] as const
const LIST_REFS = ['items', 'with'] as const
const PLAIN_KEYS = ['varKey', 'companyKind', 'section'] as const

const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()

export function ruleKey(rule: PriceRule, nameOf: NameOf): string {
  const r = rule as unknown as Record<string, unknown>
  const name = (id: string) => norm(nameOf(id) ?? id)
  const parts: string[] = [rule.kind]
  for (const k of SINGLE_REFS) if (typeof r[k] === 'string') parts.push(`${k}=${name(r[k] as string)}`)
  for (const k of LIST_REFS) if (Array.isArray(r[k])) parts.push(`${k}=${(r[k] as string[]).map(name).sort().join(',')}`)
  for (const k of PLAIN_KEYS) if (r[k] !== undefined && r[k] !== null) parts.push(`${k}=${String(r[k])}`)
  return parts.join('|')
}

export interface ExistingRule {
  id: string
  rule: PriceRule
}

export function findMissingRules(
  existing: readonly ExistingRule[], existingNameOf: NameOf,
  incoming: readonly PriceRule[], incomingNameOf: NameOf,
): ExistingRule[] {
  const keys = new Set(incoming.map((r) => ruleKey(r, incomingNameOf)))
  return existing.filter((e) => !keys.has(ruleKey(e.rule, existingNameOf)))
}

/** 저장 때 고른 것 — 버린다고 고른 것만 빠지고 나머지는 이어받는다. 이 제품의 빠진 규칙이 아닌 id 는 무시한다 */
export function splitCarryover(missing: readonly ExistingRule[], dropIds: readonly string[]): { kept: ExistingRule[]; dropped: ExistingRule[] } {
  const drop = new Set(dropIds)
  return { kept: missing.filter((m) => !drop.has(m.id)), dropped: missing.filter((m) => drop.has(m.id)) }
}
