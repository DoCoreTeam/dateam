/**
 * 딜 서비스 (dacrm T1-03)
 *
 * 회사·인물과 다른 점이 둘 있다. 둘 다 "값이 서로를 반박하지 않게" 하는 장치다.
 *
 *   1) 상태 전이는 반드시 canTransit 을 거친다 (CLAUDE_dacrm 절대규칙 5)
 *      WON 은 성사일·금액 없이 존재할 수 없고(DI-06), LOST 는 사유 없이 존재할 수 없다(DI-07).
 *      WON 에서 LOST 로 바로 갈 수도 없다(DI-08) — 재오픈을 거쳐야 흔적이 남는다.
 *      화면이 이 판정을 다시 구현하면 화면과 API 의 답이 갈린다.
 *
 *   2) 스테이지를 옮기면 이력을 **같은 트랜잭션에** 남긴다 (DI-09)
 *      이력이 빠지면 영업 사이클 길이가 통째로 거짓이 되고,
 *      이력만 남고 딜이 안 바뀌면 두 값이 서로를 반박한다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeText, requireText } from '../domain/normalize.ts'
import { assertTransit, type DealStatus } from '../domain/state-machines.ts'
import { toStageHistoryData, isRealMove } from '../domain/stage-history.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import { loadRules, runAutomations, type TriggerKind } from './automation.ts'
import {
  clampLimit, decodeCursor, cursorWhere, CURSOR_ORDER, toPage, countIfFirstPage,
  type CursorInput, type CursorPage,
} from '../db/cursor.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'
import { pickBooked } from '../domain/booked-amount.ts'
import { monthSpan } from '../domain/allocation.ts'
import { BUSINESS_TYPE_ORDER, TERM_TYPE_ORDER } from '../../terms/ledger.ts'
import {
  parseCriteria, evaluateCriteria, blockingMessage,
  type CriteriaVerdict,
} from '../domain/entry-criteria.ts'

export interface DealRow {
  id: string
  companyId: string
  pipelineId: string
  stageId: string
  name: string
  status: string
  amountMinor: bigint | null
  currency: string | null
  expectedCloseDate: Date | null
  wonAt: Date | null
  lostReason: string | null
  ownerId: string | null
  version: number
  updatedAt: Date
  /** 장부의 세 금액 — 「금액」은 이 셋에서 파생한다 */
  budgetNetMinor?: bigint | null
  quotedNetMinor?: bigint | null
  contractNetMinor?: bigint | null
  businessType?: string | null
  termType?: string | null
  startDate?: Date | null
  endDate?: Date | null
  /** 단계 이동에서만 채워진다 — 막지는 않았지만 사람이 알아야 하는 것 */
  entryWarnings?: { key: string; message: string }[]
}

const SELECT = {
  id: true, companyId: true, pipelineId: true, stageId: true, name: true, status: true,
  amountMinor: true, currency: true, expectedCloseDate: true, wonAt: true, lostReason: true,
  ownerId: true, version: true, updatedAt: true,
  // 장부의 세 금액 — 화면이 보는 「금액」은 이 셋에서 나온다(아래 withBooked)
  budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true,
  businessType: true, termType: true, startDate: true, endDate: true, endDateUnknown: true,
} as const

/**
 * 화면이 보는 「금액」을 **수주 매출로 통일한다.**
 *
 * **왜**: 딜 금액이 보이는 자리가 일곱이다(속성·보드·표·리포트·예측·검색·알림).
 * 전부 `amountMinor` 를 보는데 그 칸은 이관 중이라, 새 3금액만 채운 딜은
 * 보드에서 금액이 통째로 사라지고 상세에서는 「금액 —」과 「수주 매출 20억」이
 * **같은 화면에서 서로를 반박한다**(실브라우저에서 잡았다).
 *
 * 읽기에서 한 번 파생하면 일곱 자리가 한꺼번에 맞는다.
 * 쓰기는 건드리지 않는다 — 이관이 끝나면 이 함수만 지우면 된다.
 */
function withBooked<T extends {
  amountMinor?: bigint | null
  budgetNetMinor?: bigint | null
  quotedNetMinor?: bigint | null
  contractNetMinor?: bigint | null
}>(row: T): T {
  const picked = pickBooked(row)
  return picked.from === 'none' ? row : { ...row, amountMinor: picked.minor }
}

