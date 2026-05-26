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

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
  const fromRaw = req.nextUrl.searchParams.get('from')
  const toRaw = req.nextUrl.searchParams.get('to')
  const now = new Date()
  const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const from = fromRaw && ISO_DATE_RE.test(fromRaw) ? fromRaw : defaultFrom
  const to = toRaw && ISO_DATE_RE.test(toRaw) ? toRaw : null

  let query = adm.from('ai_token_logs').select('feature, total_tokens')
  query = query.gte('created_at', `${from}T00:00:00.000Z`)
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)

  const { data: rows } = await query as { data: { feature: string; total_tokens: number }[] | null }

  const grouped = (rows ?? []).reduce<Record<string, { total_tokens: number; call_count: number }>>((acc, row) => {
    if (!acc[row.feature]) acc[row.feature] = { total_tokens: 0, call_count: 0 }
    acc[row.feature].total_tokens += row.total_tokens
    acc[row.feature].call_count += 1
    return acc
  }, {})

  const result = Object.entries(grouped)
    .map(([feature, stats]) => ({
      feature,
      label: FEATURE_LABELS[feature] ?? feature,
      total_tokens: stats.total_tokens,
      call_count: stats.call_count,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens)

  return NextResponse.json(result)
}
