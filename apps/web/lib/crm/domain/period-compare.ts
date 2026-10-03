/**
 * 기간 비교 — **무엇과 견주는가** (순수)
 *
 * 왜 생겼나 (실측 2026-10-02): 리포트가 「이번 분기 3억」이라고만 말했다.
 * 그 숫자가 좋은 것인지는 견줄 것이 있어야 말할 수 있고, 분기 보고에서 가장 먼저
 * 묻는 두 질문이 「지난 분기보다는?」과 「작년 이맘때보다는?」이다. 답할 자리가 없었다.
 *
 * **0 을 돌려주지 않는다.** 견줄 것이 없을 때 0 을 주면 화면이 「0%」를 그리고,
 * 읽는 사람은 그것을 「작년과 같다」로 읽는다. 안 센 것과 세어 보니 0 인 것은
 * 다른 사실이고, 숫자 하나로 합치면 그 차이가 영영 사라진다.
 *
 * 날짜도 DB 도 모른다. 기간을 받아 기간을 돌려주고, 금액 묶음을 받아 견준 줄을 돌려준다.
 */

import { INDEX_MAX, type Period } from './target.ts'

/** 금액 묶음 한 줄. `services/business-report.ts` 의 `CurrencySum` 과 같은 모양이다 */
export interface CurrencySum {
  currency: string
  totalMinor: string
}

/**
 * 무엇과 견주나.
 *
 * 「전기」라고 쓰지 않는다. 이 저장소는 한자를 안 쓰므로 그 두 글자가 전기요금 쪽으로도
 * 읽힌다. 화면이 이미 「이전 기간」을 쓰고 있어 그 말을 그대로 쓴다(`REPORT.periodPrev`).
 */
export type CompareKey = 'PREV' | 'YOY' | 'NONE'

/** 고르는 칸에 서는 순서. 비교를 끄는 것이 맨 뒤다 — 끄려고 여는 칸이 아니다 */
export const COMPARE_ORDER: readonly CompareKey[] = ['PREV', 'YOY', 'NONE']

/**
 * 한 칸 앞 또는 뒤 기간.
 *
 * **이 셈은 여기 한 곳에만 있다.** `report-axis` 의 앞뒤 이동 단추도 이 함수를 부른다.
 * 둘이 따로 있으면 한쪽만 고쳐지고, 그때부터 「이전 기간」 단추와 「이전 기간 비교」가
 * 서로 다른 기간을 가리킨다. 그건 화면이 자기모순을 말하는 상태다.
 */
export function shiftPeriod(p: Period, step: number): Period {
  const { kind, year, index } = p
  if (kind === 'YEAR') return { kind, year: year + step }
  const max = INDEX_MAX[kind]
  // 0 부터 세는 자리로 옮기고 되돌린다. 1 부터 세는 채로 더하면 경계에서 한 칸씩 어긋난다
  const flat = (year * max) + ((index ?? 1) - 1) + step
  return { kind, year: Math.floor(flat / max), index: (flat % max) + 1 }
}

/** 바로 앞 기간. 2026년 1분기의 이전 기간은 2025년 4분기다 */
export function prevPeriod(p: Period): Period {
  return shiftPeriod(p, -1)
}

/**
 * 작년 같은 자리. 종류와 칸은 그대로고 해만 하나 뒤다.
 *
 * 계절이 있는 사업에서 이전 기간보다 정직한 비교다. 4분기가 늘 큰 회사라면
 * 「1분기가 4분기보다 작다」는 매년 참이고 아무것도 말해 주지 않는다.
 */
export function lastYearPeriod(p: Period): Period {
  return { ...p, year: p.year - 1 }
}

/** 고른 방식으로 견줄 기간. 비교를 끄면 `null` 이다 */
export function compareTarget(p: Period, key: CompareKey): Period | null {
  if (key === 'NONE') return null
  return key === 'YOY' ? lastYearPeriod(p) : prevPeriod(p)
}

