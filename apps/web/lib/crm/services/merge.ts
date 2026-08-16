/**
 * 병합 서비스 (dacrm T1-11, DI-10·11)
 *
 * 중복은 반드시 생긴다 — 같은 회사 명함을 두 사람이 받고, 같은 사람이 회사 메일과
 * 개인 메일로 각각 들어온다. 문제는 중복 자체가 아니라 **합칠 때 뭔가 사라지는 것**이다.
 *
 * 그래서 두 가지를 지킨다.
 *
 *   DI-10 — 사라지는 쪽을 가리키던 **모든 참조를 생존자로 옮긴다.**
 *           활동·태스크·딜·미팅 참석자까지. 하나라도 빠지면 그 기록은 고아가 되어
 *           어느 화면에도 안 나타난다. 지운 것도 아닌데 없어진 것처럼 보인다.
 *
 *   DI-11 — **30일 안에 되돌릴 수 있다.** 병합은 사람이 눈으로 보고 하는 판단이라 틀린다.
 *           되돌릴 수 없으면 아무도 못 누른다. 그래서 옮기기 전 상태를 통째로 스냅샷에 남긴다.
 *
 * 병합 방향은 **살릴 쪽(survivor)을 사람이 고른다.** 자동으로 정하지 않는다 —
 * 어느 쪽이 진짜인지는 데이터가 아니라 맥락이 정한다.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'
import { normalizeDomain, normalizeEmail, normalizeText } from '../domain/normalize.ts'

export type MergeTarget = 'company' | 'person'

/** 병합을 되돌릴 수 있는 기간 (DI-11 "30일 내") */
export const MERGE_UNDO_DAYS = 30

/**
 * 사라지는 쪽을 가리키는 모든 자리.
 *
 * 목록으로 두는 이유: 새 테이블이 참조를 갖게 되면 **여기에 한 줄 추가하는 것만으로**
 * 병합이 따라간다. 코드 여기저기에 흩어 두면 언젠가 한 곳을 빠뜨리고, 그 표가 고아가 된다.
 */
const REFS: Record<MergeTarget, { model: string; field: string }[]> = {
  company: [
    { model: 'crmPerson', field: 'companyId' },
    { model: 'crmDeal', field: 'companyId' },
    { model: 'crmActivity', field: 'companyId' },
    { model: 'crmTask', field: 'companyId' },
    { model: 'crmMeeting', field: 'companyId' },
  ],
  person: [
    { model: 'crmActivity', field: 'personId' },
    { model: 'crmTask', field: 'personId' },
    // crmDealContact 는 복합 PK 라 따로 다룬다(아래 mergeDealContacts)
  ],
}

const MODEL_OF: Record<MergeTarget, string> = { company: 'crmCompany', person: 'crmPerson' }

export interface MergeResult {
  mergeLogId: string
  /** 무엇을 몇 건 옮겼나 — 화면이 "12건을 옮겼어요"라고 말할 수 있어야 한다 */
  moved: Record<string, number>
}

