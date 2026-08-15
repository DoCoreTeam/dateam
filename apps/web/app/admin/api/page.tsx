import { redirect } from 'next/navigation'
import { Inbox, KeyRound } from 'lucide-react'
import PageHeader from '@/components/ui/PageHeader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import type { Profile } from '@/types/database'
import AccessRequestsPanel, { type AccessRequest } from './AccessRequestsPanel'
import ApiKeysPanel, { type ApiKeyRow } from './ApiKeysPanel'

export default async function AdminApiPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  const adminClient = createAdminClient()
  const profileResult = await adminClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single() as unknown as { data: Pick<Profile, 'role'> | null }

  if (profileResult.data?.role !== 'admin') redirect('/home')

  const params = await searchParams
  const tab = params.tab === 'keys' ? 'keys' : 'access'

  // 탭에 따라 필요한 데이터만 fetch
  const [accessRes, keysRes, authUsersRes, profilesRes] = await Promise.all([
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => { order: (f: string, o: object) => Promise<{ data: AccessRequest[] | null }> } } })
      .from('api_access_requests').select('*').order('created_at', { ascending: false }),
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => { order: (f: string, o: object) => Promise<{ data: ApiKeyRow[] | null }> } } })
      .from('api_keys').select('*').order('created_at', { ascending: false }),
    adminClient.auth.admin.listUsers({ perPage: 1000 }),
    (adminClient as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: Pick<Profile, 'id' | 'name'>[] | null }> } })
      .from('profiles').select('id, name'),
  ])

  const requests = accessRes.data ?? []
  const pending = requests.filter(r => r.status === 'pending')
  const processed = requests.filter(r => r.status !== 'pending')

  const keys = keysRes.data ?? []
  // 서버 컴포넌트 → 클라이언트 컴포넌트 경계는 Map을 못 넘긴다(직렬화 불가). 평범한 객체로 넘긴다.
  const emailMap = Object.fromEntries((authUsersRes.data?.users ?? []).map(u => [u.id, u.email ?? '']))
  const nameMap = Object.fromEntries((profilesRes.data ?? []).map(p => [p.id, p.name]))
  const activeKeys = keys.filter(k => !k.revoked_at)
  const revokedKeys = keys.filter(k => k.revoked_at)

  // 대기 건수는 탭 라벨에 그대로 적는다 — 배지를 따로 그리면 탭 부품이 화면마다 갈린다
  const tabs = [
    {
      id: 'access',
      label: pending.length > 0 ? `API 접근 신청 (${pending.length})` : 'API 접근 신청',
      icon: <Inbox size={15} />,
      href: '/admin/api?tab=access',
    },
    { id: 'keys', label: 'API 키 관리', icon: <KeyRound size={15} />, href: '/admin/api?tab=keys' },
  ]

  return (
    <div>
      <PageHeader
        title="API 관리"
        description="API 접근 신청 처리 및 키 발급 현황 관리"
        below={<SegmentedTabs ariaLabel="API 관리 분류" tabs={tabs} activeId={tab} />}
      />

      {tab === 'access'
        ? <AccessRequestsPanel pending={pending} processed={processed} />
        : <ApiKeysPanel activeKeys={activeKeys} revokedKeys={revokedKeys} nameMap={nameMap} emailMap={emailMap} />}
    </div>
  )
}
