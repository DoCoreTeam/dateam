/**
 * 회사 서비스 (dacrm T1-02)
 *
 * 규칙 셋을 여기서만 지킨다 — 화면·API 가 각자 하면 언젠가 한 곳이 빠진다.
 *   1) 저장 전 정규화(도메인 소문자·호스트만) — lib/crm/domain/normalize
 *   2) 쓰기는 withCrmTx 안에서, 감사 로그를 같은 트랜잭션에 (CLAUDE_dacrm 절대규칙 6)
 *   3) 수정은 낙관적 잠금 — version 이 어긋나면 409 (DI-18)
 *
 * workspaceId 는 인자로 받지 않는다. getCrmDb(workspaceId) 가 이미 그 워크스페이스에
 * 묶인 클라이언트이고, 가드가 모든 쿼리에 조건을 주입한다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeDomain, normalizeText, requireText } from '../domain/normalize.ts'
import { assertUpdated, lockWhere, BUMP_VERSION } from '../db/optimistic.ts'
import {
  clampLimit, decodeCursor, cursorWhere, CURSOR_ORDER, toPage, countIfFirstPage,
  type CursorInput, type CursorPage,
} from '../db/cursor.ts'
import { planDelete, type DeleteMode } from '../domain/soft-delete.ts'

/** 화면이 다루는 회사 한 건 */
export interface CompanyRow {
  id: string
  name: string
  domain: string | null
  industry: string | null
  employeeRange: string | null
  region: string | null
  descriptionMd: string | null
  ownerId: string | null
  version: number
  updatedAt: Date
}

const SELECT = {
  id: true, name: true, domain: true, industry: true, employeeRange: true,
  region: true, descriptionMd: true, ownerId: true, version: true, updatedAt: true,
} as const

export interface CompanyInput {
  name: string
  domain?: string | null
  industry?: string | null
  employeeRange?: string | null
  region?: string | null
  descriptionMd?: string | null
  ownerId?: string | null
}

/** 저장 직전 정규화. 여기를 거치지 않고 DB 로 가는 길이 없어야 한다 */
function normalizeInput(input: CompanyInput): Record<string, unknown> {
  const name = requireText(input.name)
  if (!name) throw new CrmError('VALIDATION_FAILED', '회사명을 입력해 주세요.', { field: 'name' })

  const out: Record<string, unknown> = { name }
  // undefined 는 "안 건드림", null 은 "지움" — 둘을 구분한다(PATCH 의 뜻이 달라진다)
  if (input.domain !== undefined) out.domain = normalizeDomain(input.domain)
  if (input.industry !== undefined) out.industry = normalizeText(input.industry)
  if (input.employeeRange !== undefined) out.employeeRange = normalizeText(input.employeeRange)
  if (input.region !== undefined) out.region = normalizeText(input.region)
  if (input.descriptionMd !== undefined) out.descriptionMd = input.descriptionMd?.trim() || null
  if (input.ownerId !== undefined) out.ownerId = input.ownerId || null
  return out
}

export interface ListCompanyInput extends CursorInput {
  /**
   * 휴지통만 본다.
   *
   * 왜 옵션인가: 가드가 기본으로 `deletedAt: null` 을 넣는다(그게 맞다).
   * 휴지통은 **일부러 삭제된 것을 보는 화면**이라, 그 기본을 명시적으로 뒤집는다.
   * 화면이 "30일 안에 되돌릴 수 있습니다"라고 약속했으면 되돌릴 길이 있어야 한다.
   */
  trash?: boolean
  /** 이름·도메인 부분 일치 */
  q?: string | null
}

export async function listCompanies(
  db: CrmDb,
  input: ListCompanyInput = {},
): Promise<CursorPage<CompanyRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const q = normalizeText(input.q)

  const where: Record<string, unknown> = {}
  if (input.trash) where.deletedAt = { not: null }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { domain: { contains: q.toLowerCase() } },
    ]
  }
  const cur = cursorWhere(decoded)
  // 커서 조건도 OR 을 쓰므로 검색 OR 과 섞이면 안 된다 — AND 로 감싼다
  const finalWhere = cur ? { AND: [where, cur] } : where

  // 목록과 총 건수를 같이 친다 — 순서대로 기다리면 첫 페이지가 두 배로 느려진다
  const [rows, total] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (db as any).crmCompany.findMany({
      where: finalWhere,
      select: SELECT,
      orderBy: CURSOR_ORDER,
      take: limit + 1,
    }),
    // 총 건수는 커서 조건을 빼고 센다 — 커서를 넣으면 "남은 개수"가 되어 버린다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    countIfFirstPage((db as any).crmCompany, where, decoded),
  ])
  return toPage(rows as CompanyRow[], limit, total)
}

export async function getCompany(db: CrmDb, id: string): Promise<CompanyRow> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).crmCompany.findFirst({ where: { id }, select: SELECT })
  if (!row) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.')
  return row as CompanyRow
}

