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
import {
  evaluateCriteria, normalizeCriteria, normalizeMeaning, parseStageRules, toStageRulesJson,
  type Criterion, type CriterionKey,
} from '../domain/entry-criteria.ts'

export interface StageRow {
  id: string
  name: string
  position: number
  kind: string
  criteria: Criterion[]
  /**
   * 이 단계에 왔다는 게 무슨 뜻인가 — 사람 말 한 줄. 검사하지 않고 보여만 준다.
   * 빈 문자열이 정상이다(안 적은 단계가 대부분이다).
   */
  meaning: string
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
    stages: p.stages.map((s) => {
      // 옛 형태(배열)와 새 형태({meaning, criteria})를 한 곳에서 읽는다 — 화면이 모양을 몰라도 된다.
      const rules = parseStageRules(s.entryCriteriaJson)
      return {
        id: s.id,
        name: s.name,
        position: s.position,
        kind: s.kind,
        criteria: rules.criteria,
        meaning: rules.meaning,
        dealCount: countOf.get(s.id) ?? 0,
      }
    }),
  }))
}

/**
 * 이 조건을 켜면 **지금 이 단계에 서 있는 딜 중 몇 건이 못 채웠나**.
 *
 * **왜 필요한가**: 예전 화면은 조건을 켜는 버튼만 있고 결과를 안 보여 줬다.
 * 관리자는 무엇이 걸릴지 모른 채 눌렀고, 며칠 뒤 영업이 "딜이 안 옮겨진다"고 왔다.
 * 켜기 전에 숫자를 보면 그 대화가 앞으로 당겨진다.
 *
 * **판정은 다시 짜지 않는다.** 딜 이동이 쓰는 `evaluateCriteria` 를 그대로 부른다 —
 * 두 벌이면 미리보기와 실제 결과가 갈리고, 그때부터 아무도 미리보기를 안 믿는다.
 */
export async function previewCriterionImpact(
  db: CrmDb,
  stageId: string,
  key: CriterionKey,
): Promise<{ total: number; missing: number }> {
  /**
   * 단계가 정말 있는지 먼저 본다.
   *
   * 없는 단계도 findMany 는 빈 배열을 준다 — 그러면 화면은 "0건이 못 채웠어요"라는
   * **거짓 안심 문장**을 띄운다. 지워진 단계에 대고 "아무도 안 걸려요"라고 말하는 셈이다.
   * 없는 것과 0건인 것은 다른 말이고, 사용자가 다음에 할 행동도 다르다.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stage = await (db as any).crmStage.findFirst({ where: { id: stageId }, select: { id: true } })
  if (!stage) throw new CrmError('NOT_FOUND', '단계를 찾을 수 없습니다.')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = await (db as any).crmDeal.findMany({
    where: { stageId, status: 'OPEN' },
    select: { id: true, amountMinor: true, expectedCloseDate: true, ownerId: true, companyId: true },
    take: PREVIEW_SCAN_LIMIT,
  }) as {
    id: string; amountMinor: bigint | null; expectedCloseDate: Date | null
    ownerId: string | null; companyId: string | null
  }[]
  if (deals.length === 0) return { total: 0, missing: 0 }

  // 사람·할 일은 개수를 따로 세야 한다 — 필요한 조건일 때만 센다(안 그러면 딜마다 왕복이 는다)
  const ids = deals.map((d) => d.id)
  const contactBy = key === 'contact' ? await countBy(db, 'crmDealContact', { dealId: { in: ids } }) : new Map()
  const taskBy = key === 'nextTask'
    ? await countBy(db, 'crmTask', { dealId: { in: ids }, status: { in: ['TODO', 'DOING'] } })
    : new Map()

  const one = [{ key, level: 'block' as const }]
  const missing = deals.filter((d) => !evaluateCriteria(one, {
    amountMinor: d.amountMinor,
    closeDate: d.expectedCloseDate,
    ownerId: d.ownerId,
    companyId: d.companyId,
    contactCount: contactBy.get(d.id) ?? 0,
    openTaskCount: taskBy.get(d.id) ?? 0,
  }).ok).length

  return { total: deals.length, missing }
}

/** 한 단계가 아무리 커도 미리보기 한 번이 터지지 않게 — 넘으면 본 만큼만 말한다 */
const PREVIEW_SCAN_LIMIT = 200

/** 딜별 개수를 한 번에 세어 맵으로 — 딜마다 세면 200번 왕복한다 */
async function countBy(db: CrmDb, model: string, where: unknown): Promise<Map<string, number>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any)[model].groupBy({
    by: ['dealId'], where, _count: { _all: true },
  }) as { dealId: string | null; _count: { _all: number } }[]
  return new Map(rows.filter((r) => r.dealId).map((r) => [r.dealId as string, r._count._all]))
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
): Promise<{ id: string; criteria: Criterion[]; meaning: string }> {
  // 옛 호출(배열)과 새 호출({criteria, meaning})을 둘 다 받는다 — 추가 전용(M-4).
  const isBag = !!input && typeof input === 'object' && !Array.isArray(input)
  const bag = (isBag ? input : { criteria: input }) as Record<string, unknown>
  const criteria = normalizeCriteria(bag.criteria)
  const meaning = normalizeMeaning(bag.meaning)

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
      data: { entryCriteriaJson: toStageRulesJson({ meaning, criteria }) as never },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'stage.criteria_changed',
      targetType: 'stage', targetId: stageId,
      beforeJson: parseStageRules(before.entryCriteriaJson),
      afterJson: { criteria, meaning, stageName: before.name },
    })

    return { id: stageId, criteria, meaning }
  })
}