export interface DealInput {
  companyId: string
  pipelineId: string
  stageId: string
  name: string
  amountMinor?: string | number | null
  currency?: string | null
  expectedCloseDate?: string | null
  ownerId?: string | null
  /** 무엇을 파는 일인가 — 유형마다 원가 구조도 계약 형태도 다르다 */
  businessType?: string | null
  /** 사업 기간 — 장기를 고르면 연차 구분이 열린다 */
  termType?: string | null
  startDate?: string | null
  endDate?: string | null
  /** 종료일을 정할 수 없는 사업(크레딧 소진 시까지 등) */
  endDateUnknown?: boolean
}

/**
 * 금액은 문자열로 받는다 — JSON 은 BigInt 를 못 싣고, number 로 받으면
 * 2^53 을 넘는 금액에서 조용히 값이 틀어진다. 원 단위 큰 계약이면 실제로 넘는다.
 */
function toAmountMinor(v: string | number | null | undefined): bigint | null {
  if (v === null || v === undefined || v === '') return null
  try {
    const b = BigInt(typeof v === 'number' ? Math.round(v) : String(v).trim())
    if (b < BigInt(0)) throw new Error('negative')
    return b
  } catch {
    throw new CrmError('VALIDATION_FAILED', '금액은 0 이상의 정수여야 합니다.', { field: 'amountMinor' })
  }
}

/** 목록 밖 값은 거부한다 — 빈 값은 «안 정했다»는 뜻이라 허용한다 */
function pickEnum<T extends string>(
  v: string | null | undefined, allowed: readonly T[], label: string,
): T | null {
  if (v === null || v === undefined || v === '') return null
  if ((allowed as readonly string[]).includes(v)) return v as T
  throw new CrmError('VALIDATION_FAILED', `${label}을 목록에서 골라 주세요.`)
}

function normalizeInput(input: Partial<DealInput>, requireName: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (requireName || input.name !== undefined) {
    const name = requireText(input.name)
    if (!name) throw new CrmError('VALIDATION_FAILED', '딜 이름을 입력해 주세요.', { field: 'name' })
    out.name = name
  }
  if (input.companyId !== undefined) out.companyId = input.companyId
  if (input.pipelineId !== undefined) out.pipelineId = input.pipelineId
  if (input.stageId !== undefined) out.stageId = input.stageId
  if (input.amountMinor !== undefined) out.amountMinor = toAmountMinor(input.amountMinor)
  if (input.currency !== undefined) out.currency = normalizeText(input.currency)?.toUpperCase() ?? null
  if (input.expectedCloseDate !== undefined) {
    out.expectedCloseDate = input.expectedCloseDate ? new Date(input.expectedCloseDate) : null
  }
  if (input.ownerId !== undefined) out.ownerId = input.ownerId || null

  // 목록에 없는 값은 조용히 받지 않는다 — 오타가 유형이 되면 집계가 통째로 흐려진다
  if (input.businessType !== undefined) {
    out.businessType = pickEnum(input.businessType, BUSINESS_TYPE_ORDER, '사업 유형')
  }
  if (input.termType !== undefined) {
    out.termType = pickEnum(input.termType, TERM_TYPE_ORDER, '사업 기간')
  }
  if (input.startDate !== undefined) out.startDate = input.startDate ? new Date(input.startDate) : null
  if (input.endDate !== undefined) out.endDate = input.endDate ? new Date(input.endDate) : null
  // 「정할 수 없다」와 「아직 안 적었다」는 다르다 — 크레딧 사업은 소진될 때까지가 기간이다
  if (input.endDateUnknown !== undefined) out.endDateUnknown = Boolean(input.endDateUnknown)

  const s = out.startDate as Date | null | undefined
  const e = out.endDate as Date | null | undefined
  if (s && e && e.getTime() < s.getTime()) {
    throw new CrmError('VALIDATION_FAILED', '종료일이 시작일보다 앞섭니다.', { field: 'endDate' })
  }

  // 기간이 둘 다 있으면 개월 수는 **계산이다** — 손으로 넣지 않는다
  if (s && e) out.termMonths = monthSpan(s, e)
  else if (input.startDate !== undefined || input.endDate !== undefined) out.termMonths = null

  return out
}

