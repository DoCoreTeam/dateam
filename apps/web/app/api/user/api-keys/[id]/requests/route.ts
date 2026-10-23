// GET /api/user/api-keys/{id}/requests — 이 키의 최근 쓰기 요청 100건 (P0158 I11)
// 본인 키만, 관리자는 누구 키든. 읽기 요청은 관문이 기록하지 않는다 (요청 수는 키 목록의 request_count)
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { API_AUDIT_COLUMNS, API_AUDIT_MAX, auditScope } from '@/lib/public-api/api-audit'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const scope = auditScope({ userId: user.id, role: profile?.role })
  const { data: key } = await admin.from('api_keys').select('id, user_id').eq('id', id).maybeSingle()
  // 남의 키는 있는지도 알려 주지 않는다
  if (!key || (scope && key.user_id !== scope.userId)) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const { data, error } = await admin.from('api_write_audit').select(API_AUDIT_COLUMNS)
    .eq('key_id', id).order('created_at', { ascending: false }).limit(API_AUDIT_MAX)
  if (error) return NextResponse.json({ success: true, data: [] })
  return NextResponse.json({ success: true, data: data ?? [] })
}
