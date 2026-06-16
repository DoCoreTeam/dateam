// 업무 자동 연관 연결 — 순수 로직(밴드 판정·임계값·가드). Date/random 미사용 → 단위테스트 대상.
// 오케스트레이션(임베딩·RPC·LLM)은 API 라우트에서, 의사결정 규칙만 여기 SSOT로 둔다.

export type LinkKind = 'log' | 'account' | 'deal' | 'contact' | 'project'
export type Band = 'high' | 'mid' | 'low'

export interface KindThreshold { tau_auto: number; tau_suggest: number; sample: number }
export type Thresholds = Record<LinkKind, KindThreshold>

export const DEFAULT_THRESHOLDS: Thresholds = {
  log:     { tau_auto: 0.82, tau_suggest: 0.62, sample: 0 },
  account: { tau_auto: 0.88, tau_suggest: 0.66, sample: 0 },
  deal:    { tau_auto: 0.88, tau_suggest: 0.66, sample: 0 },
  contact: { tau_auto: 0.88, tau_suggest: 0.66, sample: 0 },
  // 프로젝트는 자동확정 금지(설계 옵션B: AI는 제안만) — tau_auto를 1.01로 둬 high 밴드 진입 불가 → 항상 mid(추천)/low.
  project: { tau_auto: 1.01, tau_suggest: 0.62, sample: 0 },
}

/** 비대칭 임계: 피해 큰 엔티티(거래처/딜/연락처)는 높게, 업무↔업무는 낮게. */
export function bandOf(confidence: number, kind: LinkKind, th: Thresholds = DEFAULT_THRESHOLDS): Band {
  const t = th[kind] ?? DEFAULT_THRESHOLDS[kind]
  if (confidence >= t.tau_auto) return 'high'
  if (confidence >= t.tau_suggest) return 'mid'
  return 'low'
}

/**
 * 엔티티(거래처/딜/연락처) HIGH 자동확정 가드: 이름 문자열 겹침(trgm 유사도) 동시 충족 필수.
 * 동명 오연결 방지 — 임베딩만으로 자동확정 금지. nameSim은 0~1(서버에서 pg_trgm similarity로 계산).
 * 미입증(precision golden-set 전)엔 nameOk가 false면 high→mid로 강등.
 */
export function entityHighAllowed(nameSim: number, minNameSim = 0.3): boolean {
  return nameSim >= minNameSim
}

export interface JudgedCandidate {
  id: string
  kind: LinkKind
  confidence: number   // LLM 판정 신뢰도 0~1
  related: boolean
  relation: string     // related|derived_from|about_account|about_deal|mentions
  reason: string
  nameSim?: number     // 엔티티만: 이름 trgm 유사도
}

export interface LinkDecision extends JudgedCandidate {
  band: Band
  weak: boolean        // mid=true(추천/점선), high=false(확정)
}

/**
 * 판정 후보 → 연결 결정. related=false 또는 low밴드는 버림.
 * 엔티티 high는 이름 가드 미충족 시 mid로 강등(오연결 방지).
 */
export function decideLinks(
  candidates: JudgedCandidate[],
  th: Thresholds = DEFAULT_THRESHOLDS,
  minNameSim = 0.3,
): LinkDecision[] {
  const out: LinkDecision[] = []
  for (const c of candidates) {
    if (!c.related) continue
    let band = bandOf(c.confidence, c.kind, th)
    if (band === 'low') continue
    // 엔티티 high 가드: 이름 겹침 없으면 추천(mid)으로 강등
    if (band === 'high' && c.kind !== 'log' && !entityHighAllowed(c.nameSim ?? 0, minNameSim)) {
      band = 'mid'
    }
    out.push({ ...c, band, weak: band === 'mid' })
  }
  return out
}

/** 학습(Level1): 피드백 집계로 임계 보정. 해제율 높으면 tau_auto 상향(보수화). 표본 부족 시 변경 없음. */
export function adjustThreshold(
  current: KindThreshold,
  stats: { autoCreated: number; unlinked: number },
  minSample = 10,
): KindThreshold {
  if (stats.autoCreated < minSample) return { ...current, sample: stats.autoCreated }
  const unlinkRate = stats.unlinked / Math.max(1, stats.autoCreated)
  let tau = current.tau_auto
  if (unlinkRate > 0.2) tau = Math.min(0.97, current.tau_auto + 0.03)   // 오연결 많음 → 엄격
  else if (unlinkRate < 0.05) tau = Math.max(0.7, current.tau_auto - 0.02) // 잘 맞음 → 공격적
  return { tau_auto: Math.round(tau * 100) / 100, tau_suggest: current.tau_suggest, sample: stats.autoCreated }
}
