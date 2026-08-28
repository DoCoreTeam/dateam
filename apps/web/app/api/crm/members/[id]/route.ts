// PATCH  /api/crm/members/:id — 권한 바꾸기 · 프로필(직위·연락처) 고치기
// DELETE /api/crm/members/:id — 내보내기(소프트 삭제)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { changeMemberRole, removeMember, updateMemberProfile } from '@/lib/crm/services/member'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await readJson(req)

  // 프로필(직위·연락처)은 **본인도** 고칠 수 있다 — 견적서에 찍히는 자기 정보다.
  // 권한 변경만 관리자다. 둘을 한 게이트로 묶으면 자기 전화번호를 못 고친다.
  if (body.role === undefined) {
    return withCrmApi('MEMBER', async ({ session }) => {
      if (session.memberId !== id && session.role !== 'ADMIN' && session.role !== 'OWNER') {
        throw new CrmError('FORBIDDEN', '다른 사람의 프로필은 관리자만 고칠 수 있어요.')
      }
      return updateMemberProfile(session.workspaceId, session.memberId, id, {
        title: typeof body.title === 'string' ? body.title : undefined,
        phone: typeof body.phone === 'string' ? body.phone : undefined,
      })
    })
  }

  return withCrmApi('ADMIN', async ({ session }) =>
    changeMemberRole(session.workspaceId, session.memberId, id, body.role))
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('ADMIN', async ({ session }) => {
    await removeMember(session.workspaceId, session.memberId, id)
    return { ok: true }
  })
}
