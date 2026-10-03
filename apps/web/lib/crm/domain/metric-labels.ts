/**
 * 지표의 **이름과 뜻**: 잎사귀 모듈이다. 여기서는 아무것도 import 하지 않는다.
 *
 * **왜 따로 나왔나**: 이 두 상수는 `report-axis.ts` 에 살았는데, `metrics.ts` 가 그것을
 * 가져다 쓰면서 `report-axis → target → metrics → report-axis` 고리가 닫혔다.
 * 번들러가 그 셋을 한 청크에 묶으면 초기화 순서가 뒤집혀
 * `ReferenceError: Cannot access 'l' before initialization` 으로 **빌드가 죽는다**
 * (실측 2026-10-03: `/api/crm/reports` 의 prerender 단계에서 멈췄고, 같은 판을
 *  커밋만 꺼낸 worktree 에서는 통과했다. 고리를 닫은 줄이 미커밋이었기 때문이다).
 *
 * 값만 들고 아무것도 안 보는 모듈로 내리면 그 고리가 끊긴다.
 * `report-axis.ts` 가 이 둘을 **재수출**하므로 밖에서 쓰던 자리는 한 글자도 안 바뀐다.
 */

export const METRIC = {
  /** 이 기간에 성사된 계약 총액 */
  bookings: '수주',
  /** 아직 안 끝난 딜의 합 */
  openPipeline: '열린 파이프라인',
  /** Σ(금액 × 단계 성사율) */
  weighted: '가중 예상',
  /** 성사 ÷ (성사 + 실패) */
  winRate: '승률',
  /** 리드 → 성사까지 걸린 날 */
  cycleDays: '평균 소요',
  /**
   * 수주 총액 − 누적 인식 매출.
   * 한국 건설·용역 회계의 **수주잔고**와 같은 개념이다.
   * 「따냈지만 아직 매출로 안 잡힌 몫」이고, 다음 기간의 매출 기반이 된다
   */
  backlog: '수주잔고',
  /** 열린 파이프라인 ÷ 목표. 3~5배가 건강하다는 것이 업계 통설 */
  coverage: '파이프라인 배수',
} as const

export const METRIC_HINT = {
  bookings: '이 기간에 계약한 금액. 5년 계약이면 계약한 달에 5년치가 통째로 들어갑니다',
  openPipeline: '아직 끝나지 않은 딜의 합. 「지금 걸려 있는 일의 규모」입니다',
  weighted: '단계마다 성사율을 곱해 더한 값. 실적이 쌓이면 그 실적을, 없으면 설정값을 씁니다',
  winRate: '끝난 딜 중 성사한 비율. 끝난 딜이 없으면 계산하지 않습니다',
  cycleDays: '딜을 만들고 성사까지 걸린 날. 표본이 적으면 말하지 않습니다',
  backlog: '따냈지만 아직 매출로 안 잡힌 몫. 다음 기간 매출의 기반입니다',
  coverage: '목표 대비 몇 배가 걸려 있나. 3~5배면 건강하다고 봅니다',
} as const
