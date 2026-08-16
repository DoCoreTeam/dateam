/**
 * 스테이지 이동 이력 (통합기획서 v0.2.1 539·703행)
 *
 *   539: deal_stage_history | ... duration_in_from | "스테이지 변경 트랜잭션에서 항상 함께 기록"
 *   703: "딜 갱신 + stage_history 삽입 + 자동화 이벤트 발행을 단일 트랜잭션"
 *
 * 이력이 빠지면 영업 사이클 길이·정체 감지가 통째로 거짓이 된다.
 * 그리고 이력만 남고 딜이 안 바뀌거나 그 반대면, 두 값이 서로를 반박한다.
 * 그래서 같은 트랜잭션이어야 하고(DI-09), 그 사실을 테스트가 고정한다.
 */

/**
 * 직전 스테이지에 머문 시간(초).
 * 이전 이동 기록이 없으면(첫 이동) null — 0 이 아니다.
 * 0 은 "머물지 않았다"이고 null 은 "모른다"다. 둘을 섞으면 평균 체류 시간이 거짓이 된다.
 */
export function durationSecBetween(prevMovedAt: Date | null, movedAt: Date): number | null {
  if (!prevMovedAt) return null
  const sec = Math.floor((movedAt.getTime() - prevMovedAt.getTime()) / 1000)
  // 시계 역전(서버 시간 보정 등)은 음수를 만든다. 음수 체류는 뜻이 없으므로 0 으로 접는다.
  return sec < 0 ? 0 : sec
}

export interface StageMoveInput {
  dealId: string
  fromStageId: string | null
  toStageId: string
  /** CrmMember.id. 자동화·시스템 이동이면 null */
  movedById: string | null
  movedAt: Date
  /** 직전 이동 시각 — 없으면 딜 생성 시각을 넣는다. 그것도 없으면 null */
  prevMovedAt: Date | null
}

/** crm_stage_history 한 줄로 만든다. workspaceId 는 넣지 않는다(가드가 주입) */
export function toStageHistoryData(input: StageMoveInput): Record<string, unknown> {
  return {
    dealId: input.dealId,
    fromStageId: input.fromStageId,
    toStageId: input.toStageId,
    movedById: input.movedById,
    movedAt: input.movedAt,
    durationSec: durationSecBetween(input.prevMovedAt, input.movedAt),
  }
}

/** 같은 스테이지로의 '이동'은 이력이 아니다 — 기록하면 체류 시간이 0 으로 잘게 쪼개진다 */
export function isRealMove(fromStageId: string | null, toStageId: string): boolean {
  return fromStageId !== toStageId
}
