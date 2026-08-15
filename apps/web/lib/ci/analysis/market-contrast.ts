// lib/ci/analysis/market-contrast.ts — "지금 시장에서 무엇이 통하나" (순수 함수)
//
// 왜 이 모듈이 필요한가:
//   시장 탭은 지금까지 **나열**만 했다 — 플랫폼별 건수, 포맷별 건수, 요일별 건수.
//   사용자는 "금요일 165건"을 보고 무엇을 해야 하는지 알 수 없다. 대조가 없기 때문이다.
//   같은 질문("왜 잘 됐나")에 이미 좋은 구현이 있다 → `account-contrast`.
//   그래서 여기서 대조를 다시 짜지 않는다. **그 SSOT에 위임하고, 시장에만 필요한 조건을 앞에 건다.**
//
// 시장에만 필요한 조건이 무엇인가:
//   채널 단위 대조는 "같은 계정 안에서" 비교하므로 구독자·주제·시청층이 통제된다.
//   시장 단위는 그 통제가 없다. 대신 배수(outlier_index)가 **각 채널 자기 평소 대비**로
//   이미 정규화돼 있어, 여러 채널의 "잘된 것"을 모아 대조하는 것은 성립한다 —
//   **단, 여러 채널이 실제로 기여할 때만.**
//
//   실측(2026-08-16): 코퍼스 313건 중 한 채널이 310건(99%)이었다.
//   그 상태에서 화면은 "요일: 금요일 165건"을 시장의 성질처럼 보여줬다.
//   그건 시장이 아니라 **한 사람의 업로드 스케줄**이다.
//
// 그래서 게이트를 둘 건다. 둘 다 이 제품이 **이미 쓰던 기준**이다 — 새 기준을 만들지 않았다:
//   ① 코퍼스 채널 수 ≥ 5 (= PATTERN_MIN_CHANNELS, 성공 공식과 같은 하한)
//   ② 잘된 게시물이 나온 채널 수 ≥ 3 (한 계정의 습관을 법칙으로 팔지 않기 위해)
//
// 그리고 게이트를 통과하든 못 하든 **표본 구성은 항상 밝힌다.**
// "채널 4곳 · 이 중 한 곳이 99%"를 숨기면 통과한 발견도 믿을 수 없게 된다.

import {
  buildAccountContrast, isJudged, isWinner,
  type AccountContrast, type ContrastInput,
} from './account-contrast.ts'
import { CREATIVE_MIN_INDEX } from './outlier.ts'
import { PATTERN_MIN_CHANNELS } from '../format/metrics.ts'

/**
 * 시장이라 부르기 위한 최소 채널 수.
 * 성공 공식(`PATTERN_MIN_CHANNELS`)과 **같은 값을 재사용**한다 —
 * 같은 제품 안에서 "한 채널의 우연"을 판정하는 기준이 화면마다 다르면 안 된다.
 */
export const MARKET_MIN_CHANNELS = PATTERN_MIN_CHANNELS

/** 잘된 게시물이 이 수보다 적은 채널에서만 나왔으면 시장 발견이라 하지 않는다. */
export const MARKET_MIN_WINNER_CHANNELS = 3

/** 한 채널 비중이 이 이상이면 "이 중 X가 N%"를 문장에 박는다(차단이 아니라 공개). */
export const DOMINANCE_DISCLOSE_SHARE = 50

export interface MarketContrastInput extends ContrastInput {
  channelId: string | null
  channelName: string | null
}

export interface SampleComposition {
  contents: number
  channels: number
  topChannelName: string | null
  /** 최다 채널 비중(0~100 정수) */
  topChannelShare: number
  /** 한 채널이 표본을 지배하는가 — 화면이 경고 톤을 고를 때 쓴다 */
  dominated: boolean
  /** 화면이 그대로 출력하는 한 문장 */
  text: string
}

export interface MarketContrast extends AccountContrast {
  composition: SampleComposition
  /** 잘된 게시물이 나온 채널 수 */
  winnerChannels: number
}

