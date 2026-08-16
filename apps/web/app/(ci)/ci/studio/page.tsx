// app/(ci)/ci/studio/page.tsx — 편집점 스튜디오
import { redirect } from 'next/navigation'
import { createClient, getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import PageHeader from '@/components/ui/PageHeader'
import StudioView from './StudioView'

export const dynamic = 'force-dynamic'

export default async function StudioPage(
  { searchParams }: { searchParams: Promise<{ asset?: string }> },
) {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  // 자료 화면에서 "편집점"을 눌러 온 경우 — 그 자료를 골라 둔 상태로 연다.
  // 쿼리로 받는 이유: URL이 상태여야 새로고침·공유가 그대로 성립한다.
  const { asset } = await searchParams

  return (
    <>
      <PageHeader
        title="편집점"
        description="잘 된 콘텐츠의 방식을 내 영상에 겹쳐, 어디를 어떻게 손볼지 타임코드로 알려드립니다"
      />
      <StudioView workspaceId={workspace.id} initialAssetId={asset ?? null} />
    </>
  )
}
