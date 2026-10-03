/**
 * 어느 월물을 볼 것인가 — **한 자리에서 고른다**
 *
 * 실측 2026-09-30에 드러난 일: 검증 크론(`/api/trading/cron/validate`)이 월물을
 * **설정 덮어쓰기 값 하나만** 보고 있었다. 그 값은 빈 문자열이었고, 그래서 크론은
 * 매번 `no_contract` 로 끝났다 — `trading_job_runs` 에 그 일이 **한 줄도 없다**
 * (있는 것은 `trading-tick` 뿐). 봉이 아무리 쌓여도 백테스트가 도는 날은 안 온다.
 *
 * 그동안 수집(`jobs/tick.ts`)과 화면(`overview.ts`)은 표에서 근월물을 제대로 찾고 있었다.
 * 같은 질문에 두 가지 답이 있었던 셈이고, 그중 하나만 쓰는 쪽이 조용히 멈춰 있었다.
 *
 * 그래서 고르는 규칙을 여기 한 곳에 둔다. 덮어쓰기는 **값이 있을 때만** 이긴다 —
 * 빈 값을 「고르지 않음」이 아니라 「없음」으로 읽으면 이번 같은 일이 다시 난다.
 *
 * ## 그날 굳은 값이 월물 표를 이긴다 (실측 2026-10-02)
 *
 * 같은 구멍이 한 번 더 났다. 수집은 거래일마다 쓸 월물을 `trading_day_config` 에 **굳히는데**,
 * 화면과 실시간 가격과 검증은 그것을 모르고 `trading_contracts.is_front` 만 봤다.
 * 교체 판정이 한 번 어긋나자 **크론은 A05611, 화면은 A05610** 을 보게 됐고,
 * 크론이 모은 봉을 화면이 못 찾아 그날 차트가 통째로 비었다.
 *
 * 「지금 무엇을 거래하는가」의 답은 하나여야 한다. 그 답은 굳은 값이다 —
 * 월물 표는 증권사 마스터가 말하는 사실이고, 굳은 값은 **우리가 오늘 쓰기로 한 것**이다.
 */

export type FrontSource =
  /** 사람이 설정에서 지정한 월물 */
  | 'override'
  /** 그날 수집이 굳힌 월물. 크론이 실제로 모으는 것이 이것이다 */
  | 'frozen'
  /** 월물 표의 근월물 */
  | 'table'
  /** 어느 쪽도 못 정했다 */
  | 'none'

export interface FrontPick {
  code: string | null
  source: FrontSource
  /** 못 정했으면 왜. 정했으면 null */
  reason: string | null
}

/** 못 정했을 때 쓸 말. 무엇을 하면 되는지까지 적는다 */
export const NO_FRONT_REASON = '월물 표에 근월물이 없습니다. 수집이 한 번은 돌아야 합니다'

/**
 * 볼 월물 고르기.
 *
 * @param override 설정 `front_contract_code_override`. 빈 값이면 없는 것으로 친다
 * @param frozen `trading_day_config` 에 그날 굳은 월물. 아직 안 굳었으면 null
 * @param fromTable `trading_contracts` 에서 `is_front` 인 줄의 코드. 없으면 null
 */
export function pickFrontContract(input: {
  override: string | null | undefined
  frozen?: string | null | undefined
  fromTable: string | null | undefined
}): FrontPick {
  const override = (input.override ?? '').trim()
  if (override !== '') return { code: override, source: 'override', reason: null }

  /*
    **굳은 값이 월물 표보다 먼저다.** 크론이 오늘 모으는 것이 이 값이라,
    화면이 표를 보면 크론이 쌓은 봉을 못 찾는다(실측 2026-10-02).
  */
  const frozen = (input.frozen ?? '').trim()
  if (frozen !== '') return { code: frozen, source: 'frozen', reason: null }

  // 그날 첫 수집 전에는 굳은 값이 없다. 그때는 표가 가진 유일한 답이다
  const table = (input.fromTable ?? '').trim()
  if (table !== '') return { code: table, source: 'table', reason: null }

  return { code: null, source: 'none', reason: NO_FRONT_REASON }
}
