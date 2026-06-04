import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// PATCH /api/pricing/gpu/partner-tiers/[id] — 파트너 등급 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if ('name' in body) { const n = String(body.name).trim(); if (!n) return NextResponse.json({ error: '등급명 필요' }, { status: 400 }); patch.name = n }
  if ('discount_rate' in body) {
    const v = Number(body.discount_rate)
    if (isNaN(v) || v < 0 || v > 100) return NextResponse.json({ error: '할인율 0~100' }, { status: 400 })
    patch.discount_rate = v
  }
  if ('description' in body) patch.description = (typeof body.description === 'string' && body.description.trim()) || null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('partner_tiers').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ tier: data })
}

// DELETE /api/pricing/gpu/partner-tiers/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient() as any).from('partner_tiers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