/**
 * 딜 참석자 재연결.
 *
 * (dealId, personId) 복합 PK 라 그냥 UPDATE 하면 **같은 딜에 둘 다 있을 때 충돌**한다.
 * 그래서 생존자가 이미 있는 딜은 지우고, 없는 딜만 옮긴다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mergeDealContacts(tx: any, survivorId: string, mergedId: string): Promise<{
  moved: number; dropped: number; snapshot: unknown[]
}> {
  const rows = await tx.crmDealContact.findMany({ where: { personId: mergedId } })
  if (rows.length === 0) return { moved: 0, dropped: 0, snapshot: [] }

  const survivorDeals = new Set<string>(
    (await tx.crmDealContact.findMany({
      where: { personId: survivorId }, select: { dealId: true },
    })).map((r: { dealId: string }) => r.dealId),
  )

  let moved = 0
  let dropped = 0
  for (const r of rows) {
    if (survivorDeals.has(r.dealId)) {
      // 생존자가 이미 그 딜에 있다 — 중복이므로 지운다(역할은 생존자 것을 남긴다)
      await tx.crmDealContact.deleteMany({ where: { dealId: r.dealId, personId: mergedId } })
      dropped += 1
    } else {
      await tx.crmDealContact.updateMany({
        where: { dealId: r.dealId, personId: mergedId }, data: { personId: survivorId },
      })
      moved += 1
    }
  }
  return { moved, dropped, snapshot: rows }
}

/**
 * 미팅 참석자(JSON) 재연결.
 *
 * attendeesJson 은 배열이라 FK 가 없다 — DB 가 안 챙겨 주므로 코드가 챙긴다.
 * 여기를 빠뜨리면 병합 후 미팅 참석자 목록에 사라진 사람 id 가 남는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function mergeMeetingAttendees(tx: any, survivorId: string, mergedId: string): Promise<{
  moved: number; snapshot: unknown[]
}> {
  const meetings = await tx.crmMeeting.findMany({ select: { id: true, attendeesJson: true } })
  const touched: unknown[] = []
  let moved = 0

  for (const m of meetings) {
    const a = m.attendeesJson as { personIds?: string[] } | null
    const ids = Array.isArray(a?.personIds) ? a!.personIds : []
    if (!ids.includes(mergedId)) continue

    touched.push({ id: m.id, attendeesJson: m.attendeesJson })
    const next = Array.from(new Set(ids.map((x) => (x === mergedId ? survivorId : x))))
    await tx.crmMeeting.updateMany({
      where: { id: m.id }, data: { attendeesJson: { ...(a ?? {}), personIds: next } as never },
    })
    moved += 1
  }
  return { moved, snapshot: touched }
}

export async function mergeRecords(
  workspaceId: string,
  actorId: string | null,
  targetType: MergeTarget,
  survivorId: string,
  mergedId: string,
): Promise<MergeResult> {
  if (survivorId === mergedId) {
    throw new CrmError('VALIDATION_FAILED', '같은 레코드는 병합할 수 없습니다.')
  }
  const model = MODEL_OF[targetType]

  return withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const survivor = await (tx as any)[model].findFirst({ where: { id: survivorId } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged = await (tx as any)[model].findFirst({ where: { id: mergedId } })
    if (!survivor || !merged) throw new CrmError('NOT_FOUND', '병합할 레코드를 찾을 수 없습니다.')

    const moved: Record<string, number> = {}
    const refSnapshots: Record<string, unknown> = {}

    for (const ref of REFS[targetType]) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const before = await (tx as any)[ref.model].findMany({
        where: { [ref.field]: mergedId }, select: { id: true },
      }) as { id: string }[]
      if (before.length === 0) continue

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[ref.model].updateMany({
        where: { [ref.field]: mergedId }, data: { [ref.field]: survivorId },
      })
      moved[`${ref.model}.${ref.field}`] = before.length
      refSnapshots[`${ref.model}.${ref.field}`] = before.map((r) => r.id)
    }

    if (targetType === 'person') {
      const dc = await mergeDealContacts(tx, survivorId, mergedId)
      if (dc.moved || dc.dropped) {
        moved['crmDealContact.personId'] = dc.moved
        if (dc.dropped) moved['crmDealContact.dropped'] = dc.dropped
        refSnapshots['crmDealContact'] = dc.snapshot
      }
      const mt = await mergeMeetingAttendees(tx, survivorId, mergedId)
      if (mt.moved) {
        moved['crmMeeting.attendees'] = mt.moved
        refSnapshots['crmMeeting.attendees'] = mt.snapshot
      }
    }

    /**
     * 빈 칸은 채우고, 있는 값은 덮지 않는다.
     *
     * 생존자를 고른 사람은 "이쪽이 맞다"고 판단한 것이다. 그 판단을 병합이 뒤집으면 안 된다.
     * 다만 생존자에 없는 정보(전화번호만 다른 쪽에 있는 경우)를 버리는 것도 손실이라 채운다.
     */
    const fillable = targetType === 'company'
      ? ['domain', 'industry', 'region', 'employeeRange', 'descriptionMd']
      : ['email', 'phone', 'title', 'companyId']
    const fill: Record<string, unknown> = {}
    for (const f of fillable) {
      if ((survivor[f] === null || survivor[f] === undefined || survivor[f] === '') && merged[f]) {
        fill[f] = merged[f]
      }
    }
    if (Object.keys(fill).length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[model].updateMany({
        where: { id: survivorId }, data: { ...fill, version: { increment: 1 } },
      })
      moved['filledFields'] = Object.keys(fill).length
    }

    // 사라지는 쪽은 **소프트 삭제**다 — 30일 안에 되돌리려면 행이 남아 있어야 한다(DI-11)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)[model].updateMany({ where: { id: mergedId }, data: { deletedAt: new Date() } })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = await (tx as any).crmMergeLog.create({
      data: {
        targetType, survivorId, mergedId, mergedById: actorId ?? '',
        snapshotJson: {
          survivor, merged, refs: refSnapshots, filled: fill,
        } as never,
      },
      select: { id: true },
    })

    // 후보로 떠 있었다면 처리됨으로 닫는다 — 같은 쌍이 계속 뜨면 아무도 안 본다.
    // 사람이 "아니다"라고 치운 것(DISMISSED)은 건드리지 않는다 —
    // 그 판단을 MERGED 로 덮으면 되돌릴 때 되살아나 다시 목록에 뜬다.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmDuplicateCandidate.updateMany({
      where: {
        targetType,
        status: 'PENDING',
        OR: [{ aId: survivorId, bId: mergedId }, { aId: mergedId, bId: survivorId }],
      },
      data: { status: 'MERGED' },
    })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'record.merged',
      targetType, targetId: survivorId,
      beforeJson: { mergedId, moved },
      afterJson: { mergeLogId: log.id },
    })

    return { mergeLogId: log.id, moved }
  })
}

