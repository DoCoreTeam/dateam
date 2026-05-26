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
    adm.from('ai_token_logs').select('total_tokens').gte('created_at', todayStart),
    adm.from('ai_token_logs').select('total_tokens').gte('created_at', monthStart),
    adm.from('ai_token_logs').select('total_tokens'),
    adm.from('org_content').select('value').eq('key', 'META').single(),
  ])

  const sum = (rows: { total_tokens: number }[] | null) =>
    rows?.reduce((s, r) => s + r.total_tokens, 0) ?? 0

  const meta = (metaRes.data?.value as Record<string, unknown>) ?? {}
  const threshold = typeof meta.ai_token_alert_threshold === 'number' ? meta.ai_token_alert_threshold : 1_000_000

  const todayTokens = sum(todayRes.data)
  const monthTokens = sum(monthRes.data)
  const totalTokens = sum(totalRes.data)

  return NextResponse.json({
    today_tokens: todayTokens,
    month_tokens: monthTokens,
    total_tokens: totalTokens,
    alert_threshold: threshold,
    month_usage_pct: threshold > 0 ? Math.round((monthTokens / threshold) * 1000) / 10 : 0,
    threshold_exceeded: monthTokens >= threshold,
  })
}
