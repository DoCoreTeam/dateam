import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// 리드 인테이크 목록 조회(본인 소유) — 클라이언트 갱신용. 기존 SSR 직접조회를 API로 보완.
export async function GET(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const supabase = await createClient()

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 20) || 20, 100)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('lead_intakes').select('*').eq('user_id', auth.user.id)
    .order('created_at', { ascending: false }).limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ intakes: data ?? [] })
}
