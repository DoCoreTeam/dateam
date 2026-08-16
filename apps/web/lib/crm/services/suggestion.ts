/**
 * 제안 서비스 — AI 가 코어 데이터에 닿는 유일한 관문 (dacrm T1-06, 구현명세 §3.3)
 *
 * 이 파일이 CLAUDE_dacrm 절대규칙 1 의 실행부다: **AI 출력은 코어 테이블에 직접 쓰지 않는다.**
 * 추출 결과는 전부 제안이 되고, 제안은 둘 중 하나로만 데이터가 된다 —
 * 사람이 수락하거나, apply-policy 가 자동 반영을 허락하거나.
 *
 * 수락 처리에서 지키는 것(DI-12, 명세 3.3):
 *   1. 제안이 PENDING 이고 만료 전인가 — 지난 제안이 오늘 반영되면 그 사이 바뀐 값을 덮는다
 *   2. 대상 레코드의 version 확인(낙관적 잠금) — 그 사이 사람이 고쳤으면 멈춘다
 *   3. 사람이 고친 값(editedValue)이 있으면 그 값이 이긴다
 *   4. 필드 단위 출처를 감사에 남긴다 { value, source, runId, confidence }
 *   5. 제안을 ACCEPTED 로 전이
 *   6. audit_log 에 suggestion.accepted
 * 하나라도 실패하면 전부 롤백한다. 절반만 반영되면 화면과 기록이 서로를 반박한다.
 */

import type { CrmDb } from '../db/client.ts'
import { getCrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { assertTransit, type SuggestionStatus } from '../domain/state-machines.ts'
import { decideApply, NEVER_AUTO_APPLY_FIELDS, type ApplyVerdict } from '../ai/apply-policy.ts'
import { clampLimit } from '../db/cursor.ts'
import { kstDateOnlyToIso } from '../../datetime/kst.ts'

/**
 * 5축 (스키마 CrmSuggestionAxis 와 같아야 한다).
 *
 * 처음에 WHO/WHAT/WHEN/WHY/HOW 로 적었다가 DB 가 거절했다 —
 * 실제 축은 WHERE(어디까지 왔나)·RISK(무엇이 막나)·NEXT(다음에 뭘 하나)다.
 * 일반적인 육하원칙이 아니라 **영업 대화에서 뽑아야 하는 것**으로 정해진 축이다.
 */
export type SuggestionAxis = 'WHO' | 'WHAT' | 'WHERE' | 'RISK' | 'NEXT'

/** 제안이 건드릴 수 있는 대상 — 여기 없는 것은 반영 경로가 없다 */
const APPLIABLE: Record<string, string> = {
  company: 'crmCompany',
  person: 'crmPerson',
  deal: 'crmDeal',
}

/** 제안 유효기간 (명세 3.4 "EXPIRED(7일)") */
export const SUGGESTION_TTL_DAYS = 7

export interface SuggestionRow {
  id: string
  runId: string
  axis: string
  targetType: string
  targetId: string | null
  field: string | null
  currentValueJson: unknown
  proposedValueJson: unknown
  confidence: number
  evidenceJson: unknown
  status: string
  decidedById: string | null
  decidedAt: Date | null
  expiresAt: Date
  createdAt: Date
}

const SELECT = {
  id: true, runId: true, axis: true, targetType: true, targetId: true, field: true,
  currentValueJson: true, proposedValueJson: true, confidence: true, evidenceJson: true,
  status: true, decidedById: true, decidedAt: true, expiresAt: true, createdAt: true,
} as const

export interface SuggestionInput {
  runId: string
  axis: SuggestionAxis
  targetType: string
  targetId?: string | null
  field?: string | null
  currentValue?: unknown
  proposedValue: unknown
  confidence: number
  /** 근거는 필수다 — 근거 없는 제안은 사용자가 판단할 수 없다(스키마 evidenceJson) */
  evidence: { quote?: string; segmentIds?: string[] }
}

export interface CreateSuggestionResult {
  /** 저장된 제안. DISCARD 판정이면 null */
  suggestion: SuggestionRow | null
  verdict: ApplyVerdict
}

function expiryFrom(now: Date): Date {
  const d = new Date(now.getTime())
  d.setUTCDate(d.getUTCDate() + SUGGESTION_TTL_DAYS)
  return d
}

/** 레코드의 verifiedFields (사람이 확정한 필드 — AI 자동 반영 금지 대상) */
async function verifiedFieldsOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any, targetType: string, targetId: string | null,
): Promise<string[]> {
  if (!targetId) return []
  const model = APPLIABLE[targetType]
  if (!model) return []
  const row = await tx[model].findFirst({ where: { id: targetId }, select: { verifiedFields: true } })
  const v = row?.verifiedFields
  return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : []
}

