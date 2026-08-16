// 영업 단계 관리 (dacrm 통합기획서 Phase 1-6 "프로세스 캔버스 1차(보기와 편집)")
//
// **왜 뒤늦게 생겼나**: 파이프라인 API 에 `GET` 하나만 있었다.
// 즉 시드로 넣은 "KDC 제품 · 공공 · 파트너십"을 **제품 안에서 지울 방법이 없었다.**
// 사업과 안 맞는 이름이 딜 화면 탭과 리포트를 차지하는데, 사용자가 할 수 있는 일은
// 개발자에게 DB 를 고쳐 달라고 부르는 것뿐이었다.
//
// 통상의 CRM 은 이것이 **최소 조건**이다. Pipedrive 는 설정 안에서 파이프라인을
// 추가·삭제·이름변경·순서변경하고 단계마다 진입 요건을 정한다(그래서 2~3일이면 도입된다).
// 우리는 진입 조건만 만들고 **그 위층을 통째로 빠뜨렸다.**
//
// **지우는 것보다 막는 것이 먼저다.** 딜이 걸린 파이프라인·단계를 지우면
// 그 딜들이 갈 곳을 잃는다. 그래서 지우기 전에 **무엇이 걸려 있는지 세어 보여 주고**,
// 걸린 게 있으면 거부한다 — 되돌릴 수 없는 일을 조용히 하지 않는다.

import { CrmError } from '../domain/errors.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { normalizeText } from '../domain/normalize.ts'
import type { CrmDb } from '../db/client.ts'

/**
 * 이름을 받아 정리한다. 비면 거부한다.
 *
 * `requireText` 를 안 쓰는 이유: 이름과 달리 **검증하지 않고** null 을 돌려준다
 * (`normalizeText` 의 별칭이다). 여기서는 빈 이름이 들어오면 막아야 하므로 직접 던진다.
 */
function requireName(input: string | null | undefined, field: string): string {
  const v = normalizeText(input)
  if (!v) throw new CrmError('VALIDATION_FAILED', `${field}을(를) 입력해 주세요.`, { field })
  return v
}

/** 한 워크스페이스의 파이프라인 수 상한 — 넘으면 딜 화면 탭이 화면을 넘어간다 */
export const MAX_PIPELINES = 10

/** 한 파이프라인의 단계 수 상한 — 보드 컬럼이 가로로 넘치면 못 쓴다 */
export const MAX_STAGES = 12

/**
 * 새 파이프라인의 기본 단계.
 *
 * 빈 파이프라인을 주면 사용자가 처음부터 단계를 짜야 한다 — 그건 도움이 아니라 숙제다.
 * 흔한 영업 흐름을 넣어 두고 **고쳐 쓰게** 한다.
 * 성사·실패는 반드시 있어야 한다(딜을 닫을 곳이 없으면 딜이 영원히 열려 있다).
 */
export const DEFAULT_STAGES: { name: string; kind: 'OPEN' | 'WON' | 'LOST' }[] = [
  { name: '리드', kind: 'OPEN' },
  { name: '상담', kind: 'OPEN' },
  { name: '제안', kind: 'OPEN' },
  { name: '협상', kind: 'OPEN' },
  { name: '성사', kind: 'WON' },
  { name: '실패', kind: 'LOST' },
]

export interface PipelineUsage {
  pipelineId: string
  name: string
  openDeals: number
  closedDeals: number
  stages: number
}

/** 지우기 전에 무엇이 걸려 있는지 — 세어 보여 주지 않으면 사람은 모르고 누른다 */
export async function pipelineUsage(db: CrmDb, pipelineId: string): Promise<PipelineUsage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = await (db as any).crmPipeline.findFirst({
    where: { id: pipelineId },
    select: { id: true, name: true, _count: { select: { stages: true } } },
  })
  if (!p) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const open = await (db as any).crmDeal.count({ where: { pipelineId, status: 'OPEN' } })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = await (db as any).crmDeal.count({ where: { pipelineId } })

  return { pipelineId, name: p.name, openDeals: open, closedDeals: all - open, stages: p._count.stages }
}

export interface StageUsage {
  stageId: string
  name: string
  deals: number
  kind: string
}

