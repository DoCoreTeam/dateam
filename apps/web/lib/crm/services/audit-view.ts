// 기록 보기 (dacrm)
//
// **왜 필요한가**: 이 시스템은 AI 가 값을 바꾼다. 명세 3.3-4 가 필드 단위 출처를
// 감사에 남기라고 못 박은 이유는 하나다 — 나중에 그 값이 틀렸을 때
// "사람이 넣었나 AI 가 넣었나, 어느 실행에서, 얼마나 확신했나"에 답하기 위해서다.
//
// 그런데 1,364건이 쌓이는 동안 **그걸 볼 화면이 없었다.**
// 답할 수 없는 기록은 안 남긴 것과 같다.
//
// 이 파일은 남은 기록을 사람이 읽을 문장으로 바꾼다. 판정은 하지 않는다.

import type { CrmDb } from '../db/client.ts'
import { CRITERION_LABEL, type CriterionKey } from '../domain/entry-criteria.ts'

export interface AuditRow {
  id: string
  actorType: string
  actorId: string | null
  action: string
  targetType: string
  targetId: string
  beforeJson: unknown
  afterJson: unknown
  createdAt: Date
}

export interface AuditEntry extends AuditRow {
  /** 사람이 읽는 한 줄 — "deal.stage_moved"는 개발자 말이다 */
  summary: string
  /** 누가 했나 — 이름을 못 찾으면 종류만이라도 말한다 */
  actorName: string
  /** 무엇이 달라졌나 (필드: 이전 → 이후). 없으면 빈 배열 */
  changes: { field: string; from: string; to: string }[]
}

/**
 * action 을 사람 말로.
 *
 * 여기 없는 action 도 화면에 나와야 한다 — 모르는 것을 숨기면
 * "기록에 없다"와 "우리가 이름을 안 붙였다"를 구분할 수 없다.
 */
const ACTION_LABEL: Record<string, string> = {
  'company.created': '회사를 만들었어요',
  'company.updated': '회사 정보를 바꿨어요',
  'company.restored': '회사를 되살렸어요',
  'person.created': '인물을 만들었어요',
  'person.updated': '인물 정보를 바꿨어요',
  'person.restored': '인물을 되살렸어요',
  'person.created_from_suggestion': 'AI 제안을 받아 인물을 만들었어요',
  'deal.created': '딜을 만들었어요',
  'deal.updated': '딜을 바꿨어요',
  'deal.restored': '딜을 되살렸어요',
  'deal.stage_moved': '딜 단계를 옮겼어요',
  'deal.won': '딜을 수주했어요',
  'deal.lost': '딜을 실주로 닫았어요',
  'deal.reopened': '딜을 다시 열었어요',
  'task.created': '할 일을 만들었어요',
  'task.updated': '할 일을 바꿨어요',
  'task.completed': '할 일을 끝냈어요',
  'task.restored': '할 일을 되살렸어요',
  'task.created_from_suggestion': 'AI 제안을 받아 할 일을 만들었어요',
  'activity.created': '활동을 남겼어요',
  'meeting.created': '미팅을 기록했어요',
  'meeting.deleted': '미팅을 지웠어요',
  'meeting.transcribed': '미팅 전사를 넣었어요',
  'suggestion.accepted': 'AI 제안을 반영했어요',
  'suggestion.rejected': 'AI 제안을 물렸어요',
  'suggestion.auto_applied': 'AI가 바로 반영했어요',
  'setting.updated': '설정을 바꿨어요',
  'stage.criteria_changed': '단계 진입 조건을 바꿨어요',
  'budget.limit_changed': 'AI 예산 상한을 바꿨어요',
  'ai.field_config_changed': 'AI 자동 반영 설정을 바꿨어요',
  'field.verified': '값을 확정했어요',
  'field.unverified': '값 확정을 풀었어요',
  // 소프트/영구 삭제는 도메인이 아니라 공통 action 으로 남는다 — 대상 종류가 targetType 에 있다
  'record.trashed': '휴지통으로 보냈어요',
  'record.restored': '휴지통에서 되살렸어요',
  'record.purged': '완전히 지웠어요',
  'record.merged': '중복을 합쳤어요',
  'record.merge_undone': '합친 것을 되돌렸어요',
  'integration.connected': '외부 계정을 연결했어요',
  'integration.disconnected': '연결을 해제했어요',
}

