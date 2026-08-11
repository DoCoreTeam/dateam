// app/(ci)/ci/assets/page.tsx — P04 자료
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import CiPageHeader from '@/components/ci/CiPageHeader'
import { EmptyState } from '@/components/ci/states'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

export const dynamic = 'force-dynamic'

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AssetsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const adminClient = createAdminClient() as any
  const { data } = await adminClient.from('ci_assets')
    .select('id, kind, storage_path, mime, bytes, created_at')
    .eq('workspace_id', workspace.id).is('deleted_at', null)
    .order('created_at', { ascending: false }).limit(100)

  const assets = (data ?? []) as {
    id: string; kind: string; storage_path: string; mime: string | null; bytes: number | null; created_at: string
  }[]

  return (
    <>
      <CiPageHeader title="자료" desc="제작에 쓴 원본과 산출 파일" />
      {assets.length === 0 ? (
        <EmptyState
          title="아직 등록된 자료가 없습니다"
          description="기획안과 편집안에서 만든 산출물과 원본 파일이 여기 모입니다. 파일 업로드는 편집안 화면과 함께 준비 중입니다."
          action={{ label: '파이프라인으로', href: '/ci/pipeline' }}
        />
      ) : (
        <table className="table-base table-card">
          <thead><tr><th>파일</th><th>구분</th><th>형식</th><th>크기</th><th>등록</th></tr></thead>
          <tbody>
            {assets.map((a) => (
              <tr key={a.id}>
                <td className="card-header">{a.storage_path.split('/').pop()}</td>
                <td data-label="구분">{a.kind === 'source' ? '원본' : '산출물'}</td>
                <td data-label="형식">{a.mime ?? '—'}</td>
                <td data-label="크기">
                  {a.bytes != null ? <span className="ci-num">{Math.round(a.bytes / 1024).toLocaleString('ko-KR')} KB</span> : '—'}
                </td>
                <td data-label="등록">{formatKstDateTimeShort(a.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
