// app/(ci)/ci/boards/[id]/page.tsx — 보드 상세 (담긴 항목 보기·빼기)
//
// 예전엔 이 화면이 없어서 "담긴 항목 3건"을 열어볼 수도, 잘못 담은 것을 뺄 수도 없었다.
import { redirect, notFound } from 'next/navigation'
import { getRequestUser } from '@/lib/supabase/server'
import { resolveActiveWorkspace } from '@/lib/ci/workspace'
import { getBoard } from '@/lib/ci/queries/boards'
import PageHeader from '@/components/ui/PageHeader'
import BoardDetailView from './BoardDetailView'

export const dynamic = 'force-dynamic'

export default async function BoardDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const user = await getRequestUser()
  if (!user) redirect('/login')
  const workspace = await resolveActiveWorkspace(user.id)
  if (!workspace) redirect('/ci')

  const { id } = await params
  const board = await getBoard(workspace.id, id)
  if (!board) notFound()

  return (
    <>
      {/* 상위로 돌아갈 길은 제목 왼쪽 위 한 자리다(CLAUDE.md §2-3-1) */}
      <PageHeader
        title={board.name}
        description="이 보드에 담아 둔 것"
        back={{ href: '/ci/boards', label: '보드' }}
      />
      <BoardDetailView workspaceId={workspace.id} board={board} />
    </>
  )
}
