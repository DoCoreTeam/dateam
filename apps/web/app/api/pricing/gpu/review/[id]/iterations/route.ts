import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// GET /api/pricing/gpu/review/[id]/iterations — 검토 대기 항목의 추출 이력(시간순)
//   통합 표 상세 패널 "검토/추출 이력"용. 읽기 전용(member 읽기 허용·RLS·인증 가드).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id 필수' }, { status: 400 })

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('review_iterations')
      .select('id, review_item_id, iteration_no, extracted, confidence, evidence, user_feedback, ai_model_used, prompt_version, created_at')
      .eq('review_item_id', id)
      .order('iteration_no', { ascending: true })

    if (error) throw error
    return NextResponse.json({ iterations: data ?? [] })
  } catch (err) {
    console.error('[review/[id]/iterations GET]', err)
    return NextResponse.json({ error: 'Failed to fetch review iterations' }, { status: 500 })
  }
}