export async function createCompany(
  workspaceId: string,
  actorId: string | null,
  input: CompanyInput,
): Promise<CompanyRow> {
  const data = normalizeInput(input)

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const created = await (tx as any).crmCompany.create({ data, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'company.created', targetType: 'company', targetId: created.id,
      afterJson: created,
    }))
    return created as CompanyRow
  })
}

export interface UpdateCompanyInput extends Partial<CompanyInput> {
  /** 화면이 들고 있던 버전. 어긋나면 409 */
  version: number
}

export async function updateCompany(
  workspaceId: string,
  actorId: string | null,
  id: string,
  input: UpdateCompanyInput,
): Promise<CompanyRow> {
  const { version, ...rest } = input
  // name 이 안 왔으면 정규화에서 막히지 않게, 부분 수정임을 알린다
  const data = rest.name !== undefined
    ? normalizeInput(rest as CompanyInput)
    : normalizeInput({ ...rest, name: '__keep__' } as CompanyInput)
  if (rest.name === undefined) delete data.name

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmCompany.findFirst({ where: { id }, select: SELECT })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmCompany.updateMany({
      where: lockWhere(id, version),
      data: { ...data, ...BUMP_VERSION },
    })
    assertUpdated(res.count, { exists: Boolean(before), version: before?.version }, '회사')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmCompany.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'company.updated', targetType: 'company', targetId: id,
      beforeJson: before, afterJson: after,
    }))
    return after as CompanyRow
  })
}

/**
 * 삭제 — 기본은 휴지통, 요청하면 영구 삭제(사용자 결정 2026-08-16).
 * 영구 삭제 전에는 FK 가 없는 참조를 코드가 먼저 치운다(아래 purgeOrphans 참조).
 */
export async function deleteCompany(
  workspaceId: string,
  actorId: string | null,
  id: string,
  mode: DeleteMode = 'trash',
): Promise<void> {
  const plan = planDelete(mode)

  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const before = await (tx as any).crmCompany.findFirst({
      // 영구 삭제는 이미 휴지통에 있는 것이 대상이므로 삭제 필터를 풀어 준다
      where: mode === 'purge' ? { id, deletedAt: { not: undefined } } : { id },
      select: SELECT,
    })
    if (!before) throw new CrmError('NOT_FOUND', '회사를 찾을 수 없습니다.')

    if (mode === 'trash') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (tx as any).crmCompany.updateMany({
        where: { id }, data: { deletedAt: new Date(), ...BUMP_VERSION },
      })
      assertUpdated(res.count, { exists: true, version: before.version }, '회사')
    } else {
      await purgeOrphanRefs(tx, 'company', id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmCompany.deleteMany({ where: { id } })
    }

    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: plan.auditAction, targetType: 'company', targetId: id, beforeJson: before,
    }))
  })
}

/**
 * FK 가 없는 참조를 먼저 치운다 — 본체를 지우면 고아가 남는 자리들이다.
 * (CI 세션이 ci_board_items 에서 겪은 것과 같은 구조. FK 가 없으니 DB 가 안 막아 준다)
 */
async function purgeOrphanRefs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  targetType: 'company' | 'person',
  targetId: string,
): Promise<void> {
  // AI 제안: targetType + targetId 로 가리키는 폴리모픽 참조
  await tx.crmAiSuggestion.deleteMany({ where: { targetType, targetId } })
  // 중복 후보: 두 쪽 어디에 있든 지운다
  await tx.crmDuplicateCandidate.deleteMany({
    where: { targetType, OR: [{ aId: targetId }, { bId: targetId }] },
  })
}

/** 휴지통 목록 — 복구 화면이 쓴다 */
export async function listTrashedCompanies(
  db: CrmDb,
  input: CursorInput = {},
): Promise<CursorPage<CompanyRow>> {
  const limit = clampLimit(input.limit)
  const decoded = decodeCursor(input.cursor)
  const cur = cursorWhere(decoded)
  const where = cur
    ? { AND: [{ deletedAt: { not: null } }, cur] }
    : { deletedAt: { not: null } }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmCompany.findMany({
    where, select: SELECT, orderBy: CURSOR_ORDER, take: limit + 1,
  })
  return toPage(rows as CompanyRow[], limit)
}

/** 휴지통에서 되살린다 */
export async function restoreCompany(
  workspaceId: string,
  actorId: string | null,
  id: string,
): Promise<CompanyRow> {
  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmCompany.updateMany({
      where: { id, deletedAt: { not: null } },
      data: { deletedAt: null, ...BUMP_VERSION },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '휴지통에서 회사를 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const after = await (tx as any).crmCompany.findFirst({ where: { id }, select: SELECT })
    await writeAudit(tx, ({
      actorType: 'HUMAN', actorId, action: 'company.restored', targetType: 'company', targetId: id, afterJson: after,
    }))
    return after as CompanyRow
  })
}