export async function stageUsage(db: CrmDb, stageId: string): Promise<StageUsage> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s = await (db as any).crmStage.findFirst({
    where: { id: stageId },
    select: { id: true, name: true, kind: true },
  })
  if (!s) throw new CrmError('NOT_FOUND', '그 단계를 찾지 못했습니다.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = await (db as any).crmDeal.count({ where: { stageId } })
  return { stageId, name: s.name, deals, kind: s.kind }
}

export interface CreatePipelineInput {
  name: string
  /** 안 주면 흔한 영업 흐름을 넣는다 — 빈 파이프라인은 숙제일 뿐이다 */
  stageNames?: string[]
}

export async function createPipeline(
  workspaceId: string, actorId: string | null, input: CreatePipelineInput,
) {
  const name = requireName(input.name, '이름')

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const count = await (tx as any).crmPipeline.count()
    if (count >= MAX_PIPELINES) {
      throw new CrmError('VALIDATION_FAILED',
        `영업 단계는 ${MAX_PIPELINES}개까지 만들 수 있어요.`, { field: 'name' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = await (tx as any).crmPipeline.findFirst({ where: { name }, select: { id: true } })
    if (dup) {
      throw new CrmError('VALIDATION_FAILED', '같은 이름이 이미 있어요.', { field: 'name' })
    }

    /**
     * 사용자가 단계 이름을 줬으면 그대로 쓰되 **성사·실패는 반드시 붙인다.**
     * 없으면 딜을 닫을 곳이 없어 모든 딜이 영원히 열려 있게 된다.
     */
    const custom = (input.stageNames ?? []).map((s) => s.trim()).filter(Boolean).slice(0, MAX_STAGES - 2)
    const stages = custom.length > 0
      ? [
        ...custom.map((n) => ({ name: n, kind: 'OPEN' as const })),
        { name: '성사', kind: 'WON' as const },
        { name: '실패', kind: 'LOST' as const },
      ]
      : DEFAULT_STAGES

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmPipeline.create({
      data: {
        name,
        position: count + 1,
        isDefault: count === 0, // 첫 파이프라인은 기본값이 된다
        stages: { create: stages.map((s, i) => ({ name: s.name, kind: s.kind, position: i + 1 })) },
      },
      select: { id: true, name: true },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'pipeline.created', targetType: 'pipeline', targetId: created.id,
      afterJson: { name, stages: stages.map((s) => s.name) },
    })

    return created
  })
}

export async function renamePipeline(
  workspaceId: string, actorId: string | null, id: string, rawName: string,
) {
  const name = requireName(rawName, '이름')

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmPipeline.findFirst({ where: { id }, select: { name: true } })
    if (!before) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = await (tx as any).crmPipeline.findFirst({
      where: { name, NOT: { id } }, select: { id: true },
    })
    if (dup) throw new CrmError('VALIDATION_FAILED', '같은 이름이 이미 있어요.', { field: 'name' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmPipeline.update({ where: { id }, data: { name } })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'pipeline.renamed', targetType: 'pipeline', targetId: id,
      beforeJson: { name: before.name }, afterJson: { name },
    })

    return { id, name }
  })
}

/**
 * 파이프라인을 지운다(휴지통).
 *
 * **딜이 하나라도 있으면 거부한다.** 소프트 삭제라 되돌릴 수는 있지만,
 * 지운 순간 그 딜들이 보드에서 사라져 **유령이 된다** — 사람은 딜이 삭제된 줄 안다.
 * 먼저 옮기거나 닫으라고 말하는 편이 정직하다.
 */
