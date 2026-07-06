import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/projects/[id]/activity — 해당 프로젝트의 저장 이력(감사로그).
// RLS(project_activity_select: user_id=auth.uid())로 본인 프로젝트만 노출.
// 성공/실패/부분 전부 포함(최신순). "작성했다는데 없다" 분쟁 시 증빙.

interface Ctx { params: Promise<{ id: string }> }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIMIT = 100

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('project_activity')
    .select('id, project_id, action, status, before_snapshot, after_snapshot, error_detail, evidence, occurred_at')
    .eq('project_id', id)
    .order('occurred_at', { ascending: false })
    .limit(LIMIT)
  if (error) {
    console.error('[projects activity GET] select failed', error)
    return NextResponse.json({ error: '이력을 불러오지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ items: data ?? [] })
}
