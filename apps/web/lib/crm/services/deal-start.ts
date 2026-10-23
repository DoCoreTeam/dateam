/**
 * 딜이 들어갈 파이프라인과 단계 (deal.ts 에서 떼어 냄)
 *
 * deal.ts 는 server-only 모듈을 끌어와 node --test 가 못 읽는다. 판정만 여기 둔다.
 */

import { CrmError } from '../domain/errors.ts'
import { defaultPipelineId, startStageId } from '../domain/pipeline.ts'

export interface DealStartInput {
  pipelineId?: string | null
  stageId?: string | null
}

/** 스테이지가 그 파이프라인 소속인지 (DI-05). DB 복합 FK 가 최종 방어선이지만, 먼저 사람 말로 알려 준다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function assertStageBelongs(tx: any, pipelineId: string, stageId: string): Promise<void> {
  const stage = await tx.crmStage.findFirst({ where: { id: stageId }, select: { pipelineId: true } })
  if (!stage) throw new CrmError('VALIDATION_FAILED', '단계를 찾을 수 없습니다.', { field: 'stageId' })
  if (stage.pipelineId !== pipelineId) {
    throw new CrmError('VALIDATION_FAILED',
      '그 단계는 선택한 파이프라인에 속하지 않습니다.', { field: 'stageId' })
  }
}

/** 비어 있으면 「안 골랐다」로 본다 — CLI·외부 호출은 빈 문자열이나 null 을 보낸다 */
function picked(v: string | null | undefined): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

const NO_START = () => new CrmError('VALIDATION_FAILED',
  '딜을 시작할 단계가 없습니다. 파이프라인에 열린 단계를 먼저 만들어 주세요.', { field: 'stageId' })

/**
 * 딜이 들어갈 파이프라인과 단계를 정한다.
 *
 * 실측 2026-10-23: CLI 가 pipelineId 없이 보내자 「그 단계는 선택한 파이프라인에 속하지 않습니다」가 났다.
 * 딜 만들기 창은 기본 파이프라인과 첫 열린 단계를 미리 채워 보내서 이 빈칸을 몰랐다.
 * 서버도 같은 규칙(defaultPipelineId, startStageId)으로 채운다.
 *
 *   둘 다 없음 → 기본 파이프라인 + 그 첫 열린 단계
 *   단계만 있음 → 그 단계의 파이프라인
 *   파이프라인만 있음 → 그 첫 열린 단계
 *   둘 다 있음 → 소속을 확인하고 어긋나면 거절
 *
 * 단계는 부모로만 닿는 모델이라(PARENT_SCOPED) 파이프라인을 거쳐 찾는다 — 그래야 가드가
 * 워크스페이스와 삭제 조건을 붙인다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveDealStart(tx: any, input: DealStartInput): Promise<{
  pipelineId: string; stageId: string
}> {
  const pipelineId = picked(input.pipelineId)
  const stageId = picked(input.stageId)
  const STAGES = { select: { id: true, kind: true, position: true } }

  if (pipelineId && stageId) {
    await assertStageBelongs(tx, pipelineId, stageId)
    return { pipelineId, stageId }
  }
  if (stageId) {
    const owner = await tx.crmPipeline.findFirst({
      where: { stages: { some: { id: stageId } } }, select: { id: true },
    })
    if (!owner) throw new CrmError('VALIDATION_FAILED', '단계를 찾을 수 없습니다.', { field: 'stageId' })
    return { pipelineId: owner.id, stageId }
  }
  if (pipelineId) {
    const p = await tx.crmPipeline.findFirst({ where: { id: pipelineId }, select: { id: true, stages: STAGES } })
    if (!p) throw new CrmError('VALIDATION_FAILED', '파이프라인을 찾을 수 없습니다.', { field: 'pipelineId' })
    const first = startStageId(p.stages)
    if (!first) throw NO_START()
    return { pipelineId, stageId: first }
  }
  // 웹 목록과 같은 순서로 받아야 기본이 없을 때 첫 파이프라인이 같다
  const rows = await tx.crmPipeline.findMany({
    orderBy: { position: 'asc' },
    select: { id: true, name: true, isDefault: true, isActive: true, position: true, stages: STAGES },
  })
  const chosen = rows.find((p: { id: string }) => p.id === defaultPipelineId(rows))
  const first = chosen ? startStageId(chosen.stages) : null
  if (!chosen || !first) throw NO_START()
  return { pipelineId: chosen.id, stageId: first }
}
