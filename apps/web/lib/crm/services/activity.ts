/**
 * 활동(타임라인) 서비스 (dacrm T1-04, 구현명세 §6.2 중앙 열)
 *
 * 활동은 **일어난 일의 기록**이다. 그래서 다른 도메인과 규칙이 다르다.
 *
 *   · 수정하지 않는다. 일어난 일은 바뀌지 않는다.
 *     사람이 남긴 노트만 지울 수 있고(오타·오기), 그것도 휴지통을 거친다.
 *   · 정렬은 `occurredAt` 역순이다 — 만든 시각이 아니라 **일어난 시각**이다.
 *     지난주 통화를 오늘 적어도 지난주 자리에 꽂혀야 한다.
 *   · 커서는 (occurredAt, id) 다. 목록 SSOT 의 (updatedAt, id) 를 쓰면
 *     "오늘 적은 지난주 통화"가 맨 위로 튀어 시간 순서가 무너진다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import { clampLimit } from '../db/cursor.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'

export type ActivityType = 'EMAIL' | 'MEETING' | 'CALL' | 'NOTE' | 'SYSTEM'

const TYPES: ReadonlySet<string> = new Set(['EMAIL', 'MEETING', 'CALL', 'NOTE', 'SYSTEM'])

/** 사람이 직접 남길 수 있는 종류 — EMAIL·SYSTEM 은 연동·시스템이 만든다 */
export const MANUAL_TYPES: ReadonlySet<ActivityType> = new Set<ActivityType>(['NOTE', 'CALL', 'MEETING'])

export interface ActivityRow {
  id: string
  type: string
  occurredAt: Date
  title: string
  body: string | null
  companyId: string | null
  personId: string | null
  dealId: string | null
  meetingId: string | null
  source: string
  createdById: string | null
  createdAt: Date
}

const SELECT = {
  id: true, type: true, occurredAt: true, title: true, body: true,
  companyId: true, personId: true, dealId: true, meetingId: true,
  source: true, createdById: true, createdAt: true,
} as const

export interface ListActivityInput {
  limit?: number | null
  /** 이 시각보다 이전 것만 — 타임라인 "더 보기" */
  before?: string | null
  companyId?: string | null
  personId?: string | null
  dealId?: string | null
  /** 타입 필터(명세 §6.2) — 쉼표로 여러 개 */
  types?: string | null
  /** 누가 남겼나. 목록 화면의 담당자 거르기 */
  createdById?: string | null
  /** 이 날짜부터(KST 날짜, 이 날 포함) */
  from?: string | null
  /** 이 날짜까지(KST 날짜, 이 날 포함) */
  to?: string | null
  /**
   * 조건에 걸린 **전체 건수**도 함께 센다.
   *
   * 왜 고르게 하나: 타임라인은 「더 보기」로 이어 읽는 자리라 전체 수를 몰라도 된다.
   * 목록 화면은 **몇 건 중 몇 건을 보고 있는지** 말해야 한다 — 상한에 걸린 것을
   * 조용히 자르면 사람은 그것이 전부라고 읽고 보고서에 쓴다. 셈이 한 번 더 들어가므로
   * 필요한 자리만 켠다.
   */
  withTotal?: boolean
}

function parseTypes(v: string | null | undefined): ActivityType[] | null {
  if (!v) return null
  const list = v.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean)
  const bad = list.find((t) => !TYPES.has(t))
  if (bad) throw new CrmError('VALIDATION_FAILED', '알 수 없는 활동 종류입니다.', { field: 'types' })
  return list.length > 0 ? (list as ActivityType[]) : null
}

export interface ActivityPage {
  items: ActivityRow[]
  /** 다음 페이지의 기준 시각 — 없으면 끝이다 */
  nextBefore: string | null
  /** 조건에 걸린 전체 건수. `withTotal` 을 켜지 않으면 `null` 이다 — **0 이 아니다** */
  total?: number | null
}

export async function listActivities(db: CrmDb, input: ListActivityInput = {}): Promise<ActivityPage> {
  const limit = clampLimit(input.limit ?? undefined)

  const where: Record<string, unknown> = {}
  if (input.companyId) where.companyId = input.companyId
  if (input.personId) where.personId = input.personId
  if (input.dealId) where.dealId = input.dealId
  if (input.createdById) where.createdById = input.createdById
  const types = parseTypes(input.types)
  if (types) where.type = { in: types }

  /*
    **기간과 커서를 따로 들고 합친다.**

    `occurredAt` 조건을 두 번 쓰면 뒤에 쓴 것이 앞의 것을 덮어 「9월만 보기」에 커서가
    안 먹거나 그 반대가 된다. 그리고 전체 건수는 **기간만**으로 세야 한다 — 커서까지
    넣고 세면 「더 보기」를 누를 때마다 전체 수가 줄어 「421건 중 50건」이
    「371건 중 50건」이 된다.
  */
  const range: { gte?: Date; lt?: Date } = {}
  if (input.from) {
    const from = new Date(`${input.from}T00:00:00+09:00`)
    if (Number.isNaN(from.getTime())) {
      throw new CrmError('VALIDATION_FAILED', '시작 날짜가 올바르지 않습니다.', { field: 'from' })
    }
    range.gte = from
  }
  if (input.to) {
    // 그 날을 포함한다 — 다음 날 0시 직전까지. KST 로 자른다(집계 엔진과 같은 규약)
    const to = new Date(`${input.to}T00:00:00+09:00`)
    if (Number.isNaN(to.getTime())) {
      throw new CrmError('VALIDATION_FAILED', '끝 날짜가 올바르지 않습니다.', { field: 'to' })
    }
    to.setUTCDate(to.getUTCDate() + 1)
    range.lt = to
  }

  const at: { gte?: Date; lt?: Date } = { ...range }
  if (input.before) {
    const cursor = new Date(input.before)
    if (Number.isNaN(cursor.getTime())) {
      throw new CrmError('VALIDATION_FAILED', '기준 시각이 올바르지 않습니다.', { field: 'before' })
    }
    // 커서와 끝 날짜가 같이 오면 **더 이른 쪽**이 이긴다. 덮어쓰면 다음 쪽이 기간을 넘는다
    at.lt = range.lt && range.lt < cursor ? range.lt : cursor
  }
  if (Object.keys(at).length > 0) where.occurredAt = at

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmActivity.findMany({
    where, select: SELECT,
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  }) as ActivityRow[]

  const hasMore = rows.length > limit
  const items = hasMore ? rows.slice(0, limit) : rows
  const last = items[items.length - 1]

  // 전체 건수는 **커서를 뺀 기간 조건**으로 센다
  let total: number | null = null
  if (input.withTotal) {
    const countWhere = { ...where }
    if (Object.keys(range).length > 0) countWhere.occurredAt = range
    else delete countWhere.occurredAt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    total = await (db as any).crmActivity.count({ where: countWhere }) as number
  }

  return { items, nextBefore: hasMore && last ? last.occurredAt.toISOString() : null, total }
}