/**
 * 주소에서 비교 방식을 읽는다. **못 읽으면 기본값이다 — 500 을 주지 않는다.**
 *
 * 기본값이 「이전 기간」인 이유: 리포트를 여는 사람은 이미 견줄 생각으로 온다.
 * 꺼진 채로 시작하면 견주는 길이 있다는 것 자체를 모른다.
 */
export function parseCompareKey(raw: string | null | undefined): CompareKey {
  const v = (raw ?? '').trim()
  return v === 'YOY' || v === 'NONE' || v === 'PREV' ? v : 'PREV'
}

/**
 * 견준 결과가 어떤 상태인가. **「없다」를 네 가지로 가른다.**
 *
 * 네 가지를 한 상태로 합치면 화면이 다 「견줄 것 없음」이라고 쓰게 되고,
 * 처음 생긴 매출과 사라진 매출이 같은 말로 보인다.
 */
export type CompareState =
  /** 견줬다. `ratio` 가 있다 */
  | 'ok'
  /** 견줄 기간 자체가 없다 (최근 12개월처럼 달력 기간이 아닌 것) */
  | 'noPeriod'
  /** 기간은 있는데 그 기간에 이 통화 값이 없었다. 처음 생긴 매출이다 */
  | 'noBase'
  /** 비교 기간에는 있었는데 이번 기간에 없다. 사라진 매출이다 */
  | 'gone'

export interface CompareRow {
  currency: string
  nowMinor: string
  /** 비교 기간 값. 기간 자체가 없으면 `null` 이다 */
  beforeMinor: string | null
  /** 늘거나 줄어든 비율. 견줄 바닥이 없으면 **0 이 아니라 `null`** 이다 */
  ratio: number | null
  state: CompareState
}

/**
 * 늘거나 줄어든 비율.
 *
 * **바닥이 0 이거나 없으면 `null`** 이다. 0 에서 1억이 된 것을 비율로 적으면
 * 무한이 되고, 그 자리에 아무 숫자를 넣어도 거짓이 된다. 그럴 때는 비율이 아니라
 * 「이전 기간에는 없었어요」라고 말해야 한다.
 */
export function deltaRatio(now: bigint, before: bigint | null): number | null {
  if (before === null || before === BigInt(0)) return null
  // 비율은 작은 수라 Number 로 접어도 안전하다. 금액은 끝까지 BigInt 로 둔다
  return Number(now - before) / Number(before)
}

/**
 * 통화별로 견준다. **합계 줄을 만들지 않는다.**
 *
 * 원과 달러를 더한 숫자는 아무 뜻이 없는데, 한 줄로 있으면 누군가 그 숫자를
 * 보고서에 옮겨 적는다. 서비스가 `toSums` 로 통화를 가른 것과 같은 이유다.
 *
 * 한쪽에만 있는 통화도 줄로 남긴다. 숨기면 「작년에는 달러 매출이 있었다」는
 * 사실이 화면에서 사라진다.
 */
export function compareSums(now: CurrencySum[], before: CurrencySum[] | null): CompareRow[] {
  const nowBy = new Map(now.map((s) => [s.currency, BigInt(s.totalMinor)]))
  const beforeBy = new Map((before ?? []).map((s) => [s.currency, BigInt(s.totalMinor)]))
  const currencies = [...new Set([...nowBy.keys(), ...beforeBy.keys()])]

  return currencies.map((currency) => {
    const n = nowBy.get(currency) ?? BigInt(0)
    const b = before === null ? null : beforeBy.get(currency) ?? BigInt(0)
    return {
      currency,
      nowMinor: n.toString(),
      beforeMinor: b === null ? null : b.toString(),
      ratio: deltaRatio(n, b),
      state: stateOf(n, b),
    }
  }).sort((a, b) => (BigInt(b.nowMinor) > BigInt(a.nowMinor) ? 1 : BigInt(b.nowMinor) < BigInt(a.nowMinor) ? -1 : 0))
}

function stateOf(now: bigint, before: bigint | null): CompareState {
  if (before === null) return 'noPeriod'
  if (before === BigInt(0)) return 'noBase'
  if (now === BigInt(0)) return 'gone'
  return 'ok'
}
