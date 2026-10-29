import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sumTokens, type TokenRow } from '@/lib/ai/token-summary'

/** 한 번에 받는 줄 수. PostgREST 기본 상한(1000)과 같게 둔다 */
const PAGE = 1000

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // 집계(.sum())는 PostgREST 가 막아 PGRST123 이 난다. 줄을 받아 sumTokens 가 KST 경계로 더한다
  const rows: TokenRow[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await adm.from('ai_token_logs')
      .select('created_at, total_tokens').order('id', { ascending: true }).range(from, from + PAGE - 1)
    // supabase-js 는 오류를 던지지 않고 돌려준다. 안 읽으면 카드가 조용히 0 이 된다
    if (error) {
      console.error('[ai-usage/summary] 토큰 기록 읽기 실패', error.message ?? error)
      return NextResponse.json({ error: '사용량을 읽지 못했습니다.' }, { status: 500 })
    }
    rows.push(...((data ?? []) as TokenRow[]))
    if (!data || data.length < PAGE) break
  }
  const metaRes = await adm.from('org_content').select('value').eq('key', 'META').single()

  const meta = (metaRes.data?.value as Record<string, unknown>) ?? {}
  const threshold = typeof meta.ai_token_alert_threshold === 'number' ? meta.ai_token_alert_threshold : 1_000_000

  const { today_tokens: todayTokens, month_tokens: monthTokens, total_tokens: totalTokens } = sumTokens(rows)

  return NextResponse.json({
    today_tokens: todayTokens,
    month_tokens: monthTokens,
    total_tokens: totalTokens,
    alert_threshold: threshold,
    month_usage_pct: threshold > 0 ? Math.round((monthTokens / threshold) * 1000) / 10 : 0,
    threshold_exceeded: monthTokens >= threshold,
  })
}
