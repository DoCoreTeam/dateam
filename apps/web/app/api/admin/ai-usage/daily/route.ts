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

  const daysRaw = parseInt(req.nextUrl.searchParams.get('days') ?? '30', 10)
  const days = Number.isFinite(daysRaw) ? Math.min(365, Math.max(1, daysRaw)) : 30
  const since = new Date()
  since.setDate(since.getDate() - days)

  const { data: rows } = await adm
    .from('ai_token_logs')
    .select('created_at, total_tokens')
    .gte('created_at', since.toISOString()) as { data: { created_at: string; total_tokens: number }[] | null }

  const daily = (rows ?? []).reduce<Record<string, number>>((acc, row) => {
    const day = row.created_at.slice(0, 10)
    acc[day] = (acc[day] ?? 0) + row.total_tokens
    return acc
  }, {})

  // Fill missing days with 0
  const result: { date: string; total_tokens: number }[] = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const date = d.toISOString().slice(0, 10)
    result.push({ date, total_tokens: daily[date] ?? 0 })
  }

  return NextResponse.json(result)
}