export interface ListDealInput extends CursorInput {
  /** 휴지통만 본다 — 가드의 기본 필터를 일부러 뒤집는다 */
  trash?: boolean
  q?: string | null
  pipelineId?: string | null
  companyId?: string | null
  /** 보드는 열린 딜만 본다 */
  status?: string | null
}

/**
 * 목록의 **금액 합계** — 통화별로.
 *
 * **왜 서버에서 세나**: 목록은 페이지로 끊어 오므로 화면에서 더하면
 * «지금 보이는 20건»의 합이 된다. 그런데 사람은 그걸 «전체 합계»로 읽는다.
 * 그 오차는 조용하고, 발견되면 그 뒤로 어떤 숫자도 안 믿게 된다.
 *
 * **통화를 섞지 않는다**(report.ts 와 같은 규칙). 1,200 USD 와 1,200,000원을
 * 더한 숫자는 아무 뜻이 없다 — 통화마다 따로 준다.
 *
 * **금액 미정은 세지 않고 «몇 건인지»를 말한다.** 0으로 치면 합계가 실제보다 작아지고,
 * 화면은 그 사실을 숨긴다.
 */
export interface DealSums {
  /** 통화 → 수주 총액 합계(문자열 — BigInt 는 JSON 에 못 싣는다) */
  byCurrency: Record<string, string>
  /** 합계에 든 딜 수 */
  countedDeals: number
  /** 금액이 없어 합계에서 빠진 딜 수 */
  unpricedDeals: number
}

export async function sumDeals(db: CrmDb, input: ListDealInput = {}): Promise<DealSums> {
  const where = listDealsWhere(input)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmDeal.findMany({
    where,
    select: {
      currency: true, amountMinor: true,
      budgetNetMinor: true, quotedNetMinor: true, contractNetMinor: true,
    },
    // 합계는 상한을 두지 않는다 — 「앞의 200건만 더한 합계」는 틀린 합계다.
    // 딜이 수만 건이 되면 그때 집계 쿼리로 옮긴다(지금은 백 단위)
  }) as { currency: string | null; amountMinor: bigint | null;
          budgetNetMinor: bigint | null; quotedNetMinor: bigint | null; contractNetMinor: bigint | null }[]

  const byCurrency: Record<string, bigint> = {}
  let counted = 0
  let unpriced = 0

  for (const r of rows) {
    // 「수주 총액」은 계약 > 견적 > 예산 순으로 가장 확실한 것 — 화면과 같은 SSOT 를 쓴다
    const booked = pickBooked(r)
    if (booked.minor === null) { unpriced += 1; continue }
    const cur = (r.currency ?? 'KRW').toUpperCase()
    byCurrency[cur] = (byCurrency[cur] ?? BigInt(0)) + booked.minor
    counted += 1
  }

  return {
    byCurrency: Object.fromEntries(Object.entries(byCurrency).map(([k, v]) => [k, v.toString()])),
    countedDeals: counted,
    unpricedDeals: unpriced,
  }
}

/** 목록과 합계가 **같은 조건**을 본다 — 따로 적으면 둘이 어긋나고 합계가 틀린다 */
function listDealsWhere(input: ListDealInput): Record<string, unknown> {
  const q = normalizeText(input.q)
  const where: Record<string, unknown> = {}
  if (input.trash) where.deletedAt = { not: null }
  if (input.pipelineId) where.pipelineId = input.pipelineId
  if (input.companyId) where.companyId = input.companyId
  if (input.status) where.status = input.status
  if (q) where.name = { contains: q, mode: 'insensitive' }
  return where
}

