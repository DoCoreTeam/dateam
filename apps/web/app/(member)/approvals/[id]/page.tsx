// 승인 요청 화면 (P0158 I08), CLI 가 202 와 함께 준 주소로 키 주인이 들어온다
import { redirect } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import { createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { API_APPROVAL } from '@/lib/terms'
import ApprovalPanel, { type ApprovalView } from './ApprovalPanel'

type Props = { params: Promise<{ id: string }> }

export default async function ApprovalPage({ params }: Props) {
  const { id } = await params
  const user = await getRequestUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/approvals/${id}`)}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const valid = /^[0-9a-f-]{36}$/i.test(id)
  const { data: row } = valid
    ? await admin.from('api_approval_requests')
      .select('id, user_id, action_name, required_scope, method, path, payload, status, result, expires_at, created_at')
      .eq('id', id).maybeSingle()
    : { data: null }
  const allowed = !!row && (row.user_id === user.id || profile?.role === 'admin')

  const view: ApprovalView | null = allowed ? {
    id: row.id,
    action: row.action_name,
    requiredScope: row.required_scope,
    method: row.method,
    path: row.path,
    payload: typeof row.payload?.body === 'string' ? row.payload.body.slice(0, 2000) : '',
    status: row.status === 'PENDING' && new Date(row.expires_at).getTime() <= Date.now() ? 'EXPIRED' : row.status,
    resultStatus: typeof row.result?.status === 'number' ? row.result.status : null,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  } : null

  return (
    <main className="page-inner">
      <PageHeader title={API_APPROVAL.title} description={API_APPROVAL.description} back={{ href: '/api-keys', label: API_APPROVAL.back }} />
      <ApprovalPanel view={view} />
    </main>
  )
}
