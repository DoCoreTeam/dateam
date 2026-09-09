/**
 * 제안 전략 (설계서 F9)
 *
 * ## 전략은 적합도 판정에서 나온다
 *
 * 「무엇을 강조할까」는 우리가 잘하는 것(강점)이고, 「무엇을 채울까」는 못하는 것(갭)이다.
 * 둘 다 이미 적합도 판정이 계산해 뒀다 — **다시 물을 이유가 없고,
 * 다시 물으면 판정 화면과 제안 화면이 다른 말을 한다.**
 */

import type { Assessment } from '../fit/assess.ts'
import type { Anomaly } from '../anomaly/engine.ts'

export interface StrategyPoint {
  /** 무엇을 */
  point: string
  /** 왜 — 판정의 어느 근거에서 나왔나 */
  basis: string
}

export interface ProposalStrategy {
  verdict: Assessment['verdict']
  score: number
  /** 강조할 것 */
  emphasize: StrategyPoint[]
  /** 채워야 할 것 */
  fill: StrategyPoint[]
  /** 조심할 것 — 이상 조항에서 나온다 */
  watch: StrategyPoint[]
  /** 권장 역할 */
  recommendedRole: string
  /** 컨소시엄이 필요한가 */
  consortiumNeeded: boolean
  partnerCapabilities: string[]
}

/** 점수 항목 이름 — 화면과 전략이 같은 말을 쓴다 */
const PART_LABEL: Record<string, string> = {
  capability: '역량 적합',
  trackRecord: '실적 유사도',
  scale: '규모 적정성',
  risk: '위험 요소',
  competition: '경쟁 환경',
}

/** 이 점수 위면 강점으로 본다 (가중치 대비 비율) */
export const STRENGTH_RATIO = 0.7

/**
 * 판정에서 전략을 뽑는다.
 *
 * 새로 계산하지 않는다 — 판정 화면과 제안 화면이 다른 말을 하면
 * 사용자는 둘 다 안 믿는다.
 */
export function buildStrategy(
  assessment: Assessment,
  anomalies: readonly Anomaly[],
  weights: Readonly<Record<string, number>>,
): ProposalStrategy {
  const emphasize: StrategyPoint[] = []
  const fill: StrategyPoint[] = []

  for (const [key, value] of Object.entries(assessment.parts)) {
    const max = Math.abs(weights[key] ?? 0)
    if (max === 0) continue
    const ratio = Math.abs(value) / max
    const label = PART_LABEL[key] ?? key

    if (key === 'risk') continue      // 위험은 아래에서 따로 다룬다
    if (ratio >= STRENGTH_RATIO) {
      emphasize.push({ point: label, basis: `${label} 점수가 ${Math.round(value)} / ${max}` })
    } else if (ratio < 0.4) {
      fill.push({ point: label, basis: `${label} 점수가 ${Math.round(value)} / ${max} 로 낮다` })
    }
  }

  // 하드 제약 미충족은 가장 급한 갭이다 — 못 채우면 아예 못 낸다
  for (const c of assessment.hardChecks) {
    if (c.result !== 'unmet') continue
    fill.unshift({
      point: c.requirement.text,
      basis: c.coverableByPartner ? '파트너 역량으로 채울 수 있다' : '직접 갖춰야 한다',
    })
  }

  const watch = anomalies
    .filter((a) => a.severity === 'blocking' || a.severity === 'margin')
    .map((a) => ({ point: a.title, basis: a.rationale }))

  const needPartner = assessment.hardChecks.some((c) => c.result === 'unmet' && c.coverableByPartner)

  return {
    verdict: assessment.verdict,
    score: assessment.score,
    emphasize,
    fill,
    watch,
    recommendedRole: roleFor(assessment, needPartner),
    consortiumNeeded: needPartner || assessment.verdict === 'partial',
    partnerCapabilities: assessment.hardChecks
      .filter((c) => c.result === 'unmet' && c.coverableByPartner)
      .map((c) => c.requirement.text),
  }
}

function roleFor(a: Assessment, needPartner: boolean): string {
  if (a.verdict === 'unfit') return '참여하지 않음'
  if (a.verdict === 'full' && !needPartner) return '주관사'
  return needPartner ? '컨소시엄 구성원' : '주관사(일부 역량 보완 필요)'
}
