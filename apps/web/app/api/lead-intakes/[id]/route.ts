import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

interface Ctx { params: Promise<{ id: string }> }

// 리드 인테이크 수정 — 편집 가능 필드(메모·상태)만. 본인 소유분만(user_id 일치).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = await req.json() as Record<string, unknown>
  const ALLOWED = ['notes', 'status'] as const
  const body = Object.fromEntries(ALLOWED.filter(k => k in raw).map(k => [k, raw[k]]))
  if (Object.keys(body).length === 0) return NextResponse.json({ error: '수정할 필드 없음' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('lead_intakes').update(body).eq('id', id).eq('user_id', user.id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '대상 없음 또는 권한 없음' }, { status: 404 })
  return NextResponse.json(data)
}

// 리드 인테이크 삭제 — 본인 소유분만.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('lead_intakes').delete().eq('id', id).eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
