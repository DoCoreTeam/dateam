// PATCH  /api/crm/labor-grades/[id] — 등급 고치기 (관리자, version 필수). 단가가 바뀌면 가격 이력에 새 줄
// DELETE /api/crm/labor-grades/[id] — 숨기기 (관리자). 쓴 견적이 이 등급을 가리켜 지우지 않는다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { updateLaborGrade, setLaborGradeActive, toGradeJson, type LaborGradeInput } from '@/lib/crm/services/labor-grade'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const row = await updateLaborGrade(session.workspaceId, session.memberId, (await params).id, requireVersion(body), body as LaborGradeInput)
    return toGradeJson(row, true)
  })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('ADMIN', async ({ session }) => {
    await setLaborGradeActive(session.workspaceId, session.memberId, (await params).id, false)
    return { ok: true }
  })
}
