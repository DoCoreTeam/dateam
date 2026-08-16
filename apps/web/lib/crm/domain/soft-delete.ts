/**
 * 삭제 정책 (통합기획서 v0.2.1 473행 + 사용자 결정 2026-08-16)
 *
 * 사용자 결정: **소프트 삭제 + 즉시(영구) 삭제 선택**
 *   기본은 휴지통으로 보낸다. 휴지통에서, 또는 권한이 있는 사용자가 화면에서
 *   '영구 삭제'를 고르면 그때 진짜 지운다.
 *
 * 왜 둘 다인가
 *   영업 데이터는 실수로 지웠을 때 복구할 방법이 없으면 손실이 크다(기본=휴지통).
 *   반대로 오입력·중복·개인정보 삭제 요청처럼 "정말 없어져야 하는" 경우도 있다(선택=영구).
 *   둘 중 하나만 두면 한쪽이 늘 불편해진다.
 *
 * 이 파일은 순수 함수만 둔다. 실제 쓰기는 서비스 계층이 withCrmTx 안에서 한다.
 */

export type DeleteMode = 'trash' | 'purge'

/** 통합기획서 616·473행: 소프트 삭제 후 30일 뒤 하드 삭제 배치 */
export const TRASH_RETENTION_DAYS = 30

/** 삭제 요청 하나를 어떻게 처리할지 */
export interface DeletePlan {
  mode: DeleteMode
  /** 감사 로그 action 값 */
  auditAction: 'record.trashed' | 'record.purged'
  /** 되돌릴 수 있는가 — 확인창 문구가 이 값으로 갈린다 */
  reversible: boolean
}

export function planDelete(mode: DeleteMode): DeletePlan {
  return mode === 'purge'
    ? { mode, auditAction: 'record.purged', reversible: false }
    : { mode, auditAction: 'record.trashed', reversible: true }
}

/** 휴지통에서 자동 정리될 시각 */
export function purgeAfter(deletedAt: Date): Date {
  const d = new Date(deletedAt.getTime())
  d.setUTCDate(d.getUTCDate() + TRASH_RETENTION_DAYS)
  return d
}

/** 남은 보관 일수 (0 이하면 정리 대상) */
export function daysLeftInTrash(deletedAt: Date, now: Date = new Date()): number {
  const ms = purgeAfter(deletedAt).getTime() - now.getTime()
  return Math.ceil(ms / 86_400_000)
}

export function isPurgeDue(deletedAt: Date, now: Date = new Date()): boolean {
  return daysLeftInTrash(deletedAt, now) <= 0
}

/**
 * 확인창에 보여줄 문구의 재료.
 *
 * 규칙(다른 세션이 CI 에서 실측해 정리한 삭제 UI 표준):
 *   영구 삭제는 되돌릴 수 없으므로 **무엇이 사라지는지와 무엇이 남는지를 둘 다** 말해야 한다.
 *   남는 것을 안 밝히면 사용자는 전부 없어지는 줄 알고 못 지운다.
 */
export interface DeleteImpact {
  /** 함께 사라지는 것 — 예: ["연결된 활동 12건"] */
  removed: string[]
  /** 남는 것 — 예: ["딜 3건은 유지됩니다"] */
  kept: string[]
  /** 삭제 자체가 막히는 사유 — 있으면 삭제 버튼을 비활성화한다 */
  blockedReason?: string
}

export function describeDelete(plan: DeletePlan, impact: DeleteImpact): {
  title: string
  body: string[]
  confirmLabel: string
} {
  const body: string[] = []
  if (impact.removed.length > 0) body.push(`함께 삭제됩니다: ${impact.removed.join(', ')}`)
  if (impact.kept.length > 0) body.push(`그대로 남습니다: ${impact.kept.join(', ')}`)
  body.push(
    plan.reversible
      ? `휴지통에서 ${TRASH_RETENTION_DAYS}일 동안 복구할 수 있습니다.`
      : '이 작업은 되돌릴 수 없습니다.',
  )
  return {
    title: plan.reversible ? '휴지통으로 보낼까요?' : '영구히 삭제할까요?',
    body,
    confirmLabel: plan.reversible ? '휴지통으로' : '영구 삭제',
  }
}