export async function deletePipeline(workspaceId: string, actorId: string | null, id: string) {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const total = await (tx as any).crmPipeline.count()
    if (total <= 1) {
      throw new CrmError('VALIDATION_FAILED',
        '마지막 영업 단계는 지울 수 없어요. 딜을 만들 곳이 없어집니다.')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = await (tx as any).crmPipeline.findFirst({
      where: { id }, select: { name: true, isDefault: true },
    })
    if (!p) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deals = await (tx as any).crmDeal.count({ where: { pipelineId: id } })
    if (deals > 0) {
      throw new CrmError('VALIDATION_FAILED',
        `딜 ${deals}건이 여기 있어요. 다른 곳으로 옮기거나 닫은 뒤에 지울 수 있습니다.`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmPipeline.update({ where: { id }, data: { deletedAt: new Date() } })

    // 기본값이던 것을 지웠으면 다른 것을 기본으로 — 안 그러면 기본 파이프라인이 없어진다
    if (p.isDefault) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next = await (tx as any).crmPipeline.findFirst({
        orderBy: { position: 'asc' }, select: { id: true },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (next) await (tx as any).crmPipeline.update({ where: { id: next.id }, data: { isDefault: true } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'pipeline.deleted', targetType: 'pipeline', targetId: id,
      beforeJson: { name: p.name },
    })

    return { id }
  })
}

export async function setDefaultPipeline(workspaceId: string, actorId: string | null, id: string) {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = await (tx as any).crmPipeline.findFirst({ where: { id }, select: { name: true } })
    if (!p) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')

    // 기본은 하나뿐이다 — 둘이면 새 딜이 어디로 갈지 코드마다 다르게 읽는다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmPipeline.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmPipeline.update({ where: { id }, data: { isDefault: true } })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'pipeline.default_changed', targetType: 'pipeline', targetId: id,
      afterJson: { name: p.name },
    })

    return { id }
  })
}

export interface AddStageInput {
  pipelineId: string
  name: string
  /** 어디에 넣나 — 안 주면 성사·실패 바로 앞 */
  position?: number
}

/**
 * 단계를 넣는다.
 *
 * **성사·실패 뒤에는 못 넣는다.** 딜이 닫힌 뒤에 오는 단계는 뜻이 없고,
 * 보드에서 성사 칸 오른쪽에 뭔가 있으면 사람은 "여기로 더 가야 하나" 생각한다.
 */
export async function addStage(workspaceId: string, actorId: string | null, input: AddStageInput) {
  const name = requireName(input.name, '단계 이름')

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (tx as any).crmStage.findMany({
      where: { pipelineId: input.pipelineId },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, kind: true, position: true },
    }) as { id: string; name: string; kind: string; position: number }[]

    if (stages.length === 0) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')
    if (stages.length >= MAX_STAGES) {
      throw new CrmError('VALIDATION_FAILED',
        `단계는 ${MAX_STAGES}개까지 만들 수 있어요. 더 늘리면 보드가 가로로 넘칩니다.`)
    }
    if (stages.some((s) => s.name.trim() === name)) {
      throw new CrmError('VALIDATION_FAILED', '같은 단계 이름이 이미 있어요.', { field: 'name' })
    }

    // 성사·실패 앞까지가 넣을 수 있는 자리
    const openCount = stages.filter((s) => s.kind === 'OPEN').length
    const at = Math.min(Math.max(input.position ?? openCount + 1, 1), openCount + 1)

    // position 이 유니크라 한 번에 못 민다 — 전부 임시로 옮긴 뒤 다시 매긴다
    await shiftPositions(tx, stages.map((s) => s.id))

    const ordered = [...stages]
    ordered.splice(at - 1, 0, { id: '__new__', name, kind: 'OPEN', position: at })

    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].id === '__new__') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmStage.create({
          data: { pipelineId: input.pipelineId, name, kind: 'OPEN', position: i + 1 },
        })
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (tx as any).crmStage.update({ where: { id: ordered[i].id }, data: { position: i + 1 } })
      }
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'stage.added', targetType: 'stage', targetId: input.pipelineId,
      afterJson: { name, position: at },
    })

    return { name, position: at }
  })
}

/**
 * position 유니크 제약을 피해 자리를 비운다.
 *
 * `@@unique([pipelineId, position])` 때문에 1→2 를 바로 못 민다(2가 이미 있다).
 * 전부 음수로 옮겨 자리를 비운 뒤 다시 1..n 을 매긴다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function shiftPositions(tx: any, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    await tx.crmStage.update({ where: { id: ids[i] }, data: { position: -(i + 1) } })
  }
}

export async function renameStage(
  workspaceId: string, actorId: string | null, stageId: string, rawName: string,
) {
  const name = requireName(rawName, '단계 이름')

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await (tx as any).crmStage.findFirst({
      where: { id: stageId }, select: { name: true, pipelineId: true },
    })
    if (!s) throw new CrmError('NOT_FOUND', '그 단계를 찾지 못했습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dup = await (tx as any).crmStage.findFirst({
      where: { pipelineId: s.pipelineId, name, NOT: { id: stageId } }, select: { id: true },
    })
    if (dup) throw new CrmError('VALIDATION_FAILED', '같은 단계 이름이 이미 있어요.', { field: 'name' })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmStage.update({ where: { id: stageId }, data: { name } })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'stage.renamed', targetType: 'stage', targetId: stageId,
      beforeJson: { name: s.name }, afterJson: { name },
    })

    return { id: stageId, name }
  })
}

/**
 * 단계를 지운다.
 *
 * **딜이 있으면 거부한다.** 지우면 그 딜이 어느 칸에도 안 뜬다 — 보드에서 사라진 것처럼 보인다.
 * **성사·실패는 못 지운다.** 딜을 닫을 곳이 없어지면 모든 딜이 영원히 열려 있다.
 */
