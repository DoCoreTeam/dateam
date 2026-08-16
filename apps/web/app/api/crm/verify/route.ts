// GET   /api/crm/verify?targetType=company&targetId=… — 지금 확정된 필드
// PATCH /api/crm/verify — 확정하거나 푼다
//
// 이 스위치가 없어서 "사람이 확인한 값은 AI가 못 덮는다"(절대규칙 2)가
// 한 번도 실행되지 않고 있었다. 판정 로직은 처음부터 있었다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { setFieldVerified, listVerified, verifiableFields } from '@/lib/crm/services/verify'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ session }) => {
    const targetType = req.nextUrl.searchParams.get('targetType') ?? ''
    const targetId = req.nextUrl.searchParams.get('targetId') ?? ''
    if (!targetType || !targetId) {
      throw new CrmError('VALIDATION_FAILED', '무엇을 볼지 지정해 주세요.', { field: 'targetId' })
    }
    const db = getCrmDb(session.workspaceId)
    return {
      verifiedFields: await listVerified(db, targetType, targetId),
      // 화면이 어떤 칸에 토글을 그릴지 알아야 한다 — 못 잠그는 칸에 토글을 두면 오해를 부른다
      verifiable: verifiableFields(targetType),
    }
  })
}

export async function PATCH(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const targetType = typeof body.targetType === 'string' ? body.targetType : ''
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : ''
    const field = typeof body.field === 'string' ? body.field.trim() : ''
    if (!targetType || !targetId || !field) {
      throw new CrmError('VALIDATION_FAILED', '어느 항목을 확정할지 지정해 주세요.', { field: 'field' })
    }
    return setFieldVerified(
      session.workspaceId, session.memberId, targetType, targetId, field, body.verified === true,
    )
  })
}