export async function listDeals(db: CrmDb, input: ListDealInput = {}): Promise<CursorPage<DealRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const where = listDealsWhere(input)

  const cur = cursorWhere(decoded)
  const finalWhere = cur ? { AND: [where, cur] } : where

  const [rows, total, members] = await Promise.all([
    /*
      **회사 이름을 조인으로 가져온다.**
      표에 회사가 안 보여서 사용자가 딜 이름만 보고 어느 회사 건인지 짐작해야 했다
      (사용자 지적: 「여기도 표시 할건 다 표시 해야지? 왜 다 생략되었지?」).
      행마다 따로 읽으면 N+1 이라 여기서 한 번에 받는다.
    */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmDeal.findMany({
      where: finalWhere,
      select: { ...SELECT, company: { select: { name: true } } },
      orderBy: CURSOR_ORDER, take: limit + 1,
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countIfFirstPage((db as any).crmDeal, where, decoded),
    /*
      담당자 이름은 **멤버 표를 통째로 한 번** 읽어 맞춘다.
      팀은 수십 명이라 전부 읽어도 싸고, 딜마다 조인하는 것보다 가볍다.
    */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmMember.findMany({ select: { id: true, displayName: true } }) as Promise<{ id: string; displayName: string }[]>,
  ])

  const nameOf = new Map(members.map((m) => [m.id, m.displayName]))
  const withNames = (rows as (DealRow & { company?: { name: string } | null })[]).map((r) => {
    const { company, ...rest } = r
    return {
      ...rest,
      companyName: company?.name ?? null,
      ownerName: r.ownerId ? nameOf.get(r.ownerId) ?? null : null,
    }
  })
  return toPage(withNames as DealRow[], limit, total)
}

export async function getDeal(db: CrmDb, id: string): Promise<DealRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).crmDeal.findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')
  return row as DealRow
}

/** 스테이지가 그 파이프라인 소속인지 (DI-05). DB 복합 FK 가 최종 방어선이지만, 먼저 사람 말로 알려 준다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function assertStageBelongs(tx: any, pipelineId: string, stageId: string): Promise<void> {
  const stage = await tx.crmStage.findFirst({ where: { id: stageId }, select: { pipelineId: true } })
  if (!stage) throw new CrmError('VALIDATION_FAILED', '단계를 찾을 수 없습니다.', { field: 'stageId' })
  if (stage.pipelineId !== pipelineId) {
    throw new CrmError('VALIDATION_FAILED',
      '그 단계는 선택한 파이프라인에 속하지 않습니다.', { field: 'stageId' })
  }
}

export async function createDeal(
  workspaceId: string,
  actorId: string | null,
  input: DealInput,
): Promise<DealRow> {
  const data = normalizeInput(input, true)

  return withCrmTx(workspaceId, async (tx) => {
    await assertStageBelongs(tx, input.pipelineId, input.stageId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmDeal.create({ data, select: SELECT })

    // 첫 진입도 이동이다 — 이 기록이 없으면 "언제 이 단계에 들어왔나"를 알 수 없다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmStageHistory.create({
      data: toStageHistoryData({
        dealId: created.id, fromStageId: null, toStageId: input.stageId,
        movedById: actorId, movedAt: new Date(), prevMovedAt: null,
      }),
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal.created',
      targetType: 'deal', targetId: created.id, afterJson: serialize(created),
    })
    return created as DealRow
  })
}

export interface UpdateDealInput extends Partial<DealInput> {
  version: number
}

export async function updateDeal(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: UpdateDealInput,
): Promise<DealRow> {
  const { version, ...rest } = input
  const data = normalizeInput(rest, false)

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    if (before && rest.stageId && rest.stageId !== before.stageId) {
      throw new CrmError('VALIDATION_FAILED',
        '단계 이동은 전용 경로로 해 주세요. 이동 이력이 함께 남아야 합니다.', { field: 'stageId' })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDeal.updateMany({
      where: lockWhere(id, version), data: { ...data, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: Boolean(before), version: before?.version }, '딜')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal.updated', targetType: 'deal', targetId: id,
      beforeJson: serialize(before), afterJson: serialize(after),
    })
    return after as DealRow
  })
}


/**
 * 단계 진입 조건을 판정한다.
 *
 * **왜 여기서 하는가**: 조건을 화면에서만 검사하면 API 를 직접 부르는 경로로 새어 나가고,
 * 그러면 보드에서는 막히는데 다른 데서는 통과하는 화면이 생긴다.
 * 이동이 일어나는 **한 자리**에서 본다.
 *
 * **왜 막는 것과 알려 주는 것을 나누는가**: 영업은 순서대로 흐르지 않는다.
 * 전부 막으면 사람은 조건을 지키는 대신 CRM 을 안 쓴다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkEntryCriteria(tx: any, dealId: string, toStageId: string): Promise<CriteriaVerdict> {
  const stage = await tx.crmStage.findFirst({
    where: { id: toStageId }, select: { entryCriteriaJson: true },
  })
  const criteria = parseCriteria(stage?.entryCriteriaJson)
  if (criteria.length === 0) return { ok: true, blocking: [], warnings: [] }

  const deal = await tx.crmDeal.findFirst({
    where: { id: dealId },
    select: { amountMinor: true, expectedCloseDate: true, ownerId: true, companyId: true },
  })
  if (!deal) return { ok: true, blocking: [], warnings: [] }

  // 필요한 조건이 있을 때만 센다 — 조건에 없으면 굳이 세지 않는다
  const needContact = criteria.some((c) => c.key === 'contact')
  const needTask = criteria.some((c) => c.key === 'nextTask')
  const contactCount = needContact ? await tx.crmDealContact.count({ where: { dealId } }) : 0
  const openTaskCount = needTask
    ? await tx.crmTask.count({ where: { dealId, status: { in: ['TODO', 'DOING'] } } })
    : 0

  return evaluateCriteria(criteria, {
    amountMinor: deal.amountMinor,
    closeDate: deal.expectedCloseDate,
    ownerId: deal.ownerId,
    companyId: deal.companyId,
    contactCount,
    openTaskCount,
  })
}

export interface MoveStageInput {
  version: number
  toStageId: string
}

/**
 * 단계 이동 — 딜 갱신 + 이력이 **한 트랜잭션**이다 (DI-09).
 * 둘 중 하나만 성공하면 두 값이 서로를 반박한다.
 */
