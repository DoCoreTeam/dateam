// app/(ci)/ci/studio/page.tsx — 편집점 스튜디오
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import PageHeader from '@/components/ui/PageHeader'
import StudioView from './StudioView'

export const dynamic = 'force-dynamic'

export default async function StudioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  return (
    <>
      <PageHeader
        title="편집점"
        description="잘 된 콘텐츠의 방식을 내 영상에 겹쳐, 어디를 어떻게 손볼지 타임코드로 알려드립니다"
      />
      <StudioView workspaceId={workspace.id} />
    </>
  )
}
