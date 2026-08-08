import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

interface Ctx { params: Promise<{ id: string }> }
const ROLES = new Set(['manager', 'contributor', 'viewer', 'stakeholder'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const { data, error } = await db.from('project_members')
    .select('user_id,role,created_at,profiles(name,position)').eq('project_id', id).order('created_at')
  if (error) return NextResponse.json({ error: '참여자를 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ members: data ?? [] })
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const { id } = await params
  const body = await req.json().catch(() => null) as { userId?: string; role?: string } | null
  if (!body?.userId || !UUID_RE.test(body.userId) || !body.role || !ROLES.has(body.role)) {
    return NextResponse.json({ error: '잘못된 참여자 정보입니다' }, { status: 400 })
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const { data: profile } = await db.from('profiles').select('id').eq('id', body.userId).is('deleted_at', null).maybeSingle()
  if (!profile) return NextResponse.json({ error: '활성 사용자를 찾을 수 없습니다' }, { status: 404 })
  const { data, error } = await db.from('project_members').upsert({
    project_id: id, user_id: body.userId, role: body.role, created_by: auth.user.id,
  }, { onConflict: 'project_id,user_id' }).select('user_id,role').single()
  if (error) return NextResponse.json({ error: '참여자를 저장할 권한이 없거나 저장에 실패했습니다' }, { status: 403 })
  return NextResponse.json(data, { status: 201 })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const { id } = await params
  const userId = new URL(req.url).searchParams.get('userId') ?? ''
  if (!UUID_RE.test(userId)) return NextResponse.json({ error: '잘못된 사용자 ID입니다' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = (await createClient()) as any
  const { data, error } = await db.from('project_members').delete()
    .eq('project_id', id).eq('user_id', userId).neq('role', 'owner').select('user_id').maybeSingle()
  if (error) return NextResponse.json({ error: '참여자를 제거할 권한이 없습니다' }, { status: 403 })
  if (!data) return NextResponse.json({ error: '책임자는 제거할 수 없습니다' }, { status: 400 })
  return NextResponse.json({ success: true })
}