/**
 * 자동화를 돌린다.
 *
 * **절대 던지지 않는다.** 자동화가 실패했다고 딜 이동이 되돌아가면
 * 사람은 "왜 저장이 안 되지"만 겪고 원인은 알 수 없다.
 * 규칙이 없으면 조회 한 번으로 끝나므로, 안 쓰는 워크스페이스에는 비용이 없다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fireAutomations(tx: any, event: TriggerKind, dealId: string, actorId: string | null) {
  try {
    const rules = await loadRules(tx)
    if (rules.length === 0) return

    const d = await tx.crmDeal.findFirst({
      where: { id: dealId },
      select: { id: true, name: true, stageId: true, amountMinor: true, company: { select: { name: true } } },
    })
    if (!d) return

    await runAutomations(tx, {
      rules,
      event,
      deal: {
        id: d.id, name: d.name, stageId: d.stageId,
        amountMinor: d.amountMinor, companyName: d.company?.name ?? null,
      },
      actorId,
    })
  } catch {
    // 자동화는 부가 기능이다 — 실패해도 사용자 저장을 막지 않는다
  }
}

export async function moveDealStage(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: MoveStageInput,
): Promise<DealRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

    if (!isRealMove(before.stageId, input.toStageId)) {
      // 같은 자리로의 '이동'을 기록하면 체류 시간이 0 으로 잘게 쪼개진다
      return before as DealRow
    }
    await assertStageBelongs(tx, before.pipelineId, input.toStageId)

    // 진입 조건 — 막을 것만 막고, 나머지는 결과에 실어 화면이 말하게 한다
    const verdict = await checkEntryCriteria(tx, id, input.toStageId)
    const blocked = blockingMessage(verdict)
    if (blocked) {
      throw new CrmError('VALIDATION_FAILED', blocked, { field: 'stageId', missing: verdict.blocking })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDeal.updateMany({
      where: lockWhere(id, input.version), data: { stageId: input.toStageId, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: true, version: before.version }, '딜')

    // 직전 이동 시각을 찾아 체류 시간을 계산한다. 없으면 딜 생성 시각을 쓴다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prev = await (tx as any).crmStageHistory.findFirst({
      where: { dealId: id }, orderBy: { movedAt: 'desc' }, select: { movedAt: true },
    })
    const movedAt = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmStageHistory.create({
      data: toStageHistoryData({
        dealId: id, fromStageId: before.stageId, toStageId: input.toStageId,
        movedById: actorId, movedAt, prevMovedAt: prev?.movedAt ?? null,
      }),
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal.stage_moved', targetType: 'deal', targetId: id,
      beforeJson: { stageId: before.stageId }, afterJson: { stageId: input.toStageId },
    })
    // 단계를 옮긴 그 순간이 후속 작업을 만들 자리다 — 나중에 하려면 사람이 잊는다
    await fireAutomations(tx, 'deal.entered_stage', id, actorId)

    // 경고는 이동을 막지 않지만 사람이 알아야 한다 — 조용히 넘기면 조건이 없는 것과 같다
    return { ...(after as DealRow), entryWarnings: verdict.warnings }
  })
}

export interface CloseDealInput {
  version: number
  to: DealStatus
  /**
   * 함께 옮길 단계. 보드에서 성사·실주 칸에 놓으면 그 칸의 id 가 온다.
   *
   * 왜 필요한가: 상태만 바꾸고 단계를 그대로 두면 **카드가 원래 자리에 남는다.**
   * 사용자는 수주 칸으로 옮겼는데 화면은 견적·제안에 그대로다 — 실브라우저에서 잡은 결함이다.
   * 상태와 단계는 같은 사실의 두 표현이므로 함께 움직여야 한다.
   */
  toStageId?: string | null
  /** WON 이면 필수 */
  wonAt?: string | null
  amountMinor?: string | number | null
  currency?: string | null
  /** LOST·재오픈이면 필수 */
  reason?: string | null
}

