// GET /api/public/v1/approvals/{id} — 승인 요청의 상태와 결과 (P0158 I08), CLI 가 202 뒤에 이것을 묻는다
import type { NextRequest } from 'next/server'
import { authenticatePublicApi, optionsResponse, requireMemberKey } from '@/lib/publicApiAuth'
import { createAdminClient } from '@/lib/supabase/server'
import { fail, ok } from '@/lib/public-api/respond'

type Ctx = { params: Promise<{ id: string }> }

export async function OPTIONS(request: NextRequest) {
  return optionsResponse(request)
}

export async function GET(request: NextRequest, { params }: Ctx) {
  const auth = await authenticatePublicApi(request, { deferScope: true })
  if ('error' in auth) return auth.error
  // 승인 요청은 사람 계정 키만 만든다 (api_user 키는 승인 범위를 못 가진다)
  const denied = requireMemberKey(auth.ctx, request)
  if (denied) return denied
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, '승인 요청을 찾을 수 없습니다.', { ctx: auth.ctx, request })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  // 키 소유자 본인 것만, 남의 요청은 있는지도 알려 주지 않는다
  const { data } = await admin.from('api_approval_requests')
    .select('id, action_name, required_scope, status, result, expires_at, created_at, decided_at')
    .eq('id', id).eq('user_id', auth.ctx.userId).maybeSingle()
  if (!data) return fail(404, '승인 요청을 찾을 수 없습니다.', { ctx: auth.ctx, request })
  const expired = data.status === 'PENDING' && new Date(data.expires_at).getTime() <= Date.now()
  return ok({
    id: data.id, action: data.action_name, requiredScope: data.required_scope,
    status: expired ? 'EXPIRED' : data.status, result: data.result ?? null,
    expiresAt: data.expires_at, createdAt: data.created_at, decidedAt: data.decided_at,
  }, { ctx: auth.ctx, request })
}