export interface ActivityInput {
  type?: string | null
  title: string
  body?: string | null
  /** 언제 일어났나. 안 주면 지금 — 지난 일을 적을 때만 지정한다 */
  occurredAt?: string | null
  companyId?: string | null
  personId?: string | null
  dealId?: string | null
}

export async function createActivity(
  workspaceId: string,
  actorId: string | null,
  input: ActivityInput,
): Promise<ActivityRow> {
  const title = requireText(input.title)
  if (!title) throw new CrmError('VALIDATION_FAILED', '내용을 입력해 주세요.', { field: 'title' })

  const type = (normalizeText(input.type)?.toUpperCase() ?? 'NOTE') as ActivityType
  if (!MANUAL_TYPES.has(type)) {
    // EMAIL·SYSTEM 을 사람이 만들 수 있게 두면 연동이 만든 사실과 손으로 쓴 말이 섞인다
    throw new CrmError('VALIDATION_FAILED', '직접 남길 수 있는 종류가 아닙니다.', { field: 'type' })
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date()
  if (Number.isNaN(occurredAt.getTime())) {
    throw new CrmError('VALIDATION_FAILED', '일어난 시각이 올바르지 않습니다.', { field: 'occurredAt' })
  }

  const anchored = Boolean(input.companyId || input.personId || input.dealId)
  if (!anchored) {
    // 아무 데도 안 붙은 활동은 어느 타임라인에도 나타나지 않는다 — 쓴 사람은 사라졌다고 느낀다
    throw new CrmError('VALIDATION_FAILED', '어느 회사·인물·딜의 기록인지 지정해 주세요.')
  }

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmActivity.create({
      data: {
        type, title, occurredAt,
        body: normalizeText(input.body) ?? null,
        companyId: input.companyId ?? null,
        personId: input.personId ?? null,
        dealId: input.dealId ?? null,
        source: 'HUMAN', createdById: actorId,
      },
      select: SELECT,
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'activity.created',
      targetType: 'activity', targetId: created.id, afterJson: created,
    })
    return created as ActivityRow
  })
}

export async function deleteActivity(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmActivity.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '기록을 찾을 수 없습니다.')
    // 판정 기준은 **종류**다 — 만들 수 있는 것만 지울 수 있다(createActivity 와 대칭).
    //
    // source 로 판정했더니 가드가 무력했다: 태스크 완료가 만든 활동은 완료 버튼을 누른
    // 사람에서 비롯되므로 source 가 HUMAN 이다. 그런데 그건 사람이 **쓴 글**이 아니라
    // 시스템이 남긴 사실이라 지워지면 안 된다. 종류로 보면 이 구분이 흔들리지 않는다 —
    // 나중에 Gmail 동기화가 넣을 EMAIL 도 같은 규칙으로 자동으로 막힌다.
    if (!MANUAL_TYPES.has(before.type as ActivityType)) {
      throw new CrmError('VALIDATION_FAILED', '사람이 남긴 기록만 지울 수 있습니다.')
    }

    if (plan.mode === 'purge') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmActivity.deleteMany({ where: { id } })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmActivity.updateMany({ where: { id }, data: { deletedAt: new Date() } })
    }

    /**
     * 이 기록에서 나온 **아직 처리 안 된 제안**도 함께 거둔다.
     *
     * 노트를 AI 가 읽게 되면서(activity-extract.ts) 활동도 제안의 출처가 됐다.
     * 안 거두면 인박스에 고아 제안이 남는다 — 근거를 눌러도 사라진 기록으로 가고,
     * 사람이 무심코 반영하면 **지운 글에서 나온 값**이 CRM 에 들어간다.
     * (미팅에서 똑같은 사고가 있었다: 4건을 지웠는데 제안 9건이 그대로 PENDING 이었다)
     *
     * 이미 사람이 판단한 것(ACCEPTED·REJECTED)은 건드리지 않는다 — 그건 사실로 일어난 일이다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const runs = await (tx as any).crmAiRun.findMany({
      where: { kind: 'MEETING_EXTRACT', inputRef: { path: ['activityId'], equals: id } },
      select: { id: true },
    }) as { id: string }[]
    let orphans = 0
    if (runs.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await (tx as any).crmAiSuggestion.updateMany({
        where: { runId: { in: runs.map((x) => x.id) }, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      })
      orphans = r.count
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: plan.auditAction,
      targetType: 'activity', targetId: id, beforeJson: before,
      afterJson: { expiredSuggestions: orphans },
    })
  })
}
