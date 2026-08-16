// GET    /api/crm/integrations — 연결 상태 (설정 화면이 재연결 배너를 띄우려면 이게 필요하다)
// DELETE /api/crm/integrations?id=… — 연결 해제
//
// 용어는 §2-5(2)를 따른다 — 연동을 끊는 건 "삭제"가 아니라 **연결 해제**다.
// 키만 지우는 것이지 그동안 담은 활동이 사라지는 게 아니기 때문이다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { writeAudit } from '@/lib/crm/db/audit'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const rows = await db.crmIntegrationConnection.findMany({
      orderBy: { createdAt: 'desc' },
      // 토큰은 절대 내보내지 않는다 — 화면이 알아야 하는 건 "연결됐나"뿐이다
      select: {
        id: true, provider: true, memberId: true, scopes: true,
        status: true, gmailHistoryId: true, expiresAt: true, updatedAt: true,
      },
    })
    return { items: rows }
  })
}

export async function DELETE(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const id = req.nextUrl.searchParams.get('id')?.trim()
    if (!id) throw new CrmError('VALIDATION_FAILED', '해제할 연결을 지정해 주세요.', { field: 'id' })

    await withCrmTx(session.workspaceId, async (tx) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (tx as any).crmIntegrationConnection.deleteMany({ where: { id } })
      if (res.count === 0) throw new CrmError('NOT_FOUND', '연결을 찾을 수 없습니다.')
      await writeAudit(tx, {
        actorType: 'HUMAN', actorId: session.memberId, action: 'integration.disconnected',
        targetType: 'integration', targetId: id,
      })
    })
    return { disconnected: true }
  })
}
