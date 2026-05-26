import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const FEATURE_LABELS: Record<string, string> = {
  'weekly-report-refine': '주간보고 AI 정비',
  'report-preview-merge': '주간보고 병합 프리뷰',
  'report-export': '주간보고 내보내기',
  'lead-parse': '리드 인테이크 파싱',
  'account-fit-score': '거래처 적합도 점수',
  'deal-activity-parse': '딜 활동 AI 요약',
  'content-ai-edit': '콘텐츠 AI 편집',
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const pageRaw = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  const limitRaw = parseInt(req.nextUrl.searchParams.get('limit') ?? '50', 10)
  const page = Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1
  const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50
  const feature = req.nextUrl.searchParams.get('feature')
  const userId = req.nextUrl.searchParams.get('user_id')
  const offset = (page - 1) * limit

  let query = adm.from('ai_token_logs')
    .select('id, created_at, user_id, feature, model, prompt_tokens, output_tokens, total_tokens, success', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)
  if (feature) query = query.eq('feature', feature)
  if (userId) query = query.eq('user_id', userId)

  const { data: rows, count } = await query as {
    data: { id: string; created_at: string; user_id: string | null; feature: string; model: string; prompt_tokens: number; output_tokens: number; total_tokens: number }[] | null
    count: number | null
  }

  const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id).filter(Boolean))) as string[]
  const { data: profiles } = await adm.from('profiles').select('id, name').in('id', userIds) as { data: { id: string; name: string }[] | null }
  const nameMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.name]))

  const data = (rows ?? []).map((r) => ({
    ...r,
    feature_label: FEATURE_LABELS[r.feature] ?? r.feature,
    user_name: r.user_id ? (nameMap[r.user_id] ?? '알 수 없음') : '시스템',
  }))

  return NextResponse.json({ data, total: count ?? 0, page, limit })
}