const ACTOR_LABEL: Record<string, string> = {
  HUMAN: '사람',
  AI: 'AI',
  SYSTEM: '시스템',
}

const FIELD_LABEL: Record<string, string> = {
  stageId: '단계', amountMinor: '금액', currency: '통화',
  expectedCloseDate: '마감 예정일', ownerId: '담당자', companyId: '회사',
  lostReason: '실주 사유', wonAt: '수주일', status: '상태',
  name: '이름', title: '제목', email: '이메일', phone: '전화',
  domain: '도메인', industry: '산업', region: '지역', memo: '메모',
  criteria: '진입 조건', stageName: '단계 이름', dueAt: '마감',
}

const TARGET_LABEL: Record<string, string> = {
  company: '회사', person: '인물', deal: '딜', task: '할 일',
  meeting: '미팅', suggestion: '제안', setting: '설정', stage: '단계',
  integration: '연동', person_field: '인물 항목', company_field: '회사 항목',
}

/**
 * 진입 조건은 배열 JSON 으로 저장된다.
 * `[{"key":"amount","level":"warn"}]` 을 그대로 보여 주면 사람은 못 읽는다 —
 * "금액 알려 줌"이라고 말해야 무엇이 달라졌는지 안다.
 */
function criteriaText(v: unknown): string | null {
  if (!Array.isArray(v)) return null
  if (v.length === 0) return '(조건 없음)'
  const parts: string[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const key = typeof o.key === 'string' ? CRITERION_LABEL[o.key as CriterionKey] ?? o.key : null
    if (!key) continue
    parts.push(`${key} ${o.level === 'block' ? '막음' : '알려 줌'}`)
  }
  return parts.length > 0 ? parts.join(', ') : '(조건 없음)'
}

/** 값 하나를 화면에 담길 길이로 — 원문을 통째로 뿌리면 표가 읽히지 않는다 */
function short(v: unknown): string {
  if (v === null || v === undefined) return '(없음)'
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 60) + '…' : v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = JSON.stringify(v)
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

/**
 * before/after 를 필드 단위로 접는다.
 *
 * 감사 스냅샷은 모양이 제각각이다(필드 하나만 담긴 것도, 레코드 전체도 있다).
 * 그래서 **양쪽에 있는 키를 모아** 달라진 것만 남긴다 — 모양을 가정하지 않는다.
 */
/** 지운 기록은 필드를 다 늘어놓아도 읽히지 않는다 — 무엇이었는지만 남긴다 */
const NAME_ONLY = new Set(['record.trashed', 'record.purged', 'record.restored'])

function diff(
  before: unknown,
  after: unknown,
  action?: string,
  stageName?: Map<string, string>,
): { field: string; from: string; to: string }[] {
  if (action && NAME_ONLY.has(action)) {
    const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
    const name = b.name ?? b.title
    return name ? [{ field: '무엇', from: short(name), to: '' }] : []
  }

  const b = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>
  const a = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)]))

  // id·버전은 사람이 판단하는 데 쓰이지 않는다 — 빼야 진짜 변경이 보인다
  const NOISE = new Set(['id', 'version', 'updatedAt', 'createdAt', 'workspaceId'])

  const out: { field: string; from: string; to: string }[] = []
  for (const k of keys) {
    if (NOISE.has(k)) continue
    const asName = (v: unknown): unknown => {
      if (k === 'stageId' && typeof v === 'string') return stageName?.get(v) ?? v
      if (k === 'criteria') return criteriaText(v) ?? v
      return v
    }
    const from = short(asName(b[k]))
    const to = short(asName(a[k]))
    if (from === to) continue
    out.push({ field: FIELD_LABEL[k] ?? k, from, to })
  }
  // 한 번에 다 보여 주면 표가 무너진다 — 자세한 건 상세에서 본다
  return out.slice(0, 6)
}

