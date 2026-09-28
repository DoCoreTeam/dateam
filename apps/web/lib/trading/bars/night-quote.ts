/**
 * 야간 시세 조회 창구 — **아직 없다는 것을 값으로 둔다**
 *
 * ## 무엇이 고장이었나 (실측 2026-09-29)
 *
 * 크론 최근 1000회 중 **476회가 `bar_not_ready`** 였다. 야간 세션 동안 매분
 * 낮 분봉 창구(`FHKIF03020200`)로 물어보고, 못 받으면 3초 뒤 두 번 더 물어보고,
 * 그래도 없으니 「아직 안 들어왔다」를 남긴 것이다. 하룻밤이면 벤더 호출 2천 번이
 * 같은 빈 답을 받으러 나간다.
 *
 * 계좌 조회는 낮·밤 짝이 이미 있다 — `endpoints.ts` 의 `NIGHT_EQUIVALENT` 가
 * `inquire-ccnl` ↔ `inquire-ngt-ccnl` 을 이어 준다. **시세 조회에는 그 짝이 없다.**
 * 짝이 없다는 사실이 코드 어디에도 안 적혀 있어서, 낮 창구를 밤에 그냥 쓴 것이다.
 *
 * ## 왜 추측해서 안 채우나
 *
 * KIS 의 야간 분봉 경로와 `tr_id` 를 이 저장소가 모른다. 계좌 쪽 이름
 * (`inquire-ngt-ccnl`·`STTN5201R`)을 보고 시세 쪽을 지어내면 **조용히 틀린다** —
 * 없는 주소는 오류를 주지만 있는데 다른 주소는 엉뚱한 값을 주고, 그것이 봉이 되어 쌓인다.
 * 그래서 비워 두고, **비어 있다는 사실을 말한다.** 값을 아는 사람이 한 줄 채우면 그때 돈다.
 *
 * ## 채우는 법
 *
 * `NIGHT_QUOTATION.minuteChart` 에 야간 분봉의 `path` 와 `trId` 를 적고,
 * 그 값을 꺼내 쓰는 자리를 그때 함께 쓴다. 판정(`hasNightQuotation`)은 그대로 돈다.
 */

import { KIS_QUOTATIONS } from '../broker/endpoints.ts'

export type KisQuotationKey = keyof typeof KIS_QUOTATIONS

export interface NightQuotation {
  path: string
  trId: string
}

/**
 * 낮 조회의 야간 짝. **비어 있는 것이 지금의 사실이다** —
 * 주석으로만 적으면 다음 사람이 「없나 보다」와 「아직 안 적었나 보다」를 구별 못 한다.
 *
 * 값을 꺼내 쓰는 함수는 **안 만든다.** 쓸 자리가 아직 없고, 없는데 만들어 두면
 * 다음 사람이 「이미 배선돼 있구나」로 읽는다. 채우는 사람이 그때 부르는 쪽을 함께 쓴다.
 */
export const NIGHT_QUOTATION: Partial<Record<KisQuotationKey, NightQuotation>> = {}

/** 이 조회를 야간에 부를 수 있나 — **지금 이 표가 대답하는 유일한 질문이다** */
export function hasNightQuotation(key: KisQuotationKey): boolean {
  return NIGHT_QUOTATION[key] !== undefined
}

/** 못 부르는 이유. 실행 기록과 화면이 같은 말을 쓰게 한 곳에서 정한다 */
export const NO_NIGHT_QUOTE_REASON = 'no_night_quote:minuteChart'

export const NO_NIGHT_QUOTE_MESSAGE =
  '야간장 시세를 받을 창구가 아직 없습니다. 낮 창구로는 야간 봉이 안 나와 묻지 않습니다'
