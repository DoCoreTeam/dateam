import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseProjectMeta, PROJECT_SELECT } from '@/lib/work/project-fields'
import { logProjectActivity } from '@/lib/work/project-activity'

interface Ctx { params: Promise<{ id: string }> }

const NAME_MAX = 200
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET: 단건(프로젝트 메타) / PATCH: 이름·메타 수정 / DELETE: soft delete.
// 모두 본인 소유(eq user_id) — RLS 위 앱 레이어 2중 방어.

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: project, error } = await db
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) {
    console.error('[projects GET] select failed', error)
    return NextResponse.json({ error: '요청을 처리하지 못했습니다' }, { status: 500 })
  }
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })

  return NextResponse.json(project)
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!raw) return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if ('name' in raw) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) return NextResponse.json({ error: '프로젝트 이름은 필수입니다' }, { status: 400 })
    if (name.length > NAME_MAX) return NextResponse.json({ error: `이름은 ${NAME_MAX}자 이하여야 합니다` }, { status: 400 })
    patch.name = name
  }

  const meta = parseProjectMeta(raw)
  if ('error' in meta) return NextResponse.json({ error: meta.error }, { status: 400 })
  Object.assign(patch, meta.fields)

  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '수정할 내용이 없습니다' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbW = supabase as any
  // 변경 전 스냅샷(감사로그 before). RLS 소유 확인 겸용.
  const { data: before } = await dbW
    .from('projects').select(PROJECT_SELECT)
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()

  const { data, error } = await dbW
    .from('projects')
    .update(patch)
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select(PROJECT_SELECT)
    .maybeSingle()
  if (error) {
    console.error('[projects PATCH] update failed', error)
    await logProjectActivity(supabase, {
      projectId: id, ownerId: user.id, actorId: user.id, action: 'update', status: 'failure',
      before, error, evidence: { patch },
    })
    return NextResponse.json({ error: '요청을 처리하지 못했습니다' }, { status: 500 })
  }
  if (!data) {
    await logProjectActivity(supabase, {
      projectId: id, ownerId: user.id, actorId: user.id, action: 'update', status: 'failure',
      error: { message: '대상 없음(미소유 또는 삭제됨)' }, evidence: { patch },
    })
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
  }
  await logProjectActivity(supabase, {
    projectId: id, ownerId: user.id, actorId: user.id, action: 'update', status: 'success',
    before, after: data,
  })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbD = supabase as any
  const { data: before } = await dbD
    .from('projects').select(PROJECT_SELECT)
    .eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()

  const { data, error } = await dbD
    .from('projects')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) {
    console.error('[projects DELETE] soft-delete failed', error)
    await logProjectActivity(supabase, {
      projectId: id, ownerId: user.id, actorId: user.id, action: 'delete', status: 'failure',
      before, error,
    })
    return NextResponse.json({ error: '요청을 처리하지 못했습니다' }, { status: 500 })
  }
  if (!data) {
    await logProjectActivity(supabase, {
      projectId: id, ownerId: user.id, actorId: user.id, action: 'delete', status: 'failure',
      error: { message: '대상 없음(미소유 또는 이미 삭제됨)' },
    })
    return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })
  }
  await logProjectActivity(supabase, {
    projectId: id, ownerId: user.id, actorId: user.id, action: 'delete', status: 'success',
    before,
  })
  return NextResponse.json({ success: true })
}
