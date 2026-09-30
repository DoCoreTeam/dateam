/**
 * 검증이 비어 있으면 **왜 비었는지 말한다**
 *
 * 사용자 개입 2026-09-30: 「검증쪽은 뭐가 다 없대 이상하네」.
 *
 * 그때 화면은 관문 여덟 줄을 전부 「아직 못 잼」으로 그리고 「표본이 더 모여야 합니다」라고만
 * 적고 있었다. 그 말은 **틀렸다.** 실측으로 확인한 것은 셋이다.
 *
 * 1 `trading_backtest_runs` 0건 — 백테스트가 한 번도 안 돌았다
 * 2 `trading_job_runs` 에 검증 일이 한 줄도 없다 (있는 것은 `trading-tick` 뿐)
 * 3 봉은 1,222개, 2026-09-27부터 나흘치다
 *
 * 「표본이 모자라다」와 「한 번도 안 돌았다」는 **할 일이 다르다.** 앞의 것은 기다리면 되고,
 * 뒤의 것은 기다려도 안 된다. 화면이 둘을 같은 말로 덮으면 사람은 계속 기다린다.
 */

export interface GateEmptyFacts {
  /** 백테스트가 몇 번 돌았나 */
  backtestRuns: number
  /** 1분봉이 몇 개 있나 */
  bars: number
  /** 첫 봉 날짜 (YYYY-MM-DD). 없으면 null */
  firstBarDay: string | null
  /** 마지막 봉 날짜 (YYYY-MM-DD). 없으면 null */
  lastBarDay: string | null
  /** 신호가 몇 건 나갔나 */
  signals: number
  /**
   * 검증이 마지막으로 돌았을 때 뭐라고 했나 (사람 말). 한 번도 안 돌았으면 null.
   *
   * **필요한 날 수 식을 여기서 다시 적지 않는다.** 그 식은 `backtest/windows.ts` 하나가
   * 쥐고 있고(M4), 화면이 또 적으면 설정을 바꾼 날 둘이 다른 숫자를 말한다.
   * 실측 2026-09-30 이 문장은 「거래일이 3일뿐입니다. 3겹 워크포워드에는 최소 81일이
   * 필요합니다 (Lockbox 20 + 학습 30 + 띄움 1 + 검증 3×10)」이었다.
   */
  lastRunMessage: string | null
}

export interface GateEmptyReason {
  /** 한 줄 판정 */
  headline: string
  /** 지금 무엇이 있나 */
  facts: readonly string[]
  /** 무엇이 있어야 도나 */
  next: string
}

/**
 * 관문이 빈 이유. **백테스트가 한 번이라도 돌았으면 null** —
 * 그때는 관문 여덟 줄이 스스로 말하므로 위에 또 적으면 같은 말이 두 번 뜬다.
 */
export function gateEmptyReason(facts: GateEmptyFacts): GateEmptyReason | null {
  if (facts.backtestRuns > 0) return null

  const lines: string[] = [`백테스트 ${facts.backtestRuns.toLocaleString('ko-KR')}회`]
  lines.push(barsLine(facts))
  lines.push(`신호 ${facts.signals.toLocaleString('ko-KR')}건`)

  return {
    headline: '아직 한 번도 검증을 못 돌렸습니다',
    facts: lines,
    /*
      **검증이 한 말을 그대로 쓴다.** 그 문장이 왜 못 도는지를 가장 정확히 말한다 —
      화면이 나름대로 지어 적으면 설정을 바꾼 날 둘이 다른 소리를 한다.
      한 번도 안 돌았으면 그때는 무엇을 봐야 하는지만 말한다.
    */
    next: facts.lastRunMessage
      ?? (facts.bars === 0
        ? '가격 봉이 먼저 쌓여야 합니다. 수집이 도는지 운영 화면에서 보세요'
        : '검증이 아직 한 번도 안 돌았습니다. 운영 화면의 최근 실행을 보세요'),
  }
}

/** 봉이 얼마나 있나. **며칠치인지까지 적는다** — 개수만으로는 많은지 적은지 모른다 */
function barsLine(facts: GateEmptyFacts): string {
  const count = `1분봉 ${facts.bars.toLocaleString('ko-KR')}개`
  const days = dayCount(facts.firstBarDay, facts.lastBarDay)
  if (days === null) return count
  return `${count} (${facts.firstBarDay}부터 ${days}일치)`
}

/** 첫날과 끝날 사이가 며칠인가. 양끝을 다 센다 — 하루치도 1일이다 */
function dayCount(first: string | null, last: string | null): number | null {
  if (!first || !last) return null
  const a = Date.parse(`${first}T00:00:00+09:00`)
  const b = Date.parse(`${last}T00:00:00+09:00`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null
  return Math.round((b - a) / 86_400_000) + 1
}
