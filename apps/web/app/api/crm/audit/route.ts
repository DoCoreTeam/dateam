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
import { CrmError } from '@/lib/crm/domain/errors'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { API_AUDIT_COLUMNS, auditScope, clampLimit, toAuditEntry, type ApiAuditRow } from '@/lib/public-api/api-audit'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db }) => {
    const p = req.nextUrl.searchParams
    // API(에이전트) 탭: 관문이 남긴 쓰기 기록, 본인 키만 관리자는 전부 (P0158 I11)
    if (p.get('actorType') === 'API') return listApiAudit(p)
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

async function listApiAudit(p: URLSearchParams) {
  const user = await getRequestUser()
  if (!user) return { items: [], nextCursor: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const scope = auditScope({ userId: user.id, role: profile?.role })
  const limit = clampLimit(p.get('limit'))
  let q = admin.from('api_write_audit').select(API_AUDIT_COLUMNS).like('action_name', 'crm.%')
    .order('created_at', { ascending: false }).limit(limit)
  if (scope) q = q.eq('user_id', scope.userId)
  const cursor = p.get('cursor')
  if (cursor && !Number.isNaN(new Date(cursor).getTime())) q = q.lt('created_at', cursor)
  const { data, error } = await q
  // 조회 실패를 빈 목록으로 숨기지 않는다, 원문은 서버 기록에만 남기고 화면에는 INTERNAL 로 답한다 (P0162 I05)
  if (error) {
    console.error('[crm/audit] api_write_audit', error.code)
    throw new CrmError('INTERNAL')
  }
  const rows = (data ?? []) as ApiAuditRow[]
  return { items: rows.map(toAuditEntry), nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null }
}
