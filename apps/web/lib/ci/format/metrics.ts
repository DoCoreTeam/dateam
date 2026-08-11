// lib/ci/format/metrics.ts — 문장형 지표 표기 SSOT
// 설계서 §4.3: "사용자는 지표 이름을 배우지 않아도 된다. 숫자가 스스로 설명하게 만든다."
// 화면에서 배수·백분위를 직접 포맷하지 않는다. 반드시 이 모듈을 경유한다.

import type { CiComparability, CiConfidence } from '../types.ts'

/** 배수 표기에 필요한 최소 비교 이력. 미만이면 표시하지 않는다(설계서 §4.3). */
export const OUTLIER_MIN_BASELINE = 8

/** 백분위 산출에 필요한 최소 모집단. 미만이면 표시하지 않는다. */
export const PERCENTILE_MIN_POPULATION = 30

/** 완전도가 이 값 미만이면 '일부만 수집됨'을 노출한다. */
export const COMPLETENESS_THRESHOLD = 0.8

/** 성공 공식 승격 기준 — 한 채널의 우연을 공식으로 팔지 않기 위한 하한. */
export const PATTERN_MIN_EVIDENCE = 20
export const PATTERN_MIN_CHANNELS = 5

/**
 * 평소 대비 배수. 비교 이력이 부족하면 null(화면은 '—'와 사유 툴팁을 렌더).
 * 소수 1자리 고정.
 */
export function formatOutlier(index: number | null | undefined, baselineN: number): string | null {
  if (index == null || !Number.isFinite(index)) return null
  if (baselineN < OUTLIER_MIN_BASELINE) return null
  if (index <= 0) return null
  return `평소 대비 ${index.toFixed(1)}배`
}

/**
 * 같은 주제 상위 %. 모집단이 얇으면 null.
 * percentile은 0~100이며 값이 작을수록 상위다.
 */
export function formatPercentile(
  percentile: number | null | undefined,
  population: number,
): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null
  if (population < PERCENTILE_MIN_POPULATION) return null
  const clamped = Math.min(100, Math.max(0, percentile))
  // 상위 0%로 표기되면 오해를 부르므로 최소 1%로 올린다.
  const shown = clamped < 1 ? 1 : Math.round(clamped)
  return `같은 주제 상위 ${shown}%`
}

/**
 * 성공 공식의 효과. 근거 개수와 채널 수 병기가 강제된다(설계서 §4.3).
 * 승격 기준 미달이면 null — 공식으로 노출하지 않는다.
 */
export function formatLift(
  lift: number | null | undefined,
  evidenceCount: number,
  channelCount: number,
): string | null {
  if (lift == null || !Number.isFinite(lift) || lift <= 0) return null
  if (evidenceCount < PATTERN_MIN_EVIDENCE) return null
  if (channelCount < PATTERN_MIN_CHANNELS) return null
  return `이 공식 적용 시 중앙값 ${lift.toFixed(1)}배 (근거 ${evidenceCount}개, 채널 ${channelCount}곳)`
}

export function formatConfidence(c: CiConfidence): string {
  switch (c) {
    case 'high': return '근거 충분'
    case 'medium': return '관찰 중'
    case 'insufficient': return '데이터 부족'
  }
}

export function formatComparability(cls: CiComparability | null | undefined): string {
  switch (cls) {
    case 'A': return '조회수 비교 가능'
    case 'B': return '참여로만 비교'
    case 'C': return '비교 불가'
    default: return '비교 기준 미확인'
  }
}

/** 임계 미만일 때만 문구를 반환한다. 정상이면 null(배지를 달지 않음). */
export function formatCompleteness(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return '수집 상태 미확인'
  if (value >= COMPLETENESS_THRESHOLD) return null
  return '일부만 수집됨'
}

/**
 * 수치에 항상 병기해야 하는 기준(설계서 §6.6 정상 상태 규칙).
 * 예: '28일 기준, 표본 42건'
 */
export function formatBasis(windowDays: number, sampleSize: number): string {
  return `${windowDays}일 기준, 표본 ${sampleSize}건`
}

/**
 * 신뢰도 판정 SSOT. DB에 캐시된 값과 별개로, 표시 직전 재판정이 필요한 곳에서 쓴다.
 * 설계: 02-ucm-and-connectors.md §2-4
 */
export function judgeConfidence(input: {
  baselineN: number
  completeness: number
  comparability: CiComparability | null
}): CiConfidence {
  const { baselineN, completeness, comparability } = input
  if (baselineN >= 20 && completeness >= 0.9 && comparability === 'A') return 'high'
  if (baselineN >= OUTLIER_MIN_BASELINE && completeness >= 0.7) return 'medium'
  return 'insufficient'
}

/**
 * AI 서술에 단정 문구를 허용할지. 근거가 부족하면 단정 금지(설계서 §7.4).
 */
export function allowsAssertiveNarrative(c: CiConfidence): boolean {
  return c !== 'insufficient'
}

/**
 * 영상 길이를 사람이 읽는 표기로. 없으면 null — 0초로 위장하지 않는다.
 * 1시간이 넘으면 시:분:초, 아니면 분:초.
 */
export function formatDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = Math.floor(sec % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * 지표 수치 표기. 정확한 수를 쓰되 천단위 구분을 넣는다.
 * null은 "미확보" — 0으로 채우면 "조회수 0"이라는 거짓이 된다.
 */
export function formatCount(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null
  return n.toLocaleString('ko-KR')
}