/**
 * 병합 취소 (DI-11).
 *
 * 스냅샷에 적힌 id 만 되돌린다 — "그때 옮긴 것"만 되돌리는 것이 핵심이다.
 * 병합 뒤에 새로 생긴 참조까지 되돌리면 그 사이의 일이 사라진다.
 */
export async function undoMerge(
  workspaceId: string,
  actorId: string | null,
  mergeLogId: string,
  now: Date = new Date(),
): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const log = await (tx as any).crmMergeLog.findFirst({ where: { id: mergeLogId } })
    if (!log) throw new CrmError('NOT_FOUND', '병합 기록을 찾을 수 없습니다.')
    if (log.undoneAt) throw new CrmError('VALIDATION_FAILED', '이미 되돌린 병합입니다.')

    const ageDays = (now.getTime() - new Date(log.mergedAt).getTime()) / 86_400_000
    if (ageDays > MERGE_UNDO_DAYS) {
      throw new CrmError('VALIDATION_FAILED',
        `병합은 ${MERGE_UNDO_DAYS}일 안에만 되돌릴 수 있습니다. 필요하면 직접 나눠 주세요.`)
    }

    const snap = log.snapshotJson as {
      survivor: Record<string, unknown>
      merged: Record<string, unknown>
      refs: Record<string, unknown>
      filled: Record<string, unknown>
    }

    // 참조를 원래 주인에게 되돌린다
    for (const [key, value] of Object.entries(snap.refs ?? {})) {
      if (key === 'crmDealContact') {
        for (const r of value as { dealId: string; personId: string; role?: string | null }[]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx as any).crmDealContact.updateMany({
            where: { dealId: r.dealId, personId: log.survivorId }, data: { personId: log.mergedId },
          })
        }
        continue
      }
      if (key === 'crmMeeting.attendees') {
        for (const m of value as { id: string; attendeesJson: unknown }[]) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (tx as any).crmMeeting.updateMany({
            where: { id: m.id }, data: { attendeesJson: m.attendeesJson as never },
          })
        }
        continue
      }

      const [model, field] = key.split('.')
      const ids = value as string[]
      if (!Array.isArray(ids) || ids.length === 0) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[model].updateMany({
        where: { id: { in: ids } }, data: { [field]: log.mergedId },
      })
    }

    // 채웠던 빈 칸을 되돌린다 — 병합이 넣은 값만 지운다
    const model = MODEL_OF[log.targetType as MergeTarget]
    if (Object.keys(snap.filled ?? {}).length > 0) {
      const revert: Record<string, unknown> = {}
      for (const f of Object.keys(snap.filled)) revert[f] = snap.survivor[f] ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any)[model].updateMany({
        where: { id: log.survivorId }, data: { ...revert, version: { increment: 1 } },
      })
    }

    // 사라졌던 쪽을 되살린다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any)[model].updateMany({
      where: { id: log.mergedId, deletedAt: { not: null } }, data: { deletedAt: null },
    })

    /**
     * 닫아 두었던 후보를 다시 연다.
     *
     * 이걸 안 하면 **되돌린 순간 그 쌍을 다시 합칠 길이 사라진다** —
     * 후보는 MERGED 로 남아 목록에 안 뜨고, 다시 훑어도 `saveDuplicates` 가
     * "이미 있는 쌍"이라며 건너뛴다. (실브라우저에서 실제로 그랬다)
     * 사람이 "아니다"라고 치운 것(DISMISSED)은 그대로 둔다 — 그건 판단이지 사고가 아니다.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmDuplicateCandidate.updateMany({
      where: {
        targetType: log.targetType,
        status: 'MERGED',
        OR: [
          { aId: log.survivorId, bId: log.mergedId },
          { aId: log.mergedId, bId: log.survivorId },
        ],
      },
      data: { status: 'PENDING' },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (tx as any).crmMergeLog.updateMany({ where: { id: mergeLogId }, data: { undoneAt: now } })

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'record.merge_undone',
      targetType: log.targetType, targetId: log.survivorId,
      afterJson: { mergeLogId, restoredId: log.mergedId },
    })
  })
}

// ------------------------------------------------------------
// 중복 후보 찾기
// ------------------------------------------------------------

export interface DuplicatePair {
  targetType: MergeTarget
  aId: string
  bId: string
  score: number
  /** 왜 같다고 보는가 — 근거 없이 "중복입니다"만 뜨면 사람이 판단할 수 없다 */
  reason: string
}