export async function deleteStage(workspaceId: string, actorId: string | null, stageId: string) {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await (tx as any).crmStage.findFirst({
      where: { id: stageId }, select: { name: true, kind: true, pipelineId: true },
    })
    if (!s) throw new CrmError('NOT_FOUND', '그 단계를 찾지 못했습니다.')

    if (s.kind !== 'OPEN') {
      throw new CrmError('VALIDATION_FAILED',
        '성사·실패 칸은 지울 수 없어요. 딜을 닫을 곳이 없어집니다.')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deals = await (tx as any).crmDeal.count({ where: { stageId } })
    if (deals > 0) {
      throw new CrmError('VALIDATION_FAILED',
        `딜 ${deals}건이 이 단계에 있어요. 다른 단계로 옮긴 뒤에 지울 수 있습니다.`)
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const open = await (tx as any).crmStage.count({ where: { pipelineId: s.pipelineId, kind: 'OPEN' } })
    if (open <= 1) {
      throw new CrmError('VALIDATION_FAILED',
        '진행 단계가 하나는 있어야 해요. 새 딜이 시작할 곳이 없어집니다.')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmStage.delete({ where: { id: stageId } })

    // 지운 자리를 메운다 — 빈 번호가 남으면 다음 추가에서 자리 계산이 어긋난다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rest = await (tx as any).crmStage.findMany({
      where: { pipelineId: s.pipelineId }, orderBy: { position: 'asc' }, select: { id: true },
    }) as { id: string }[]
    await shiftPositions(tx, rest.map((r) => r.id))
    for (let i = 0; i < rest.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmStage.update({ where: { id: rest[i].id }, data: { position: i + 1 } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'stage.deleted', targetType: 'stage', targetId: stageId,
      beforeJson: { name: s.name },
    })

    return { id: stageId }
  })
}

/**
 * 단계 순서를 바꾼다.
 *
 * **성사·실패는 항상 끝에 둔다.** 사용자가 가운데로 끌어와도 뒤로 돌려놓는다 —
 * 보드에서 성사 칸 오른쪽에 뭔가 있으면 "여기로 더 가야 하나"로 읽힌다.
 */
export async function reorderStages(
  workspaceId: string, actorId: string | null, pipelineId: string, orderedIds: string[],
) {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stages = await (tx as any).crmStage.findMany({
      where: { pipelineId }, select: { id: true, kind: true, name: true },
    }) as { id: string; kind: string; name: string }[]

    if (stages.length === 0) throw new CrmError('NOT_FOUND', '그 영업 단계를 찾지 못했습니다.')

    const known = new Set(stages.map((s) => s.id))
    // 목록에 없는 id 는 버리고, 빠진 것은 뒤에 붙인다 — 화면이 옛 목록을 보냈어도 잃지 않게
    const given = orderedIds.filter((id) => known.has(id))
    const missing = stages.map((s) => s.id).filter((id) => !given.includes(id))
    const all = [...given, ...missing]

    const kindOf = new Map(stages.map((s) => [s.id, s.kind]))
    const opens = all.filter((id) => kindOf.get(id) === 'OPEN')
    const wons = all.filter((id) => kindOf.get(id) === 'WON')
    const losts = all.filter((id) => kindOf.get(id) === 'LOST')
    const final = [...opens, ...wons, ...losts]

    await shiftPositions(tx, final)
    for (let i = 0; i < final.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmStage.update({ where: { id: final[i] }, data: { position: i + 1 } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: 'stage.reordered', targetType: 'pipeline', targetId: pipelineId,
      afterJson: { order: final.map((id) => stages.find((s) => s.id === id)?.name ?? id) },
    })

    return { pipelineId, count: final.length }
  })
}
