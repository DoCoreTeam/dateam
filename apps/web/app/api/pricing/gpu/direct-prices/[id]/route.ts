import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// PATCH /api/pricing/gpu/direct-prices/[id] — 직접 판매가 수정
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const patch: Record<string, unknown> = {}
  if ('sell_price_krw' in body) {
    const v = Number(body.sell_price_krw)
    if (isNaN(v) || v <= 0) return NextResponse.json({ error: '판매가는 양수' }, { status: 400 })
    patch.sell_price_krw = v
  }
  if ('note' in body) patch.note = (typeof body.note === 'string' && body.note.trim()) ? body.note.trim() : null
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (createAdminClient() as any).from('direct_prices').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGpu()
  return NextResponse.json({ direct: data })
}

// DELETE /api/pricing/gpu/direct-prices/[id] — 직접 판매가 삭제(해당 행 제거 → 견적 기준으로 복귀)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (createAdminClient() as any).from('direct_prices').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGpu()
  return NextResponse.json({ ok: true })
}