function countChannels(rows: MarketContrastInput[]): Map<string, { name: string; count: number }> {
  const m = new Map<string, { name: string; count: number }>()
  for (const r of rows) {
    if (!r.channelId) continue
    const prev = m.get(r.channelId)
    m.set(r.channelId, {
      name: prev?.name ?? (r.channelName || '이름 미확인'),
      count: (prev?.count ?? 0) + 1,
    })
  }
  return m
}

/**
 * 표본이 어떻게 구성됐는지 한 문장으로. **발견이 있든 없든 항상 보여준다.**
 * 이 문장이 없으면 한 계정의 습관이 시장의 법칙처럼 읽힌다.
 */
export function describeComposition(rows: MarketContrastInput[]): SampleComposition {
  const contents = rows.length
  const chans = countChannels(rows)
  const channels = chans.size

  if (contents === 0 || channels === 0) {
    return {
      contents, channels: 0, topChannelName: null, topChannelShare: 0, dominated: false,
      text: '이 조건에 모인 게시물이 없습니다',
    }
  }

  const sorted = Array.from(chans.values()).sort((a, b) => b.count - a.count)
  const top = sorted[0]
  const share = Math.round((top.count / contents) * 100)
  const dominated = share >= DOMINANCE_DISCLOSE_SHARE

  const head = `채널 ${channels}곳 · 게시물 ${contents}건`
  const text = channels === 1
    ? `${head} — ${top.name} 한 곳입니다`
    : dominated
      ? `${head} — 이 중 ${top.name}이(가) ${share}%`
      : `${head} — 가장 많은 곳이 ${share}%`

  return { contents, channels, topChannelName: top.name, topChannelShare: share, dominated, text }
}

/**
 * 시장 코퍼스에서 "무엇이 통하나"를 대조로 뽑는다.
 *
 * 발견이 비는 것은 실패가 아니다 — **아직 말할 자격이 없다**는 뜻이고,
 * 그 이유가 `insufficientReason`에 그대로 담긴다.
 */
export function buildMarketContrast(
  rows: MarketContrastInput[],
  minIndex: number = CREATIVE_MIN_INDEX,
): MarketContrast {
  const composition = describeComposition(rows)

  const judged = rows.filter(isJudged)
  const winners = judged.filter((r) => isWinner(r, minIndex))
  const baselineN = judged.length - winners.length
  const winnerChannels = countChannels(winners).size

  // 근거 문장에 채널 수를 함께 박는다 — 건수만 보이면 한 채널에서 나온 20건이
  // 여러 채널의 20건과 같아 보인다.
  const basisText = `잘된 게시물 ${winners.length}건(채널 ${winnerChannels}곳) · 평소 ${baselineN}건 비교`

  const gated = (reason: string): MarketContrast => ({
    winners: winners.length, baseline: baselineN, findings: [],
    insufficientReason: reason, basisText, composition, winnerChannels,
  })

  // ① 시장이라 부를 수 있는 표본인가 — 이게 이번 재설계의 핵심 결함이었다
  if (composition.channels < MARKET_MIN_CHANNELS) {
    return gated(
      `채널 ${composition.channels}곳의 게시물만 모여 있어 "시장"이라 부를 수 없습니다.`
      + ` ${MARKET_MIN_CHANNELS}곳부터 시장으로 봅니다 — 성공 공식과 같은 기준입니다.`,
    )
  }

  // ② 대조 자체는 SSOT에 맡긴다(표본 하한·차이 판정·정렬 전부 그쪽 규칙)
  const base = buildAccountContrast(rows, minIndex)
  if (base.insufficientReason) {
    return { ...base, basisText, composition, winnerChannels }
  }

  // ③ 발견이 여러 채널에 걸쳐 있는가 — 한 계정의 습관을 법칙으로 팔지 않는다
  if (winnerChannels < MARKET_MIN_WINNER_CHANNELS) {
    return gated(
      `잘된 게시물이 채널 ${winnerChannels}곳에서만 나왔습니다.`
      + ` 한 계정의 습관을 시장의 법칙으로 말하지 않기 위해 ${MARKET_MIN_WINNER_CHANNELS}곳부터 말합니다.`,
    )
  }

  return { ...base, basisText, composition, winnerChannels }
}
