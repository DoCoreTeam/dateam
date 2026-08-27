/**
 * 딜 참석자 (dacrm 정정판 — 스키마에 있는데 화면이 없던 것)
 *
 * `CrmDealContact` 는 처음부터 스키마에 있었다. 역할까지 정의돼 있다 —
 * 챔피언 · 결정권자 · 실무자 · 반대자. 그런데 **화면이 한 번도 안 썼다.**
 * 딜 상세의 "연결" 칸은 이 관계가 아니라 **회사의 인물 전체**를 보여 주고 있었다.
 *
 * 그게 왜 문제인가: 회사에 20명이 있어도 이 딜에 실제로 관여하는 사람은 셋이다.
 * 스무 명을 다 보여 주면 "누구를 설득해야 하나"라는 질문에 화면이 답을 못 한다.
 * 반대자가 누구인지는 더더욱 안 보인다 — 그게 딜이 막히는 진짜 이유일 때가 많은데도.
 */

import type { CrmDb } from '../db/client.ts'
import { withCrmTx } from '../db/tx.ts'
import { writeAudit } from '../db/audit.ts'
import { CrmError } from '../domain/errors.ts'

/** 스키마의 CrmDealContactRole 과 같아야 한다 */
export const DEAL_CONTACT_ROLES = ['CHAMPION', 'DECISION_MAKER', 'PRACTITIONER', 'BLOCKER', 'OTHER'] as const
export type DealContactRole = typeof DEAL_CONTACT_ROLES[number]

/** 화면이 쓰는 말 — enum 을 그대로 보여 주면 무슨 뜻인지 모른다 */
export const ROLE_LABEL: Record<DealContactRole, string> = {
  CHAMPION: '우리 편',
  DECISION_MAKER: '결정권자',
  PRACTITIONER: '실무자',
  BLOCKER: '반대',
  OTHER: '관련자',
}

export interface DealContactRow {
  personId: string
  name: string
  title: string | null
  // 화면이 여기서 바로 연락한다 — email 만 주고 화면이 안 그리던 시절엔 딜에서 연락할 길이 없었다
  email: string | null
  phone: string | null
  role: DealContactRole
}

export async function listDealContacts(db: CrmDb, dealId: string): Promise<DealContactRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await (db as any).crmDealContact.findMany({
    where: { dealId },
    select: { personId: true, role: true },
  }) as { personId: string; role: string }[]
  if (rows.length === 0) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const people = await (db as any).crmPerson.findMany({
    where: { id: { in: rows.map((r) => r.personId) } },
    select: { id: true, name: true, title: true, email: true, phone: true },
  }) as { id: string; name: string; title: string | null; email: string | null; phone: string | null }[]
  const byId = new Map(people.map((p) => [p.id, p]))

  return rows
    // 사람이 지워졌으면 보여 줄 것이 없다 — id 만 남은 줄은 화면에서 유령이 된다
    .filter((r) => byId.has(r.personId))
    .map((r) => {
      const p = byId.get(r.personId)!
      return { personId: p.id, name: p.name, title: p.title, email: p.email, phone: p.phone, role: r.role as DealContactRole }
    })
    // 결정권자를 맨 위로 — 딜을 볼 때 가장 먼저 알아야 하는 사람이다
    .sort((a, b) => DEAL_CONTACT_ROLES.indexOf(a.role) - DEAL_CONTACT_ROLES.indexOf(b.role))
}

export async function addDealContact(
  workspaceId: string,
  actorId: string | null,
  dealId: string,
  personId: string,
  role: DealContactRole = 'OTHER',
): Promise<void> {
  if (!DEAL_CONTACT_ROLES.includes(role)) {
    throw new CrmError('VALIDATION_FAILED', '역할을 다시 골라 주세요.', { field: 'role' })
  }

  await withCrmTx(workspaceId, async (tx) => {
    // 딜·인물이 실제로 있는지 본다 — FK 가 없는 관계라 DB 가 안 막아 준다
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deal = await (tx as any).crmDeal.findFirst({ where: { id: dealId }, select: { id: true } })
    if (!deal) throw new CrmError('NOT_FOUND', '딜을 찾을 수 없습니다.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const person = await (tx as any).crmPerson.findFirst({ where: { id: personId }, select: { id: true } })
    if (!person) throw new CrmError('NOT_FOUND', '인물을 찾을 수 없습니다.')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const exists = await (tx as any).crmDealContact.findFirst({ where: { dealId, personId } })
    if (exists) {
      // 이미 있으면 역할만 바꾼다 — "이미 추가됐습니다"로 막으면 역할을 고칠 길이 없다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmDealContact.updateMany({ where: { dealId, personId }, data: { role } })
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (tx as any).crmDealContact.create({ data: { dealId, personId, role } })
    }

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: exists ? 'deal.contact_updated' : 'deal.contact_added',
      targetType: 'deal', targetId: dealId,
      afterJson: { personId, role },
    })
  })
}

export async function removeDealContact(
  workspaceId: string,
  actorId: string | null,
  dealId: string,
  personId: string,
): Promise<void> {
  await withCrmTx(workspaceId, async (tx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (tx as any).crmDealContact.deleteMany({ where: { dealId, personId } })
    if (res.count === 0) throw new CrmError('NOT_FOUND', '연결을 찾을 수 없습니다.')

    await writeAudit(tx, {
      actorType: 'HUMAN', actorId, action: 'deal.contact_removed',
      targetType: 'deal', targetId: dealId, beforeJson: { personId },
    })
  })
}
