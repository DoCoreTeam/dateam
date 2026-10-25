// POST /api/public/v1/approvals/{id}/cancel: 내 키가 낸 승인 요청을 거둔다 (P0170 I08)
// 요청을 만든 그 키만, 기다리는 중(PENDING)인 것만 취소된다. 남의 것과 없는 것은 같은 404 로 답한다
import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireMemberKey } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { fail, ok } from '@/lib/public-api/respond'
import { isUuid } from '@/lib/postgrest-safe'
import { API_APPROVAL_ERROR } from '@/lib/terms'
import { withWriteAudit } from '@/lib/public-api/write-audit'

type Ctx = { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function POST(request: NextRequest, { params }: Ctx) {
  return withWriteAudit('public.approvals.cancel', async () => {
    // 읽기 키도 승인 요청을 만들 수 있으므로 자기 요청을 거두는 데는 읽기 범위면 된다
    const auth = await authenticatePublicApi(request, { scope: 'read', role: 'member' })
    if ('error' in auth) return auth.error
    const denied = requireMemberKey(auth.ctx, request)
    if (denied) return denied
    const opts = { ctx: auth.ctx, request }
    const { id } = await params
    if (!isUuid(id)) return fail(404, API_APPROVAL_ERROR.not_found, opts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = createAdminClient() as any
    // 사람 확인: 키 해시로 찾은 키 id 와 그 주인에게 묶인 줄만 본다 (서비스롤 위의 소유 조건)
    const { data: row } = await admin.from('api_approval_requests')
      .select('id, status, expires_at').eq('id', id).eq('key_id', auth.ctx.keyId).eq('user_id', auth.ctx.userId).maybeSingle()
    if (!row) return fail(404, API_APPROVAL_ERROR.not_found, opts)
    const expired = row.status === 'PENDING' && new Date(row.expires_at).getTime() <= Date.now()
    if (row.status !== 'PENDING' || expired) return fail(409, API_APPROVAL_ERROR.not_pending, opts)
    const { data: done } = await admin.from('api_approval_requests')
      .update({ status: 'CANCELLED', decided_at: new Date().toISOString() })
      .eq('id', id).eq('key_id', auth.ctx.keyId).eq('status', 'PENDING')
      .select('id, status, decided_at').maybeSingle()
    // 그 사이 사람이 결정했으면 0행이다
    if (!done) return fail(409, API_APPROVAL_ERROR.not_pending, opts)
    return ok({ id: done.id, status: done.status, decidedAt: done.decided_at }, opts)
  })(request, undefined)
}
