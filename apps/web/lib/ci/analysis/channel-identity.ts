// lib/ci/analysis/channel-identity.ts — L1 채널 정체성 (SSOT)
//
// 무엇: 채널이 올린 콘텐츠들의 플랫폼 신호를 모아 "이 채널은 무엇인가"를 판정한다.
//
// 왜 채널인가: 사람에게 물어야 할 질문은 "이 영상 주제 뭐예요?" ×10,000이 아니라
//   "이 채널 뭐 하는 채널이에요?" ×10이다. 채널 하나를 확정하면 그 채널 콘텐츠가 전부 확정된다.
//   실측: 추성훈 채널 1회 확정 = 311건, 5개 채널 중 4개가 카테고리 일치도 100%.
//   (docs/2026-08-17-ci-topic-classification-replan/00-REPORT.md §4)
//
// 이 파일은 순수 계산만 한다. DB도 AI도 부르지 않는다 — 그래야 테스트가 진실을 말한다.

import {
  categoryLabel, foldSignals, pickDominantSignal, signalLabel, isGenericSignal,
} from './signal-taxonomy.ts'

/** 채널 판정에 쓸 표본 하나 = 콘텐츠 하나가 가진 신호 */
export interface ChannelSignalSample {
  platformCategory: string | null
  topicSignals: string[]
  keywords: string[]
  /**
   * 게시물 설명문. 채널 안에서 **반복되는 줄**을 찾는 데만 쓴다(captionBoilerplate).
   *
   * 왜: 실측 「장사의 신」 645건의 캡션은 서로 다른 것이 11개뿐이었다 —
   * 나머지는 홍보 링크와 법적 고지가 통째로 복사된 것이다. 그 고지 안에
   * 「비평·패러디·풍자·교육적 설명의 목적」이 있어서 645건 전부가 '교육' 규칙에 걸렸다.
   * 플랫폼 카테고리와 **똑같은 종류의 오염**이다: 전건에 같으면 게시물을 구별하지 못한다.
   */
  caption?: string | null
}

export interface SignalCount { label: string; count: number }

export interface ChannelIdentity {
  /** 최빈 플랫폼 카테고리(원문 코드) */
  dominantCategory: string | null
  /** 최빈 카테고리의 한국어 이름 */
  dominantCategoryLabel: string | null
  /** 일치도 0~1. 1.0이면 전 콘텐츠가 같은 카테고리다 */
  categoryAgreement: number
  /** 주제 신호 빈도 (많은 순) */
  topSignals: SignalCount[]
  /** 대표 주제 신호 — 범용 신호(엔터·라이프스타일)보다 구체 신호를 우선한다 */
  dominantSignal: string | null
  /** 채널 전반에서 반복되는 태그 (많은 순, 최대 8개) */
  keywordProfile: string[]
  /** 신호를 하나라도 가진 표본 수 */
  sampleSize: number
  /** 신호가 아예 없어 판정에 못 쓴 표본 수 */
  unknownCount: number
  /**
   * 채널 대부분의 게시물 설명문에 똑같이 들어 있는 줄 — 홍보 링크·법적 고지·정기 안내.
   *
   * 예전에 저장된 정체성에는 없다(optional). 없으면 아무것도 걷어내지 않는다 —
   * 채널을 다시 훑으면 채워진다.
   */
  captionBoilerplate?: string[]
}

/** 설명문을 줄 단위로 자른다. 이 함수가 보일러플레이트 판정의 단위를 정한다 */
export function captionLines(caption: string | null | undefined): string[] {
  if (!caption) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of caption.split(/\r?\n/)) {
    const line = raw.trim()
    // 너무 짧은 줄은 우연히 겹친다("---", "📌"). 판정 단위로 쓰지 않는다
    if (line.length < 8) continue
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

/** 채널 게시물 대부분에 반복되는 줄의 하한. 신호 변별력과 같은 기준을 쓴다 */
const BOILERPLATE_SHARE = 0.8
/** 이보다 표본이 적으면 반복인지 우연인지 가릴 수 없다 */
const BOILERPLATE_MIN_SAMPLES = 5

/** 판정에 최소한 필요한 표본 수. 1~2건으로 채널 성격을 단정하지 않는다. */
export const IDENTITY_MIN_SAMPLES = 3

/**
 * 자동 확정 하한. 실측에서 5개 채널 중 4개가 1.0이었고,
 * 나머지 하나(추성훈)도 카테고리는 1.0이었다 — 0.8은 넉넉히 보수적인 선이다.
 */
export const IDENTITY_AUTO_AGREEMENT = 0.8

/** 사람에게 물어야 하는 하한. 이보다 낮으면 채널 자체가 잡탕이라 자동 판정이 위험하다. */
export const IDENTITY_ASK_AGREEMENT = 0.6

function tally(values: readonly string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1)
  return m
}

