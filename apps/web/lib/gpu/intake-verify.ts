// USAI Stage 5 — 검증(Verify): 자기일관성 교차검증 + 신뢰도 라우팅.
// 철학: 도메인 밴드 없이 "같은 제품·같은 약정은 단일 GPU·시간당으로 정규화하면 값이 일치해야 한다"는
// 형식불변 자기일관성으로 오류를 잡는다. (6.48 버그: 8장값을 1장으로 오인하면 같은 모델 다른 블록과 불일치 → 플래그)
// 불확실(이슈/저신뢰/불일치)은 needs_human → 사람 확정 게이트로. "조용한 오답 0"이 목표.
import type { ReconciledItem } from './intake-reconcile.ts'

export interface VerifiedItem extends ReconciledItem {
  needs_human: boolean
  verify_flags: string[]
}

export interface VerifyResult {
  auto: VerifiedItem[]
  needsHuman: VerifiedItem[]
  all: VerifiedItem[]
}

export interface VerifyOptions {
  /** 이 신뢰도 미만은 사람 검토로 */
  autoConfidence?: number
  /** 동일 (모델·약정) 그룹 내 최대/최소 비율이 이를 넘으면 불일치로 간주 */
  consistencyRatio?: number
}

const modelKey = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()
// term 표기차 정규화(on-demand/on_demand/OD … → 동일) — 같은 약정이 표기차로 다른 그룹이 되어
// 자기일관성 검증을 빠져나가는 것을 방지(DC-REV HIGH).
const termKey = (t: string | null): string => (t ?? '').toLowerCase().replace(/[\s_-]/g, '')
const groupKey = (it: ReconciledItem): string => `${modelKey(it.model_name)}|${termKey(it.term)}`

/**
 * 자기일관성: 같은 (모델·약정)인데 정규화 단가가 서로 크게 다르면 추출 오류 의심 → 그룹 전체 플래그.
 * 어느 쪽이 옳은지 단정하지 않고 사람에게 넘긴다(조용한 오답 방지).
 */
function flagInconsistentGroups(items: VerifiedItem[], ratio: number): void {
  const groups = new Map<string, VerifiedItem[]>()
  for (const it of items) {
    if (it.unit_price_usd <= 0) continue
    const k = groupKey(it)
    const arr = groups.get(k) ?? []
    arr.push(it)
    groups.set(k, arr)
  }
  for (const arr of Array.from(groups.values())) {
    if (arr.length < 2) continue
    const prices = arr.map((i: VerifiedItem) => i.unit_price_usd)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    if (min > 0 && max / min > ratio) {
      for (const it of arr) it.verify_flags.push('inconsistent_group')
    }
  }
}

export function verifyItems(items: ReconciledItem[], opts: VerifyOptions = {}): VerifyResult {
  const autoConfidence = opts.autoConfidence ?? 0.75
  const consistencyRatio = opts.consistencyRatio ?? 1.5

  const verified: VerifiedItem[] = items.map((it) => ({ ...it, needs_human: false, verify_flags: [] }))

  flagInconsistentGroups(verified, consistencyRatio)

  for (const it of verified) {
    if (it.issues.length > 0) it.verify_flags.push('has_issues')
    if (it.confidence < autoConfidence) it.verify_flags.push('low_confidence')
    it.needs_human = it.verify_flags.length > 0
  }

  return {
    auto: verified.filter((v) => !v.needs_human),
    needsHuman: verified.filter((v) => v.needs_human),
    all: verified,
  }
}
