import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

// DELETE /api/pricing/gpu/market/prices?id=<priceId> — 경쟁가 소프트삭제
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { error } = await db
    .from('market_prices')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .is('deleted_at', null)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_deleted',
    detail: { market_price_id: id },
  })

  revalidateGpu()
  return NextResponse.json({ success: true })
}

// PATCH /api/pricing/gpu/market/prices?id=<priceId> — 경쟁가 수정 (C3)
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  if ('price_usd' in body) {
    const v = Number(body.price_usd)
    if (isNaN(v) || v <= 0) return NextResponse.json({ error: 'price_usd는 양수' }, { status: 400 })
    patch.price_usd = v
  }
  if ('notes' in body) patch.notes = (typeof body.notes === 'string' && body.notes.trim()) ? body.notes.trim() : null
  if ('source_url' in body) patch.source_url = (typeof body.source_url === 'string' && body.source_url.trim()) ? body.source_url.trim() : null
  if ('confidence' in body) {
    const c = Number(body.confidence)
    if (!isNaN(c) && c >= 0 && c <= 100) patch.confidence = Math.round(c)
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경 필드 없음' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db
    .from('market_prices')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '경쟁가를 찾을 수 없습니다' }, { status: 404 })

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { market_price_id: id, patch },
  })

  revalidateGpu()
  return NextResponse.json({ success: true, data })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { mapping_id, price_usd, source_url, source_type, pricing_model, notes } = body

    if (!mapping_id || !price_usd) {
      return NextResponse.json({ error: 'mapping_id and price_usd are required' }, { status: 400 })
    }
    if (typeof price_usd !== 'number' || price_usd <= 0) {
      return NextResponse.json({ error: 'price_usd must be a positive number' }, { status: 400 })
    }

    const supabase = await createClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any

    const now = new Date().toISOString()
    const { data, error } = await db.from('market_prices').insert({
      mapping_id,
      price_usd,
      source_url: source_url || null,
      source_type: source_type || 'manual',
      notes: notes || null,
      recorded_at: now,
      observed_at: now,
      confidence: 90,
      is_stale: false,
    }).select().single()

    if (error) throw error

    return NextResponse.json({ success: true, data })
  } catch (err) {
    console.error('[market/prices POST]', err)
    return NextResponse.json({ error: 'Failed to register price' }, { status: 500 })
  }
}