/** 빈도표 → 많은 순 배열. 동점은 이름순(같은 입력에 같은 출력) */
function ranked(counts: ReadonlyMap<string, number>): SignalCount[] {
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label))
}

/**
 * 표본에서 채널 정체성을 계산한다.
 *
 * 각 콘텐츠의 신호는 **한 번만** 센다 — 한 영상이 Music과 Pop_music을 둘 다 가져도
 * '음악'을 2로 세면 영상 하나가 두 영상인 척하게 된다.
 */
/**
 * 채널 게시물 대부분에 똑같이 들어 있는 설명문 줄을 찾는다.
 *
 * 분모는 **설명문이 있는 표본**이다 — 설명문이 없는 게시물까지 세면
 * 숏폼이 많은 채널에서 어떤 줄도 임계를 넘지 못한다(실측 423건 중 227건 설명문 없음).
 */
function computeCaptionBoilerplate(samples: readonly ChannelSignalSample[]): string[] {
  const withCaption = samples.filter((s) => (s.caption ?? '').trim().length > 0)
  if (withCaption.length < BOILERPLATE_MIN_SAMPLES) return []
  const counts = tally(withCaption.flatMap((s) => captionLines(s.caption)))
  const floor = withCaption.length * BOILERPLATE_SHARE
  return ranked(counts).filter((c) => c.count >= floor).map((c) => c.label).slice(0, 40)
}

export function computeChannelIdentity(
  platform: string,
  samples: readonly ChannelSignalSample[],
): ChannelIdentity {
  const cats = samples.map((s) => s.platformCategory).filter((c): c is string => !!c)
  const catCounts = tally(cats)
  const catRank = ranked(catCounts)
  const dominantCategory = catRank[0]?.label ?? null
  const categoryAgreement = cats.length > 0 && dominantCategory
    ? Math.round((catCounts.get(dominantCategory)! / cats.length) * 1000) / 1000
    : 0

  // 콘텐츠 단위로 접은 뒤 센다
  const signalLabels = samples.flatMap((s) => foldSignals(s.topicSignals))
  const sigCounts = tally(signalLabels)
  const dominant = pickDominantSignal(sigCounts)

  const kwCounts = tally(
    samples.flatMap((s) => Array.from(new Set(s.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)))),
  )
  // 한 번만 나온 태그는 채널의 성격이 아니라 그 영상의 사정이다
  const keywordProfile = ranked(kwCounts).filter((k) => k.count >= 2).slice(0, 8).map((k) => k.label)

  const withSignal = samples.filter((s) => s.platformCategory || s.topicSignals.length > 0).length

  return {
    dominantCategory,
    dominantCategoryLabel: categoryLabel(platform, dominantCategory),
    categoryAgreement,
    topSignals: ranked(sigCounts).slice(0, 6),
    captionBoilerplate: computeCaptionBoilerplate(samples),
    dominantSignal: dominant?.label ?? null,
    keywordProfile,
    sampleSize: withSignal,
    unknownCount: samples.length - withSignal,
  }
}

export type IdentityVerdict = 'auto' | 'ask' | 'insufficient'

/**
 * 이 정체성으로 채널 주제를 자동 확정해도 되는가.
 *
 *  - insufficient : 표본이 모자라 판정 자체를 미룬다 (사람에게도 아직 안 묻는다)
 *  - auto         : 신호가 충분히 한 방향이다 → 자동 확정
 *  - ask          : 갈린다 → **이때가 사람에게 물어야 할 자리다**
 */
export function judgeIdentity(id: ChannelIdentity): IdentityVerdict {
  if (id.sampleSize < IDENTITY_MIN_SAMPLES) return 'insufficient'
  if (id.categoryAgreement >= IDENTITY_AUTO_AGREEMENT && id.dominantSignal) return 'auto'
  if (id.categoryAgreement >= IDENTITY_AUTO_AGREEMENT && id.dominantCategory) return 'auto'
  if (id.categoryAgreement >= IDENTITY_ASK_AGREEMENT) return 'ask'
  return 'ask'
}

/**
 * 채널 판정의 확신도.
 * 카테고리 일치도를 바탕에 두되, 구체 신호가 뒷받침하면 올리고 범용 신호뿐이면 낮춘다.
 * 상한 0.95 — 사람이 확정한 것(1.0)과 기계 판정을 같은 값으로 두지 않는다.
 */
