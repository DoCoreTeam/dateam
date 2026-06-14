import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('partner_tiers')
    .select('id, name, discount_rate, description')
    .order('discount_rate', { ascending: false })
  return NextResponse.json({ tiers: data ?? [] })
}

// POST /api/pricing/gpu/partner-tiers — 파트너 등급 생성
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const discount_rate = Number(body.discount_rate)
  if (!name) return NextResponse.json({ error: '등급명 필요' }, { status: 400 })
  if (isNaN(discount_rate) || discount_rate < 0 || discount_rate > 100) return NextResponse.json({ error: '할인율 0~100' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('partner_tiers')
    .insert({ name, discount_rate, description: (typeof body.description === 'string' && body.description.trim()) || null }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tier: data })
}
