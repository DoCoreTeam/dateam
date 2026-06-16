import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Ctx { params: Promise<{ id: string; userId: string }> }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// DELETE /api/projects/[id]/members/[userId] — 멤버 제거. 본인 소유 프로젝트만.
//  project_members RLS(DELETE = projects.user_id 소유자)가 권한을 보장. 앱에서 소유 선확인으로 404 명확화.

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id, userId } = await params
  if (!UUID_RE.test(id) || !UUID_RE.test(userId)) {
    return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: project } = await db
    .from('projects').select('id').eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })

  const { data, error } = await db
    .from('project_members')
    .delete()
    .eq('project_id', id)
    .eq('user_id', userId)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[projects/members DELETE] delete failed', error)
    return NextResponse.json({ error: '요청을 처리하지 못했습니다' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: '멤버를 찾을 수 없습니다' }, { status: 404 })
  return NextResponse.json({ success: true })
}