/**
 * 중복 후보를 찾는다.
 *
 * **도메인·이메일이 같은 중복은 존재할 수 없다.** DB 가 `(workspaceId, lower(domain))`,
 * `(workspaceId, lower(email))` 에 유니크를 걸어 두었기 때문이다(스키마 확인).
 * 그래서 "같은 도메인이면 중복" 같은 규칙은 한 건도 못 잡는 죽은 코드다.
 *
 * 실제로 생기는 중복은 이렇게 생긴다 —
 * 같은 회사를 두 사람이 각각 넣었는데 **한쪽은 도메인을 안 적었다.**
 * 그러니 판정의 축은 **이름**이고, 도메인·이메일은 그 판정을 **올리거나 내리는 근거**로 쓴다.
 *
 * 도메인이 서로 **다르면** 오히려 다른 회사일 확률이 높다 — 점수를 낮춘다.
 * 지우지는 않는다. 계열사·리브랜딩처럼 도메인이 갈리는 진짜 중복도 있기 때문이다.
 */
export async function scanDuplicates(db: CrmDb, targetType: MergeTarget): Promise<DuplicatePair[]> {
  const pairs: DuplicatePair[] = []

  if (targetType === 'company') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmCompany.findMany({
      select: { id: true, name: true, domain: true },
    }) as { id: string; name: string; domain: string | null }[]

    const byName = new Map<string, typeof rows>()
    for (const r of rows) {
      const n = companyNameKey(r.name)
      if (!n) continue
      byName.set(n, [...(byName.get(n) ?? []), r])
    }

    for (const group of Array.from(byName.values())) {
      if (group.length < 2) continue
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = normalizeDomain(group[i].domain)
          const b = normalizeDomain(group[j].domain)
          const [aId, bId] = [group[i].id, group[j].id].sort()
          if (a && b && a !== b) {
            pairs.push({ targetType, aId, bId, score: 0.5, reason: '이름은 같지만 도메인이 다름' })
          } else if (a || b) {
            pairs.push({ targetType, aId, bId, score: 0.85, reason: '이름이 같고 한쪽만 도메인이 있음' })
          } else {
            pairs.push({ targetType, aId, bId, score: 0.7, reason: '이름이 사실상 같음' })
          }
        }
      }
    }
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).crmPerson.findMany({
      select: { id: true, name: true, email: true, companyId: true },
    }) as { id: string; name: string; email: string | null; companyId: string | null }[]

    const byKey = new Map<string, typeof rows>()
    for (const r of rows) {
      const n = normalizeText(r.name)?.toLowerCase().replace(/\s/g, '')
      if (!n) continue
      // 회사를 모르는 사람끼리는 동명이인 구분이 안 된다 — 회사가 같을 때만 묶는다
      if (!r.companyId) continue
      const k = `${r.companyId}:${n}`
      byKey.set(k, [...(byKey.get(k) ?? []), r])
    }

    for (const group of Array.from(byKey.values())) {
      if (group.length < 2) continue
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = normalizeEmail(group[i].email)
          const b = normalizeEmail(group[j].email)
          const [aId, bId] = [group[i].id, group[j].id].sort()
          if (a && b && a !== b) {
            pairs.push({ targetType, aId, bId, score: 0.55, reason: '같은 회사·같은 이름이지만 메일이 다름' })
          } else if (a || b) {
            pairs.push({ targetType, aId, bId, score: 0.9, reason: '같은 회사에 같은 이름, 한쪽만 메일이 있음' })
          } else {
            pairs.push({ targetType, aId, bId, score: 0.75, reason: '같은 회사에 같은 이름' })
          }
        }
      }
    }
  }

  // 같은 쌍이 두 근거로 잡히면 점수 높은 쪽만 남긴다
  const best = new Map<string, DuplicatePair>()
  for (const p of pairs) {
    const key = `${p.aId}|${p.bId}`
    const cur = best.get(key)
    if (!cur || p.score > cur.score) best.set(key, p)
  }
  return Array.from(best.values()).sort((a, b) => b.score - a.score)
}

