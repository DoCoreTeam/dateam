import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isUserInOrgScope } from '@/lib/work/project-members-scope'

interface Ctx { params: Promise<{ id: string }> }

const ROLE_MAX = 50
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// POST /api/projects/[id]/members — 멤버 추가({ user_id, role? }). 본인 소유 프로젝트만.
//  ownership은 project_members RLS(projects.user_id 기준)가 보장하나, 친절한 404·존재검증 위해 앱에서도 선확인.

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: '잘못된 요청입니다' }, { status: 400 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json().catch(() => null) as Record<string, unknown> | null
  const userId = typeof raw?.user_id === 'string' ? raw.user_id.trim() : ''
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: '유효한 user_id가 필요합니다' }, { status: 400 })
  const role = typeof raw?.role === 'string' ? raw.role.trim().slice(0, ROLE_MAX) || null : null

  // 소유 + 미삭제 프로젝트 확인(없으면 404). RLS와 2중 방어.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: project } = await db
    .from('projects').select('id').eq('id', id).eq('user_id', user.id).is('deleted_at', null).maybeSingle()
  if (!project) return NextResponse.json({ error: '프로젝트를 찾을 수 없습니다' }, { status: 404 })

  // 추가 대상이 호출자의 org-scope 가시 범위 내인지 검증(IDOR 차단). 본인은 항상 허용.
  const admin = createAdminClient()
  if (!(await isUserInOrgScope(admin, user.id, userId))) {
    return NextResponse.json({ error: '추가할 수 없는 사용자입니다' }, { status: 403 })
  }

  // upsert(멱등) — 동일 (project_id,user_id) 재추가 시 role 갱신.
  const { data, error } = await db
    .from('project_members')
    .upsert({ project_id: id, user_id: userId, role }, { onConflict: 'project_id,user_id' })
    .select('id, user_id, role, created_at')
    .single()
  if (error) {
    console.error('[projects/members POST] upsert failed', error)
    return NextResponse.json({ error: '요청을 처리하지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json(data, { status: 201 })
}