export function identityConfidence(id: ChannelIdentity): number {
  if (id.sampleSize < IDENTITY_MIN_SAMPLES) return 0
  let c = id.categoryAgreement
  if (id.dominantSignal && !isGenericSignal(id.dominantSignal)) c += 0.1
  else if (id.dominantSignal) c += 0.02
  if (id.keywordProfile.length >= 3) c += 0.03
  return Math.min(0.95, Math.round(c * 1000) / 1000)
}

/** 채널 카드·검토 화면에 그대로 뜨는 한 문장. 숫자를 사람 말로 옮긴다. */
export function describeIdentity(id: ChannelIdentity): string {
  if (id.sampleSize < IDENTITY_MIN_SAMPLES) {
    return `게시물 ${id.sampleSize}건으로는 채널 성격을 판단하기 이릅니다 (최소 ${IDENTITY_MIN_SAMPLES}건)`
  }
  const parts: string[] = []
  if (id.dominantCategoryLabel) {
    parts.push(`${id.dominantCategoryLabel} ${Math.round(id.categoryAgreement * 100)}%`)
  }
  if (id.topSignals.length > 0) {
    parts.push(id.topSignals.slice(0, 3).map((s) => `${s.label} ${s.count}건`).join(' · '))
  }
  if (id.keywordProfile.length > 0) {
    parts.push(`태그 ${id.keywordProfile.slice(0, 4).join(', ')}`)
  }
  return parts.join(' / ') || '주제 신호를 찾지 못했습니다'
}

// ── 이탈 감지 ────────────────────────────────────────────────────
//
// 채널 주제가 정해지면 콘텐츠는 그것을 **상속**한다.
// 개별 판정은 콘텐츠 신호가 채널 정체성과 **다를 때만** 한다.
// 이 판정은 집계 비교라 AI도 사람도 필요 없다 — 1만 건이어도 순수 계산이다.

export interface DivergenceResult {
  diverged: boolean
  reason: string
}

/**
 * 이 콘텐츠가 채널 정체성에서 벗어나는가.
 *
 * 벗어남이 아닌 것: 라이프스타일 채널의 Food·Film 영상 — 채널의 정상 스펙트럼이다.
 * 벗어남인 것: 그 채널에 Music 영상이 하나 섞이는 경우.
 *
 * 판정 기준은 "채널이 이 신호를 평소에 내는가"다. 채널 신호표에 있으면 정상이다.
 */
export function detectDivergence(
  id: ChannelIdentity,
  sample: ChannelSignalSample,
): DivergenceResult {
  if (id.sampleSize < IDENTITY_MIN_SAMPLES) {
    return { diverged: false, reason: '채널 표본이 적어 이탈을 판단하지 않았습니다' }
  }

  // 카테고리가 채널 최빈과 다르고, 채널이 그 카테고리를 거의 안 낸다면 이탈이다
  if (sample.platformCategory && id.dominantCategory
      && sample.platformCategory !== id.dominantCategory
      && id.categoryAgreement >= IDENTITY_AUTO_AGREEMENT) {
    return { diverged: true, reason: '이 게시물의 카테고리가 채널의 평소 카테고리와 다릅니다' }
  }

  const known = new Set(id.topSignals.map((s) => s.label))
  const mine = foldSignals(sample.topicSignals).filter((l) => !isGenericSignal(l))
  if (mine.length > 0 && known.size > 0 && mine.every((l) => !known.has(l))) {
    return {
      diverged: true,
      reason: `이 게시물의 주제 신호(${mine.slice(0, 2).join(', ')})가 채널에서 처음 나타납니다`,
    }
  }

  return { diverged: false, reason: '채널 성격과 어긋나지 않습니다' }
}

/** 콘텐츠 한 건의 신호를 사람 말로. 검토 카드의 근거 줄에 그대로 쓴다. */
export function describeSample(platform: string, s: ChannelSignalSample): string {
  const bits: string[] = []
  const cat = categoryLabel(platform, s.platformCategory)
  if (cat) bits.push(`카테고리 ${cat}`)
  const sigs = foldSignals(s.topicSignals)
  if (sigs.length > 0) bits.push(`주제 신호 ${sigs.slice(0, 3).join(' · ')}`)
  if (s.keywords.length > 0) bits.push(`태그 ${s.keywords.slice(0, 3).join(', ')}`)
  return bits.join(' / ') || '플랫폼이 주제 신호를 주지 않았습니다'
}

/** 신호 목록을 사람이 읽는 이름으로 (화면 공용) */
export { signalLabel, categoryLabel, foldSignals }