/**
 * 회사 이름 비교용 키.
 *
 * 법인격 표기(㈜·주식회사·Inc)와 구두점은 사람이 매번 다르게 적는다 —
 * 그게 중복의 실제 원인이라 비교 전에 걷어낸다.
 */
function companyNameKey(name: string): string | null {
  const t = normalizeText(name)
  if (!t) return null
  return t
    .toLowerCase()
    .replace(/주식회사|㈜|\(주\)|inc\.?|corp\.?|ltd\.?|llc|co\.?/g, '')
    .replace(/[()（）\s,.·\-_]/g, '')
    || null
}

/** 찾은 후보를 저장한다 — 화면이 읽고, 처리하면 상태가 바뀐다 */
export async function saveDuplicates(
  workspaceId: string,
  pairs: DuplicatePair[],
): Promise<number> {
  if (pairs.length === 0) return 0

  return withCrmTx(workspaceId, async (tx) => {
    let saved = 0
    for (const p of pairs) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const exists = await (tx as any).crmDuplicateCandidate.findFirst({
        where: { targetType: p.targetType, aId: p.aId, bId: p.bId }, select: { id: true },
      })
      if (exists) continue
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmDuplicateCandidate.create({
        data: { targetType: p.targetType, aId: p.aId, bId: p.bId, score: p.score },
      })
      saved += 1
    }
    return saved
  })
}

export async function listDuplicates(db: CrmDb, targetType?: MergeTarget) {
  const where: Record<string, unknown> = { status: 'PENDING' }
  if (targetType) where.targetType = targetType
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).crmDuplicateCandidate.findMany({
    where, orderBy: [{ score: 'desc' }, { createdAt: 'desc' }], take: 100,
  })
}

/** 사람이 "이건 다른 회사다"라고 판단한 쌍 — 다시 뜨지 않게 한다 */
export async function dismissDuplicate(workspaceId: string, id: string): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDuplicateCandidate.updateMany({
      where: { id, status: 'PENDING' }, data: { status: 'DISMISSED' },
    })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '후보를 찾을 수 없습니다.')
  })
}
