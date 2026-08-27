// lib/ci/analysis/signal-discrimination.ts — 신호의 변별력 (SSOT)
//
// 무엇: 채널이 가진 신호 중 **이 게시물을 구별해 주는 것만** 남긴다.
//
// 왜 필요한가 — 실측(2026-08-27, 「장사의 신」 645건):
//   platform_category = 22 … 645건 / 645건 (100%)
//   태그 '은현장' 640 · '골목식당' 638 · '백종원' 635 … 전부 98% 이상
//
//   이 값들은 645건을 **하나도 구별하지 못한다.** 그런데 L0은 카테고리 일치를
//   최고 점수(0.92) 증거로 읽었고, category 22 는 '음식'과 '인물·블로그' 양쪽에
//   매핑돼 있어 645건 전부가 '음식'이 됐다 — 제목이 「김세의 깜빵 두달차」여도,
//   「가세연 미공개 통화녹취」여도 똑같이 음식이었다.
//   그리고 제목(L2)은 게시물마다 다르니 매번 신호와 갈렸고, 갈릴 때마다 사람을 불렀다.
//   그렇게 한 채널이 **검토 대기 634건**이 됐다.
//
// 같은 통찰이 signal-taxonomy 의 isGenericSignal 에 이미 있었다 — 다만 그것은
// **전역 고정 목록**(Entertainment·Lifestyle)이다. 어느 신호가 범용인지는 채널마다 다르다:
// 이 채널에서 범용인 것은 Entertainment 가 아니라 category 22 이고,
// Food 는 오히려 99/645(15%)짜리 **변별 신호**다. 그래서 데이터에서 직접 잰다.
//
// 이 파일은 순수 계산만 한다. DB도 AI도 부르지 않는다.

import type { ChannelIdentity, ChannelSignalSample } from './channel-identity.ts'
import { IDENTITY_MIN_SAMPLES } from './channel-identity.ts'
import { signalLabel } from './signal-taxonomy.ts'

/**
 * 채널 안에서 이 비율 이상의 게시물에 붙는 신호는 게시물을 구별하지 못한다.
 *
 * 0.8인 이유: 5건 중 4건에 붙는 신호로 나머지 1건을 가려낼 수는 있어도,
 * 그 4건 사이를 가르지는 못한다. 실측값은 1.0(645/645)이라 넉넉히 걸린다.
 * 더 낮추면(예: 0.5) 절반짜리 신호까지 버려 판정 근거가 마른다.
 */
export const SIGNAL_UBIQUITY_THRESHOLD = 0.8

export interface Discrimination {
  /** L0 판정에 쓸 신호만 남긴 표본 */
  sample: ChannelSignalSample
  /** 변별력이 없어 뺀 신호 라벨 — 근거 문장에 그대로 쓴다 */
  droppedSignals: string[]
  /** 변별력이 없어 뺀 카테고리(원문 코드) */
  droppedCategory: string | null
  /** 하나라도 뺐는가 */
  filtered: boolean
}

/** 채널 안에서 이 신호가 붙은 게시물의 비율. 표본이 없으면 0 */
function signalShare(identity: ChannelIdentity, label: string): number {
  if (identity.sampleSize <= 0) return 0
  const hit = identity.topSignals.find((s) => s.label === label)
  return hit ? hit.count / identity.sampleSize : 0
}

/**
 * 채널 전체에 퍼져 있어 게시물을 구별하지 못하는 신호를 걷어낸다.
 *
 * 표본이 적으면(< IDENTITY_MIN_SAMPLES) 걷어내지 않는다 — 3건 중 3건에 붙었다고
 * 그 신호가 범용이라 단정할 수 없다. 채널이 자라면 저절로 판정된다.
 */
export function discriminatingSample(
  identity: ChannelIdentity | null | undefined,
  sample: ChannelSignalSample,
): Discrimination {
  const none: Discrimination = {
    sample,
    droppedSignals: [],
    droppedCategory: null,
    filtered: false,
  }
  if (!identity || identity.sampleSize < IDENTITY_MIN_SAMPLES) return none

  const droppedSignals: string[] = []
  const keptSignals = sample.topicSignals.filter((raw) => {
    const label = signalLabel(raw)
    if (signalShare(identity, label) < SIGNAL_UBIQUITY_THRESHOLD) return true
    if (!droppedSignals.includes(label)) droppedSignals.push(label)
    return false
  })

  // 카테고리는 채널 전체가 같은 값일 때만 뺀다.
  // categoryAgreement 는 **최빈 카테고리**의 비율이므로, 이 게시물이 그 최빈값일 때만 해당한다
  // — 남들과 다른 카테고리를 가진 게시물은 오히려 그것이 가장 강한 변별 신호다.
  const catIsUbiquitous =
    sample.platformCategory != null &&
    identity.dominantCategory === sample.platformCategory &&
    identity.categoryAgreement >= SIGNAL_UBIQUITY_THRESHOLD

  const droppedCategory = catIsUbiquitous ? sample.platformCategory : null
  const filtered = droppedSignals.length > 0 || droppedCategory != null
  if (!filtered) return none

  return {
    sample: {
      platformCategory: catIsUbiquitous ? null : sample.platformCategory,
      topicSignals: keptSignals,
      keywords: sample.keywords,
    },
    droppedSignals,
    droppedCategory,
    filtered: true,
  }
}

/** 무엇을 왜 뺐는지 사용자에게 말한다. 뺀 것이 없으면 빈 문자열 */
export function describeDiscrimination(d: Discrimination): string {
  if (!d.filtered) return ''
  // 조사를 문장에 박지 않는다 — 뺀 것의 이름이 무엇이든 같은 문장이 성립해야 한다(§0-2 규칙 3)
  const parts: string[] = []
  if (d.droppedCategory) parts.push('플랫폼 분류')
  for (const s of d.droppedSignals.slice(0, 3)) parts.push(s)
  return `이 채널 게시물 대부분에 똑같이 붙어 있어 판단에서 뺀 것 — ${parts.join(' · ')}`
}

/**
 * 채널 게시물 대부분에 똑같이 들어 있는 설명문 줄을 걷어낸다.
 *
 * 신호 변별력과 같은 원리다 — 전건에 같은 것은 이 게시물을 구별하지 못한다.
 * 다른 점은 하나뿐이다: 신호는 통째로 빼지만 설명문은 **그 줄만** 뺀다.
 * 남는 줄이 이 게시물만의 설명이다.
 */
export function stripBoilerplate(
  caption: string | null | undefined,
  boilerplate: readonly string[] | undefined,
): string | null {
  if (!caption) return caption ?? null
  if (!boilerplate || boilerplate.length === 0) return caption
  const drop = new Set(boilerplate)
  const kept = caption.split(/\r?\n/).filter((raw) => !drop.has(raw.trim()))
  const out = kept.join('\n').trim()
  return out.length > 0 ? out : null
}