/**
 * 제안을 만든다. 판정 결과에 따라 저장·자동반영·폐기가 갈린다.
 *
 * 자동 반영도 **여기서 같은 트랜잭션으로** 한다 —
 * 제안만 AUTO_APPLIED 로 두고 값은 나중에 쓰면, 그 사이에 화면이 거짓을 보여 준다.
 */
export async function createSuggestion(
  workspaceId: string,
  actorId: string | null,
  input: SuggestionInput,
): Promise<CreateSuggestionResult> {
  if (input.confidence < 0 || input.confidence > 1 || !Number.isFinite(input.confidence)) {
    throw new CrmError('VALIDATION_FAILED', '신뢰도는 0과 1 사이여야 합니다.', { field: 'confidence' })
  }
  if (!input.evidence || (!input.evidence.quote && !(input.evidence.segmentIds?.length))) {
    // 근거 없는 제안은 사용자가 수락 여부를 판단할 수 없다 — 그건 제안이 아니라 강요다
    throw new CrmError('VALIDATION_FAILED', '제안에는 근거가 필요합니다.', { field: 'evidence' })
  }

  return withCrmTx(workspaceId, async (tx) => {
    const verified = await verifiedFieldsOf(tx, input.targetType, input.targetId ?? null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg = await (tx as any).crmAiFieldConfig.findFirst({
      where: { targetType: input.targetType, field: input.field ?? '' },
      select: { autoApply: true, minConfidence: true },
    })

    const verdict = decideApply({
      confidence: input.confidence,
      field: input.field,
      targetType: input.targetType,
      isNewRecord: !input.targetId,
      autoApply: cfg?.autoApply ?? false,
      minConfidence: cfg?.minConfidence ?? undefined,
      verifiedFields: verified,
    })

    // 4.3-3행: 신뢰도 미달은 저장조차 하지 않는다 — 인박스가 쓰레기로 차면 아무도 안 본다
    if (verdict.decision === 'DISCARD') return { suggestion: null, verdict }

    const now = new Date()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmAiSuggestion.create({
      data: {
        runId: input.runId, axis: input.axis,
        targetType: input.targetType, targetId: input.targetId ?? null,
        field: input.field ?? null,
        currentValueJson: (input.currentValue ?? null) as never,
        proposedValueJson: input.proposedValue as never,
        confidence: input.confidence,
        evidenceJson: input.evidence as never,
        status: verdict.decision === 'AUTO_APPLIED' ? 'AUTO_APPLIED' : 'PENDING',
        decidedAt: verdict.decision === 'AUTO_APPLIED' ? now : null,
        expiresAt: expiryFrom(now),
      },
      select: SELECT,
    })

    if (verdict.decision === 'AUTO_APPLIED') {
      await applyToRecord(tx, {
        targetType: input.targetType, targetId: input.targetId!, field: input.field!,
        value: input.proposedValue, runId: input.runId,
        confidence: input.confidence, actorId, suggestionId: created.id,
        auto: true,
      })
    }

    return { suggestion: created as SuggestionRow, verdict }
  })
}

interface ApplyArgs {
  targetType: string
  targetId: string
  field: string
  value: unknown
  runId: string
  confidence: number
  actorId: string | null
  suggestionId: string
  auto: boolean
  /** 낙관적 잠금 — 사람이 수락할 때 화면이 들고 있던 버전 */
  version?: number
}

/**
 * 레코드에 값을 쓴다. 제안 경로에서만 호출된다.
 *
 * 필드 단위 출처를 감사에 남기는 이유(명세 3.3-4): 나중에 그 값이 틀렸을 때
 * "사람이 넣었나 AI 가 넣었나 · 어느 실행에서 · 얼마나 확신했나"를 답할 수 있어야 한다.
 * 레코드에는 값만 남으므로 그 맥락은 감사에만 있다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyToRecord(tx: any, args: ApplyArgs): Promise<void> {
  const model = APPLIABLE[args.targetType]
  if (!model) {
    throw new CrmError('VALIDATION_FAILED', '이 대상에는 반영할 수 없습니다.', { field: 'targetType' })
  }
  // 규칙 3(코드 하드코딩): 금액·단계·성사 여부는 어떤 경로로도 AI 가 자동으로 못 바꾼다.
  // 사람이 수락하는 경우에도 이 필드들은 전용 화면(딜 보드·성사 모달)을 거쳐야 한다 —
  // 거기서만 함께 바뀌어야 하는 값(성사일·이력)이 같이 처리되기 때문이다.
  if (NEVER_AUTO_APPLY_FIELDS.has(args.field)) {
    throw new CrmError('VALIDATION_FAILED',
      '금액·단계·성사 여부는 딜 화면에서 직접 바꿔 주세요. 함께 남아야 하는 기록이 있습니다.',
      { field: args.field })
  }

  const before = await tx[model].findFirst({ where: { id: args.targetId } })
  if (!before) throw new CrmError('NOT_FOUND', '반영할 대상을 찾을 수 없습니다.')

  // 사람이 수락할 때만 버전을 본다 — 자동 반영은 사람이 화면을 보고 있지 않다
  const where = args.version === undefined
    ? { id: args.targetId }
    : { id: args.targetId, version: args.version }

  const res = await tx[model].updateMany({
    where, data: { [args.field]: args.value, version: { increment: 1 } },
  })
  if (res.count === 0) {
    throw new CrmError('CONFLICT',
      '그 사이 다른 사람이 이 값을 바꿨습니다. 새로고침 후 다시 확인해 주세요.',
      { currentVersion: before.version })
  }

  await writeAudit(tx, {
    actorType: 'AI', actorId: args.actorId,
    action: args.auto ? 'suggestion.auto_applied' : 'suggestion.accepted',
    targetType: args.targetType, targetId: args.targetId,
    beforeJson: { [args.field]: before[args.field] },
    // 필드 단위 출처(명세 3.3-4)
    afterJson: {
      [args.field]: {
        value: args.value, source: 'ai',
        runId: args.runId, confidence: args.confidence,
        suggestionId: args.suggestionId,
      },
    },
  })
}


/**
 * 새 레코드를 만드는 제안을 수락한다.
 *
 * **왜 필요한가**: 미팅에서 "박보안 팀장이 반대한다"를 뽑아 놓고 등록을 못 하면,
 * 사람은 그걸 다시 손으로 옮겨 적는다. 그러면 AI 가 읽어낸 의미가 없다.
 * 예전에는 여기서 "아직 수락할 수 없습니다"로 막혀 있었다 — 인박스 절반이 죽어 있었다.
 *
 * **절대규칙과의 관계**: AI 출력이 코어 테이블에 직접 쓰는 것이 금지된 것이지,
 * **사람이 보고 승인한 값**을 쓰는 것은 인박스의 존재 이유다.
 * 그래서 `source: 'AI'` 와 `sourceSuggestionId` 를 남겨 나중에 출처를 답할 수 있게 한다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createFromSuggestion(tx: any, args: {
  actorId: string | null
  suggestion: { id: string; axis: string; targetType: string; proposedValueJson: unknown; runId: string; confidence: number }
}): Promise<{ targetType: string; targetId: string }> {
  const { suggestion: s, actorId } = args
  const v = (s.proposedValueJson ?? {}) as Record<string, unknown>

  if (s.targetType === 'person') {
    const name = typeof v.name === 'string' ? v.name.trim() : ''
    if (!name) {
      throw new CrmError('VALIDATION_FAILED', '이름이 없는 인물은 만들 수 없습니다.')
    }
    const companyId = typeof v.companyId === 'string' ? v.companyId : null

    // 같은 회사에 같은 이름이 이미 있으면 그걸 쓴다 — 미팅마다 같은 사람을 또 만들면 안 된다
    const dup = await tx.crmPerson.findFirst({
      where: { name, ...(companyId ? { companyId } : {}) },
      select: { id: true },
    })
    if (dup) return { targetType: 'person', targetId: dup.id }

    const created = await tx.crmPerson.create({
      data: {
        name, companyId,
        title: typeof v.title === 'string' ? v.title : null,
        email: typeof v.email === 'string' ? v.email.toLowerCase() : null,
        source: 'AI',
      },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'person.created_from_suggestion',
      targetType: 'person', targetId: created.id,
      beforeJson: null,
      afterJson: { name, source: 'ai', runId: s.runId, confidence: s.confidence, suggestionId: s.id },
    })
    return { targetType: 'person', targetId: created.id }
  }

  // NEXT — 다음에 할 일. 미팅에 붙어 있던 "읽을 거리"를 사람이 승인하면 진짜 할 일이 된다
  if (s.axis === 'NEXT') {
    const title = typeof v.title === 'string' ? v.title.trim() : ''
    if (!title) throw new CrmError('VALIDATION_FAILED', '할 일 제목이 없습니다.')

    // dueDate 는 KST 날짜다 — naive 로 저장하면 하루가 밀린다(datetime SSOT)
    const dueAt = typeof v.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.dueDate)
      ? new Date(kstDateOnlyToIso(v.dueDate))
      : null

    const created = await tx.crmTask.create({
      data: { title, dueAt, sourceSuggestionId: s.id, createdById: actorId },
      select: { id: true },
    })
    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'task.created_from_suggestion',
      targetType: 'task', targetId: created.id,
      beforeJson: null,
      afterJson: { title, dueAt, source: 'ai', runId: s.runId, suggestionId: s.id },
    })
    return { targetType: 'task', targetId: created.id }
  }

  // RISK 는 값이 아니라 읽을 거리다 — 만들 레코드가 없다.
  // 수락은 "봤다"는 뜻이고, 기록은 제안 자체에 남는다.
  if (s.axis === 'RISK') return { targetType: 'meeting', targetId: '' }

  throw new CrmError('VALIDATION_FAILED', '이 제안은 아직 여기서 수락할 수 없습니다.')
}

export interface ListSuggestionInput {
  limit?: number | null
  status?: string | null
  targetType?: string | null
  targetId?: string | null
}

/**
 * 인박스 목록.
 *
 * 만료된 것은 PENDING 으로 보이지 않게 한다 — 목록에서 걸러 준다.
 * 상태를 EXPIRED 로 바꾸는 것은 배치의 몫이고, 화면은 지금 사실을 보여 줘야 한다.
 */
export async function listSuggestions(db: CrmDb, input: ListSuggestionInput = {}) {
  const limit = clampLimit(input.limit ?? undefined)
  const where: Record<string, unknown> = {}
  const status = input.status ?? 'PENDING'
  if (status !== 'ALL') where.status = status
  if (status === 'PENDING') where.expiresAt = { gt: new Date() }
  if (input.targetType) where.targetType = input.targetType
  if (input.targetId) where.targetId = input.targetId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAiSuggestion.findMany({
    where, select: SELECT,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  }) as SuggestionRow[]

  const hasMore = rows.length > limit
  return { items: hasMore ? rows.slice(0, limit) : rows, hasMore }
}

export type Decision = 'accept' | 'reject'

export interface DecideInput {
  decision: Decision
  /** 사람이 고친 값 — 있으면 이 값이 제안값을 이긴다(명세 3.3-3) */
  editedValue?: unknown
  /** 거절 사유(부정확·중복·불필요) — 나중에 프롬프트를 고치는 재료다 */
  reason?: string | null
  /** 대상 레코드의 version — 화면이 들고 있던 값 */
  version?: number
}

export async function decideSuggestion(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: DecideInput,
): Promise<SuggestionRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = await (tx as any).crmAiSuggestion.findFirst({ where: { id }, select: SELECT })
    if (!s) throw new CrmError('NOT_FOUND', '제안을 찾을 수 없습니다.')

    const next: SuggestionStatus = input.decision === 'accept' ? 'ACCEPTED' : 'REJECTED'
    // 만료 판정도 전이 규칙이 한다 — 화면·서비스가 각자 판정하면 답이 갈린다
    assertTransit('suggestion', s.status as SuggestionStatus, next, { expiresAt: s.expiresAt })

    const now = new Date()

    if (input.decision === 'accept') {
      if (!s.targetId || !s.field) {
        // 필드 갱신이 아니라 **새로 만드는** 제안이다 — 인물·할 일이 여기서 생긴다
        await createFromSuggestion(tx, { actorId, suggestion: s })
      } else {
        const value = input.editedValue !== undefined ? input.editedValue : s.proposedValueJson
        await applyToRecord(tx, {
          targetType: s.targetType, targetId: s.targetId, field: s.field,
          value, runId: s.runId, confidence: s.confidence,
          actorId, suggestionId: s.id, auto: false, version: input.version,
        })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmAiSuggestion.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: next, decidedById: actorId, decidedAt: now,
        // 사람이 고쳐서 수락했으면 그 값도 남긴다(명세 3.3-5)
        ...(input.editedValue !== undefined ? { proposedValueJson: input.editedValue as never } : {}),
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmAiSuggestion.findFirst({ where: { id }, select: SELECT })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId,
      action: input.decision === 'accept' ? 'suggestion.accepted' : 'suggestion.rejected',
      targetType: 'suggestion', targetId: id,
      beforeJson: { status: s.status },
      afterJson: { status: next, reason: input.reason ?? null },
    })

    return after as SuggestionRow
  })
}

