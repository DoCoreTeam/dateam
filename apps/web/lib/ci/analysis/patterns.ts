// lib/ci/analysis/patterns.ts — 성공 공식 도출 (설계서 §2-5)
// lift = 공식 적용 콘텐츠의 배수 중앙값 / 같은 주제 전체 배수 중앙값
// 근거 20개·채널 5곳 미만은 공식으로 승격하지 않는다 — 한 채널의 우연을 공식으로 팔지 않는다.

import { PATTERN_MIN_CHANNELS, PATTERN_MIN_EVIDENCE } from '../format/metrics.ts'
import { median } from './outlier.ts'

export interface PatternSample {
  contentId: string
  channelId: string | null
  title: string | null
  durationSec: number | null
  publishedAt: string | null
  outlierIndex: number | null
  baselineN: number
}

export type PatternKind = 'title' | 'hook' | 'thumbnail' | 'structure' | 'timing'

export interface PatternRule {
  key: string
  kind: PatternKind
  statement: string
  test: (s: PatternSample) => boolean
}

/**
 * 규칙 목록. 각 규칙은 "이 콘텐츠가 이 특징을 갖는가"만 답한다.
 * 통계 판단은 아래 computePatterns가 한다 — 규칙이 결론을 내리지 않는다.
 */
export const PATTERN_RULES: PatternRule[] = [
  {
    key: 'title.number',
    kind: 'title',
    statement: '제목에 숫자를 넣으면',
    test: (s) => /\d/.test(s.title ?? ''),
  },
  {
    key: 'title.question',
    kind: 'title',
    statement: '제목을 질문형으로 쓰면',
    test: (s) => /[?？]/.test(s.title ?? ''),
  },
  {
    key: 'title.bracket',
    kind: 'title',
    statement: '제목에 괄호로 부제를 붙이면',
    test: (s) => /[\[\](){}【】]/.test(s.title ?? ''),
  },
  {
    key: 'title.short',
    kind: 'title',
    statement: '제목을 20자 이내로 줄이면',
    test: (s) => (s.title ?? '').trim().length > 0 && (s.title ?? '').trim().length <= 20,
  },
  {
    key: 'structure.under60',
    kind: 'structure',
    statement: '길이를 60초 이내로 만들면',
    test: (s) => s.durationSec != null && s.durationSec <= 60,
  },
  {
    key: 'structure.1to3min',
    kind: 'structure',
    statement: '길이를 1~3분으로 맞추면',
    test: (s) => s.durationSec != null && s.durationSec > 60 && s.durationSec <= 180,
  },
  {
    key: 'timing.weekend',
    kind: 'timing',
    statement: '주말에 올리면',
    test: (s) => {
      if (!s.publishedAt) return false
      const d = new Date(s.publishedAt)
      if (Number.isNaN(d.getTime())) return false
      // KST 기준 요일 — UTC에 9시간을 더해 판정한다
      const kstDay = new Date(d.getTime() + 9 * 3600_000).getUTCDay()
      return kstDay === 0 || kstDay === 6
    },
  },
]

export interface ComputedPattern {
  key: string
  kind: PatternKind
  statement: string
  lift: number
  evidenceCount: number
  channelCount: number
  contentIds: string[]
}

/**
 * 표본에서 승격 기준을 넘는 공식만 돌려준다.
 * 기준 미달은 아예 결과에 넣지 않는다 — 화면에서 거르는 게 아니라 여기서 안 만든다.
 */
export function computePatterns(samples: readonly PatternSample[]): ComputedPattern[] {
  const usable = samples.filter((s) => s.outlierIndex != null && s.baselineN >= 8)
  if (usable.length < PATTERN_MIN_EVIDENCE) return []

  const overall = median(usable.map((s) => s.outlierIndex as number))
  if (overall == null || overall <= 0) return []

  const out: ComputedPattern[] = []

  for (const rule of PATTERN_RULES) {
    const hit = usable.filter(rule.test)
    if (hit.length < PATTERN_MIN_EVIDENCE) continue

    const channels = new Set(hit.map((s) => s.channelId).filter(Boolean))
    if (channels.size < PATTERN_MIN_CHANNELS) continue

    const hitMedian = median(hit.map((s) => s.outlierIndex as number))
    if (hitMedian == null || hitMedian <= 0) continue

    const lift = Math.round((hitMedian / overall) * 100) / 100
    // 효과가 없거나 오히려 낮으면 공식이 아니다
    if (lift < 1.2) continue

    out.push({
      key: rule.key,
      kind: rule.kind,
      statement: rule.statement,
      lift,
      evidenceCount: hit.length,
      channelCount: channels.size,
      contentIds: hit.map((s) => s.contentId),
    })
  }

  return out.sort((a, b) => b.lift - a.lift)
}
