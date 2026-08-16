// 파이프라인·단계 (dacrm 프로세스 화면)
//
// **왜 이 파일이 생겼나**: `CrmStage.entryCriteriaJson` 은 스키마에 있는데
// 읽는 코드가 **한 줄도 없었다**. 컬럼은 있고 화면은 "아직 편집할 프로세스가 없어요"만 띄웠다.
// 만들어 두고 아무도 안 쓰는 상태 — 이 저장소에서 반복된 함정이다(v0.7.438).
//
// 여기서 정한 조건을 딜 이동이 실제로 본다(`deal.ts` checkEntryCriteria).
// 그 연결이 없으면 이 화면은 설정 놀이가 된다.

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeCriteria, parseCriteria, type Criterion } from '../domain/entry-criteria.ts'

export interface StageRow {
  id: string
  name: string
  position: number
  kind: string
  criteria: Criterion[]
  /** 지금 이 단계에 몇 건이 서 있나 — 조건을 바꾸기 전에 영향 범위를 알아야 한다 */
  dealCount: number
}

export interface PipelineRow {
  id: string
  name: string
  isDefault: boolean
  stages: StageRow[]
}

export async function listPipelines(db: CrmDb): Promise<PipelineRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmPipeline.findMany({
    select: {
      id: true, name: true, isDefault: true,
      stages: {
        select: { id: true, name: true, position: true, kind: true, entryCriteriaJson: true },
        orderBy: { position: 'asc' },
      },
    },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
  }) as {
    id: string; name: string; isDefault: boolean
    stages: { id: string; name: string; position: number; kind: string; entryCriteriaJson: unknown }[]
  }[]

  // 단계별 딜 수 — 한 번에 세고 나눠 붙인다(단계마다 세면 25번 왕복한다)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const counts = await (db as any).crmDeal.groupBy({
    by: ['stageId'], _count: { _all: true },
  }) as { stageId: string; _count: { _all: number } }[]
  const countOf = new Map(counts.map((c) => [c.stageId, c._count._all]))

  return rows.map((p) => ({
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: p.stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
      criteria: parseCriteria(s.entryCriteriaJson),
      dealCount: countOf.get(s.id) ?? 0,
    })),
  }))
}

/**
 * 단계 진입 조건을 정한다.
 *
 * 손상된 정의는 여기서 걸러 낸다 — DB 에 들어간 뒤에 걸러면 이미 늦고,
 * 읽는 쪽이 매번 방어해야 한다.
 */
export async function setStageCriteria(
  workspaceId: string,
  actorId: string | null,
  stageId: string,
  input: unknown,
): Promise<{ id: string; criteria: Criterion[] }> {
  const criteria = normalizeCriteria(input)

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmStage.findFirst({
      where: { id: stageId }, select: { id: true, name: true, entryCriteriaJson: true, pipelineId: true },
    })
    if (!before) throw new CrmError('NOT_FOUND', '단계를 찾을 수 없습니다.')

    /**
     * 스테이지는 워크스페이스 컬럼이 없다(파이프라인에 딸려 있다).
     * 가드가 자동 주입을 못 하므로 **여기서 소속을 직접 확인한다** —
     * 안 하면 남의 워크스페이스 단계를 고칠 수 있다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owned = await (tx as any).crmPipeline.findFirst({
      where: { id: before.pipelineId }, select: { id: true },
    })
    if (!owned) throw new CrmError('NOT_FOUND', '단계를 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmStage.updateMany({
      where: { id: stageId },
      data: { entryCriteriaJson: criteria as never },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'stage.criteria_changed',
      targetType: 'stage', targetId: stageId,
      beforeJson: { criteria: parseCriteria(before.entryCriteriaJson) },
      afterJson: { criteria, stageName: before.name },
    })

    return { id: stageId, criteria }
  })
}
