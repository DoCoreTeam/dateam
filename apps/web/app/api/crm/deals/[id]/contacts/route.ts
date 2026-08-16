// GET    /api/crm/deals/:id/contacts — 이 딜에 실제로 관여하는 사람들
// POST   /api/crm/deals/:id/contacts — 참석자 추가·역할 변경
// DELETE /api/crm/deals/:id/contacts?personId=… — 참석자 제외
//
// 회사의 인물 전체가 아니라 **이 딜의 사람들**이다. 그 차이가 "누구를 설득해야 하나"에 답한다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import {
  listDealContacts, addDealContact, removeDealContact, DEAL_CONTACT_ROLES,
} from '@/lib/crm/services/deal-contact'
import type { DealContactRole } from '@/lib/crm/services/deal-contact'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    return { items: await listDealContacts(db, id) }
  })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const personId = typeof body.personId === 'string' ? body.personId.trim() : ''
    if (!personId) throw new CrmError('VALIDATION_FAILED', '누구를 넣을지 골라 주세요.', { field: 'personId' })

    const role = typeof body.role === 'string' ? body.role : 'OTHER'
    if (!(DEAL_CONTACT_ROLES as readonly string[]).includes(role)) {
      throw new CrmError('VALIDATION_FAILED', '역할을 다시 골라 주세요.', { field: 'role' })
    }

    await addDealContact(session.workspaceId, session.memberId, id, personId, role as DealContactRole)
    return { ok: true }
  })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const personId = req.nextUrl.searchParams.get('personId')?.trim()
    if (!personId) throw new CrmError('VALIDATION_FAILED', '누구를 뺄지 골라 주세요.', { field: 'personId' })
    await removeDealContact(session.workspaceId, session.memberId, id, personId)
    return { ok: true }
  })
}
