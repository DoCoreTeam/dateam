// GET /api/crm/audit — 기록 보기
//
// 감사 기록은 "그 값이 어디서 왔나"에 답하는 유일한 근거다.
// 남기기만 하고 볼 수 없으면 안 남긴 것과 같아서 이 경로가 있다.
//
// 남의 워크스페이스 기록이 새면 영업 정보가 통째로 새는 것이라
// 가드가 자동으로 워크스페이스를 건다(crmAuditLog 는 workspaceId 보유).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { listAudit } from '@/lib/crm/services/audit-view'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const p = req.nextUrl.searchParams
    return listAudit(db, {
      limit: Number(p.get('limit') ?? 50) || 50,
      cursor: p.get('cursor'),
      actorType: p.get('actorType'),
      targetType: p.get('targetType'),
      targetId: p.get('targetId'),
      domain: p.get('domain'),
    })
  })
}