/**
 * 만료 처리 — 배치가 부른다.
 *
 * 지난 제안을 그대로 두면 인박스가 옛 사실로 차고, 어느 날 누가 그걸 수락한다.
 * 그때 반영되는 값은 이미 몇 주 전 회의에서 나온 값이다.
 */
export async function expireSuggestions(workspaceId: string, now: Date = new Date()): Promise<number> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmAiSuggestion.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: now } },
      data: { status: 'EXPIRED', decidedAt: now },
    })
    return res.count as number
  })
}

/**
 * 인박스에 몇 건이 기다리나 — 메뉴 뱃지용.
 *
 * 만료된 것은 세지 않는다. 목록에서 안 보이는데 뱃지에만 남으면
 * 사용자는 "3건 있다"는 말을 믿고 들어갔다가 빈 화면을 본다.
 * 그 뒤로는 뱃지를 안 믿게 되고, 뱃지가 없는 것과 같아진다.
 */
export async function countPendingSuggestions(workspaceId: string): Promise<number> {
  try {
    const db = getCrmDb(workspaceId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await (db as any).crmAiSuggestion.count({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
    })
  } catch {
    // 셀 수 없으면 뱃지를 안 다는 것으로 끝낸다 — 메뉴가 못 그려지면 안 된다
    return 0
  }
}