/**
 * 성사·실주·재오픈 — 전이 판정은 canTransit SSOT 가 한다.
 * 화면이 같은 판정을 다시 구현하면 화면과 API 의 답이 갈린다.
 */
export async function closeDeal(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: CloseDealInput,
): Promise<DealRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    if (!before) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

    /**
     * 성사에 필요한 「금액」은 **수주 매출**이다 — 옛 `amountMinor` 칸이 아니다.
     *
     * 예전엔 이 줄이 `before.amountMinor` 만 봤다. 그래서 새 금액 모델
     * (예산·견적·계약)로만 채운 딜은 **성사로 옮길 수 없었다** — 화면은
     * 「금액이 있어야 성사로 옮길 수 있어요」라고 하는데 사용자 눈에는 금액이 **적혀 있다.**
     * DB 의 `chk_won` 도 같은 옛 칸을 요구하므로, 판정만 고치면 저장에서 다시 막힌다.
     * 그래서 **판정과 저장 둘 다** 수주 매출(pickBooked)로 맞춘다.
     */
    const amount = input.amountMinor !== undefined
      ? toAmountMinor(input.amountMinor)
      : before.amountMinor ?? (() => {
        const picked = pickBooked(before)
        return picked.from === 'none' ? null : picked.minor
      })()

    // 판정을 먼저 한다 — 통과 못 하면 아무것도 쓰지 않는다
    assertTransit('deal', before.status as DealStatus, input.to, {
      wonAt: input.wonAt ?? undefined,
      amountMinor: amount ?? undefined,
      lostReason: input.reason ?? undefined,
      reopenReason: input.reason ?? undefined,
    })

    const data: Record<string, unknown> = { status: input.to, ...BUMP_VERSION }
    if (input.to === 'WON') {
      data.wonAt = input.wonAt ? new Date(input.wonAt) : new Date()
      if (amount !== null) data.amountMinor = amount
      if (input.currency) data.currency = input.currency.toUpperCase()
      data.lostReason = null
    } else if (input.to === 'LOST') {
      data.lostReason = normalizeText(input.reason)
      data.wonAt = null
    } else {
      // 재오픈 — 성사·실주 흔적을 지운다. 사유는 감사 로그에 남는다
      data.wonAt = null
      data.lostReason = null
    }

    // 단계도 함께 옮긴다 — 상태와 단계는 같은 사실의 두 표현이다
    const moving = input.toStageId && isRealMove(before.stageId, input.toStageId)
    if (moving && input.toStageId) {
      await assertStageBelongs(tx, before.pipelineId, input.toStageId)
      data.stageId = input.toStageId
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDeal.updateMany({ where: lockWhere(id, input.version), data })
    assertUpdated(res.count, { exists: true, version: before.version }, '딜')

    // 이동했으면 이력도 같은 트랜잭션에 남긴다(DI-09)
    if (moving && input.toStageId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prev = await (tx as any).crmStageHistory.findFirst({
        where: { dealId: id }, orderBy: { movedAt: 'desc' }, select: { movedAt: true },
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmStageHistory.create({
        data: toStageHistoryData({
          dealId: id, fromStageId: before.stageId, toStageId: input.toStageId,
          movedById: actorId, movedAt: new Date(), prevMovedAt: prev?.movedAt ?? null,
        }),
      })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: input.to === 'WON' ? 'deal.won' : input.to === 'LOST' ? 'deal.lost' : 'deal.reopened',
      targetType: 'deal', targetId: id,
      beforeJson: { status: before.status },
      afterJson: { status: input.to, reason: input.reason ?? null },
    })

    // 성사·실패 뒤에도 할 일이 남는다(계약서 보내기·실패 이유 공유). 재오픈은 아직 규칙이 없다
    if (input.to === 'WON') await fireAutomations(tx, 'deal.won', id, actorId)
    else if (input.to === 'LOST') await fireAutomations(tx, 'deal.lost', id, actorId)

    return after as DealRow
  })
}