export interface ListAuditInput {
  limit?: number
  cursor?: string | null
  actorType?: string | null
  targetType?: string | null
  targetId?: string | null
  /** action 앞부분으로 좁히기 — 'deal' 이면 deal.* 전부 */
  domain?: string | null
}

export async function listAudit(
  db: CrmDb,
  input: ListAuditInput = {},
): Promise<{ items: AuditEntry[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200)

  const where: Record<string, unknown> = {}

  /**
   * 주소창의 값은 무엇이든 들어온다.
   *
   * enum 밖의 actorType 을 그대로 넘기면 Prisma 가 던지고, 사용자는 500 을 본다 —
   * "잘못된 조건"과 "서버가 고장났다"를 구분할 수 없는 화면이 된다.
   * 모르는 조건은 **없는 것으로 본다**(그게 사용자가 기대하는 결과다).
   */
  const ACTOR_TYPES = new Set(['HUMAN', 'AI', 'SYSTEM'])
  if (input.actorType && ACTOR_TYPES.has(input.actorType)) where.actorType = input.actorType
  if (input.targetType) where.targetType = input.targetType
  if (input.targetId) where.targetId = input.targetId
  // 도메인은 접두사 검색이라 무엇이 와도 안전하다 — 없으면 0건이 정상 답이다
  if (input.domain) where.action = { startsWith: `${input.domain}.` }

  // 커서는 우리가 준 시각이다. 깨져서 오면 처음부터 보여 준다 — 500 을 던질 일이 아니다
  if (input.cursor) {
    const at = new Date(input.cursor)
    if (!Number.isNaN(at.getTime())) where.createdAt = { lt: at }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmAuditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    select: {
      id: true, actorType: true, actorId: true, action: true,
      targetType: true, targetId: true, beforeJson: true, afterJson: true, createdAt: true,
    },
  }) as AuditRow[]

  const page = rows.slice(0, limit)
  const nextCursor = rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null

  // 사람 이름을 한 번에 찾아 붙인다 — 행마다 조회하면 50번 왕복한다
  const memberIds = Array.from(new Set(
    page.filter((r) => r.actorType === 'HUMAN' && r.actorId).map((r) => r.actorId as string),
  ))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const members = memberIds.length > 0
    ? await (db as any).crmMember.findMany({
      where: { id: { in: memberIds } }, select: { id: true, displayName: true },
    }) as { id: string; displayName: string }[]
    : []
  const nameOf = new Map(members.map((m) => [m.id, m.displayName]))

  /**
   * 단계 id 를 이름으로.
   *
   * "st_gpu_1 → st_gpu_2"는 아무 뜻이 없다. 사람이 알고 싶은 건
   * "리드 → 요구사항 파악"이다. id 는 우리 사정이지 사용자의 사정이 아니다.
   */
  const stageIds = new Set<string>()
  for (const r of page) {
    for (const side of [r.beforeJson, r.afterJson]) {
      const o = side && typeof side === 'object' ? side as Record<string, unknown> : null
      const v = o?.stageId
      if (typeof v === 'string') stageIds.add(v)
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stages = stageIds.size > 0
    ? await (db as any).crmStage.findMany({
      where: { id: { in: Array.from(stageIds) } }, select: { id: true, name: true },
    }) as { id: string; name: string }[]
    : []
  const stageName = new Map(stages.map((st) => [st.id, st.name]))

  return {
    items: page.map((r) => ({
      ...r,
      summary: ACTION_LABEL[r.action] ?? r.action,
      actorName: r.actorType === 'HUMAN'
        ? (r.actorId ? nameOf.get(r.actorId) ?? '알 수 없는 사람' : '사람')
        : ACTOR_LABEL[r.actorType] ?? r.actorType,
      changes: diff(r.beforeJson, r.afterJson, r.action, stageName),
    })),
    nextCursor,
  }
}

export { ACTION_LABEL, ACTOR_LABEL, TARGET_LABEL, FIELD_LABEL }
