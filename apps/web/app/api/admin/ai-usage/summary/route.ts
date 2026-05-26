import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const adminClient = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = adminClient as any

  const { data: profile } = await adm.from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

  const [todayRes, monthRes, totalRes, metaRes] = await Promise.all([
    adm.from('ai_token_logs').select('total_tokens.sum()').gte('created_at', todayStart).maybeSingle(),
    adm.from('ai_token_logs').select('total_tokens.sum()').gte('created_at', monthStart).maybeSingle(),
    adm.from('ai_token_logs').select('total_tokens.sum()').maybeSingle(),
    adm.from('org_content').select('value').eq('key', 'META').single(),
  ])

  const meta = (metaRes.data?.value as Record<string, unknown>) ?? {}
  const threshold = typeof meta.ai_token_alert_threshold === 'number' ? meta.ai_token_alert_threshold : 1_000_000

  const todayTokens = (todayRes.data as { sum: number } | null)?.sum ?? 0
  const monthTokens = (monthRes.data as { sum: number } | null)?.sum ?? 0
  const totalTokens = (totalRes.data as { sum: number } | null)?.sum ?? 0

  return NextResponse.json({
    today_tokens: todayTokens,
    month_tokens: monthTokens,
    total_tokens: totalTokens,
    alert_threshold: threshold,
    month_usage_pct: threshold > 0 ? Math.round((monthTokens / threshold) * 1000) / 10 : 0,
    threshold_exceeded: monthTokens >= threshold,
  })
}
