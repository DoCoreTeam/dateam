// lib/ci/analysis/cohort.ts — 비교군(코호트) 판정 SSOT
//
// 왜 이 파일이 생겼나:
//   "같은 주제 상위 3%"를 재는 모집단이 유튜브 기본 카테고리였다. 실측(2026-08-27):
//   '음식' 1,024건 안에 쯔양(구독 1,340만)과 인영인영(19.8만)이 함께 들어 있었다.
//   구독자가 67배 차이 나는 채널을 한 모집단에 넣고 백분위를 재면 그 숫자는 뜻이 없다.
//   성공 공식의 효과가 전부 1.2배(≈노이즈)로 수렴한 것도 같은 원인이다 —
//   잡탕 안에서는 어떤 규칙도 일반화되지 않는다.
//
// 그래서 비교는 **네 축이 모두 같을 때만** 성립한다고 못 박는다:
//   같은 주제 × 같은 포맷 × 같은 규모대 × 같은 기간창
//
// 이 파일은 순수 계산이다. DB·AI를 부르지 않는다.

import { OUTLIER_MIN_BASELINE } from '../format/metrics.ts'

/**
 * 비교군이 성립하는 최소 표본.
 *
 * 배수 표기 하한(OUTLIER_MIN_BASELINE=8)과 같은 값을 쓴다 — 다른 값을 쓰면
 * "배수는 보이는데 코호트는 근거 부족"처럼 화면이 자기모순을 말하게 된다.
 */
export const MIN_COHORT_SAMPLE = OUTLIER_MIN_BASELINE

/**
 * 채널 규모대. 구독자 수는 자릿수로 움직이므로 구간도 자릿수로 나눈다.
 *
 * 경계값은 **하한 포함, 상한 미포함**이다(10,000은 'small'이 아니라 'mid').
 */
export type SizeBand = 'nano' | 'small' | 'mid' | 'large'

interface SizeBandDef {
  id: SizeBand
  /** 하한 (포함) */
  min: number
  /** 상한 (미포함). 최상위 구간은 null */
  max: number | null
  label: string
}

export const SIZE_BANDS: readonly SizeBandDef[] = [
  { id: 'nano', min: 0, max: 10_000, label: '구독 1만 미만' },
  { id: 'small', min: 10_000, max: 100_000, label: '구독 1만~10만' },
  { id: 'mid', min: 100_000, max: 1_000_000, label: '구독 10만~100만' },
  { id: 'large', min: 1_000_000, max: null, label: '구독 100만 이상' },
] as const

/**
 * 구독자 수 → 규모대.
 *
 * 구독자를 모르는 채널은 null이다. **모르는 것을 'nano'로 떨어뜨리지 않는다** —
 * 그렇게 하면 미확보 채널이 전부 최소 구간에 쌓여 그 구간의 통계를 오염시킨다.
 */
export function resolveSizeBand(subscriberCount: number | null | undefined): SizeBand | null {
  if (subscriberCount == null || !Number.isFinite(subscriberCount)) return null
  if (subscriberCount < 0) return null
  for (const band of SIZE_BANDS) {
    if (subscriberCount >= band.min && (band.max == null || subscriberCount < band.max)) {
      return band.id
    }
  }
  return null
}

export function sizeBandLabel(band: SizeBand | null): string {
  if (!band) return '규모 미확인'
  return SIZE_BANDS.find((b) => b.id === band)?.label ?? '규모 미확인'
}

/** 비교군을 이루는 네 축 */
export interface CohortAxes {
  topicId: string | null
  /** short | long | image | text — 플랫폼 공통 포맷 */
  format: string | null
  sizeBand: SizeBand | null
  windowDays: number
}

/**
 * 코호트 식별키. 같은 키를 가진 것끼리만 비교한다.
 *
 * 축 하나라도 미확인(null)이면 키를 만들지 않는다 — 미확인끼리 묶어
 * "미확인 코호트"를 만들면 그 안에서 나온 배수·백분위가 다시 잡탕이 된다.
 */
export function cohortKey(axes: CohortAxes): string | null {
  if (!axes.topicId || !axes.format || !axes.sizeBand) return null
  if (!Number.isFinite(axes.windowDays) || axes.windowDays <= 0) return null
  return [axes.topicId, axes.format, axes.sizeBand, String(axes.windowDays)].join('|')
}

const FORMAT_LABEL: Record<string, string> = {
  short: '숏폼', long: '롱폼', image: '이미지', text: '텍스트',
}

export function formatLabel(format: string | null): string {
  if (!format) return '포맷 미확인'
  return FORMAT_LABEL[format] ?? format
}

/**
 * 이 비교가 무엇끼리의 비교인지 사람 말로.
 *
 * 설계서 §4.3: "사용자는 지표 이름을 배우지 않아도 된다."
 * 숫자 옆에 반드시 이 문장이 붙는다 — 무엇과 비교한 값인지 밝히지 않은 숫자는 단정이다.
 */
export function describeCohort(axes: CohortAxes, topicName?: string | null): string {
  const parts = [
    topicName ? `${topicName} 주제` : '같은 주제',
    formatLabel(axes.format),
    sizeBandLabel(axes.sizeBand),
    `최근 ${axes.windowDays}일`,
  ]
  return parts.join(' · ')
}

export interface CohortMember {
  contentId: string
  channelId: string | null
  outlierIndex: number | null
  axes: CohortAxes
}

export interface CohortGroup {
  key: string
  axes: CohortAxes
  members: CohortMember[]
  /** 표본이 MIN_COHORT_SAMPLE 이상이라 숫자를 낼 수 있는가 */
  usable: boolean
  /** 서로 다른 채널 수 — 한 채널만으로 이뤄진 코호트는 '시장'이 아니다 */
  channelCount: number
}

/**
 * 콘텐츠를 코호트로 묶는다.
 *
 * 키를 만들 수 없는 것(축 미확인)은 **버리지 않고 제외**한다 — 반환에 안 담기지만
 * 호출부가 전체 수와 비교해 "몇 건이 비교 불가였는지"를 사용자에게 말할 수 있어야 한다.
 */
export function groupIntoCohorts(members: readonly CohortMember[]): CohortGroup[] {
  const map = new Map<string, CohortGroup>()

  for (const m of members) {
    const key = cohortKey(m.axes)
    if (!key) continue

    let g = map.get(key)
    if (!g) {
      g = { key, axes: m.axes, members: [], usable: false, channelCount: 0 }
      map.set(key, g)
    }
    g.members.push(m)
  }

  // Array.from 으로 받는다 — Map 반복자 직접 순회는 이 tsconfig 타깃에서 막히고,
  // 막히면 원소 타입이 any 로 풀려 아래 map 콜백의 타입까지 사라진다.
  for (const g of Array.from(map.values())) {
    g.channelCount = new Set(g.members.map((m) => m.channelId).filter(Boolean)).size
    g.usable = g.members.length >= MIN_COHORT_SAMPLE
  }

  return Array.from(map.values()).sort((a, b) => b.members.length - a.members.length)
}

/**
 * 비교 불가로 빠진 건수. 화면이 "1,685건 중 312건은 비교군을 못 만들었습니다"라고
 * 말할 수 있게 하는 값이다. 조용히 빠지면 사용자는 전수를 봤다고 오해한다.
 */
export function countUncomparable(members: readonly CohortMember[]): number {
  return members.reduce((n, m) => (cohortKey(m.axes) ? n : n + 1), 0)
}
