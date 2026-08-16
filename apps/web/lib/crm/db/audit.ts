/**
 * 감사 기록 헬퍼 (구현명세서 2.4 / 3.3, CLAUDE_dacrm 절대규칙 6)
 *
 * 규칙 하나뿐이다: **업무 쓰기와 같은 트랜잭션(tx)으로 기록한다.**
 * 별도 클라이언트로 쓰면 업무 쓰기가 롤백돼도 감사만 남아, 있지도 않은 변경이
 * 기록으로 남는다. 반대로 감사가 실패하면 업무 쓰기도 함께 롤백되어야 한다.
 *
 * workspaceId 는 여기서 넣지 않는다. getCrmDb 확장이 주입한다(절대규칙 4).
 * 여기서 또 넣으면 값이 두 곳에서 정해져 어긋날 자리가 생긴다.
 */

export type CrmActorTypeValue = 'HUMAN' | 'AI' | 'SYSTEM'

export interface AuditEntry {
  actorType: CrmActorTypeValue
  /** CrmMember.id 또는 CrmAiRun.id. 시스템 동작이면 null */
  actorId?: string | null
  /** 예: deal.stage_moved, suggestion.accepted, setting.updated */
  action: string
  targetType: string
  targetId: string
  beforeJson?: unknown
  afterJson?: unknown
}

/** 감사 기록에 필요한 최소 계약 — 트랜잭션 클라이언트를 그대로 받는다 */
export interface AuditCapableTx {
  crmAuditLog: {
    // data 를 넓게 받는 이유: Prisma 가 생성한 create 타입은 Exact<> 로 좁혀져 있어
    // Record<string, unknown> 을 거부한다. 그렇다고 Prisma 타입을 여기 박으면
    // 이 파일이 생성 코드에 묶여 테스트에서 가짜 tx 를 넣을 수 없다.
    // 형태 보장은 toAuditData 가 한다 — 이 인터페이스는 "쓸 수 있는 곳"만 규정한다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (args: { data: any }) => Promise<unknown>
  }
}

export function toAuditData(entry: AuditEntry): Record<string, unknown> {
  return {
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    beforeJson: entry.beforeJson ?? null,
    afterJson: entry.afterJson ?? null,
  }
}

/**
 * 같은 트랜잭션에 감사 한 줄을 남긴다.
 * 반드시 withCrmTx 콜백 안에서, 업무 쓰기와 **같은 tx** 로 호출한다.
 */
export async function writeAudit(tx: AuditCapableTx, entry: AuditEntry): Promise<void> {
  await tx.crmAuditLog.create({ data: toAuditData(entry) })
}
