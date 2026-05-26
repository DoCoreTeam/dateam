import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

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
  const from = fromRaw && ISO_DATE_RE.test(fromRaw) ? fromRaw : null
  const to = toRaw && ISO_DATE_RE.test(toRaw) ? toRaw : null

  let query = adm.from('ai_token_logs').select('user_id, total_tokens, created_at')
  if (from) query = query.gte('created_at', `${from}T00:00:00.000Z`)
  if (to) query = query.lte('created_at', `${to}T23:59:59.999Z`)

  const { data: rows } = await query as { data: { user_id: string | null; total_tokens: number; created_at: string }[] | null }

  const grouped = (rows ?? []).reduce<Record<string, { total_tokens: number; call_count: number; last_at: string }>>((acc, row) => {
    const key = row.user_id ?? 'unknown'
    if (!acc[key]) acc[key] = { total_tokens: 0, call_count: 0, last_at: row.created_at }
    acc[key].total_tokens += row.total_tokens
    acc[key].call_count += 1
    if (row.created_at > acc[key].last_at) acc[key].last_at = row.created_at
    return acc
  }, {})

  const userIds = Object.keys(grouped).filter((id) => id !== 'unknown')
  const { data: profiles } = await adm
    .from('profiles')
    .select('id, name')
    .in('id', userIds) as { data: { id: string; name: string }[] | null }

  const nameMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.name]))

  const result = Object.entries(grouped)
    .map(([user_id, stats]) => ({
      user_id,
      name: nameMap[user_id] ?? (user_id === 'unknown' ? '시스템' : '알 수 없음'),
      total_tokens: stats.total_tokens,
      call_count: stats.call_count,
      last_at: stats.last_at,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens)

  return NextResponse.json(result)
}