export async function deleteDeal(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmDeal.findFirst({
      where: mode === 'purge' ? { id, deletedAt: { not: undefined } } : { id }, select: SELECT,
    })
    if (!before) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')

    if (mode === 'trash') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (tx as any).crmDeal.updateMany({
        where: { id }, data: { deletedAt: new Date(), ...BUMP_VERSION },
      })
      assertUpdated(res.count, { exists: true, version: before.version }, '딜')
    } else {
      await tx.crmAiSuggestion.deleteMany({ where: { targetType: 'deal', targetId: id } })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmDeal.deleteMany({ where: { id } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: plan.auditAction,
      targetType: 'deal', targetId: id, beforeJson: serialize(before),
    })
  })
}

/** BigInt 는 JSON 으로 직렬화되지 않는다 — 감사 로그에 넣기 전에 문자열로 바꾼다 */
function serialize(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = typeof v === 'bigint' ? v.toString() : v
  return out
}

/** 화면으로 나갈 때도 BigInt 를 문자열로 (JSON.stringify 가 던진다) */
/**
 * 화면으로 나가는 모양.
 *
 * **여기가 유일한 JSON 경계다** — 목록·상세·생성·수정이 전부 이걸 거친다.
 * 그래서 「금액」 파생도 여기 한 곳에서 한다(withBooked).
 */
export function toDealJson(row: DealRow): Record<string, unknown> {
  const r = withBooked(row)
  return {
    ...r,
    amountMinor: r.amountMinor === null || r.amountMinor === undefined ? null : r.amountMinor.toString(),
    budgetNetMinor: bigOrNull(r.budgetNetMinor),
    quotedNetMinor: bigOrNull(r.quotedNetMinor),
    contractNetMinor: bigOrNull(r.contractNetMinor),
    /** 「금액」이 어느 칸에서 왔나 — 화면이 근거를 밝힐 수 있게 */
    bookedFrom: pickBooked(r).from,
  }
}

function bigOrNull(v: bigint | null | undefined): string | null {
  return v === null || v === undefined ? null : v.toString()
}

export interface StageHistoryRow {
  id: string
  fromStageId: string | null
  toStageId: string | null
  movedById: string | null
  movedAt: Date
  durationSec: number | null
}

/**
 * 단계 이동 이력 (오래된 것부터).
 *
 * 왜 오름차순인가: 이건 활동 피드가 아니라 **경로**다.
 * "리드 → PoC → 수주"를 위에서 아래로 읽어야 흐름이 보인다.
 */
export async function listStageHistory(db: CrmDb, dealId: string): Promise<StageHistoryRow[]> {
  // 딜이 없거나 남의 워크스페이스면 여기서 막힌다 — 이력만 새어 나가면 안 된다(DI-01)
  await getDeal(db, dealId)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmStageHistory.findMany({
    where: { dealId },
    orderBy: { movedAt: 'asc' },
    select: {
      id: true, fromStageId: true, toStageId: true,
      movedById: true, movedAt: true, durationSec: true,
    },
  })
}

/** 휴지통에서 되살린다 */
export async function restoreDeal(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<DealRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDeal.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, ...BUMP_VERSION },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '휴지통에서 딜을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmDeal.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal.restored',
      targetType: 'deal', targetId: id, afterJson: serialize(after),
    })
    return after as DealRow
  })
}
