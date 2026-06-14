import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

// GET /api/pricing/gpu/market/prices?mapping_id=<id>[&limit=N] — 시세 이력(시계열)
//   통합 표 상세 패널 "시장 비교 > 시세 이력"용. 읽기 전용(member 읽기 허용·RLS).
export async function GET(req: NextRequest) {
  try {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
    const { searchParams } = new URL(req.url)
    const mappingId = searchParams.get('mapping_id')
    if (!mappingId) return NextResponse.json({ error: 'mapping_id 필수' }, { status: 400 })

    const limitRaw = Number(searchParams.get('limit') ?? '100')
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any
    const { data, error } = await db
      .from('market_prices')
      .select('id, mapping_id, price_usd, source_url, source_type, notes, recorded_at')
      .eq('mapping_id', mappingId)
      .is('deleted_at', null)
      .order('recorded_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    return NextResponse.json({ prices: data ?? [] })
  } catch (err) {
    console.error('[market/prices GET]', err)
    return NextResponse.json({ error: 'Failed to fetch market price history' }, { status: 500 })
  }
}

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

  if (error) {
    console.error('[market/prices DELETE]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

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

  if (error) {
    console.error('[market/prices PATCH]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
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
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 })
  }

  const { mapping_id, price_usd, source_url, source_type, notes } = body as {
    mapping_id?: unknown; price_usd?: unknown; source_url?: unknown; source_type?: unknown; notes?: unknown
  }

  if (!mapping_id || typeof mapping_id !== 'string') {
    return NextResponse.json({ error: 'mapping_id 필수' }, { status: 400 })
  }
  if (typeof price_usd !== 'number' || !Number.isFinite(price_usd) || price_usd <= 0) {
    return NextResponse.json({ error: 'price_usd는 양수여야 합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const now = new Date().toISOString()
  const { data, error } = await db.from('market_prices').insert({
    mapping_id,
    price_usd,
    source_url: (typeof source_url === 'string' && source_url.trim()) ? source_url.trim() : null,
    source_type: (typeof source_type === 'string' && source_type.trim()) ? source_type.trim() : 'manual',
    notes: (typeof notes === 'string' && notes.trim()) ? notes.trim() : null,
    recorded_at: now,
    observed_at: now,
    confidence: 90,
    is_stale: false,
  }).select().single()

  if (error) {
    console.error('[market/prices POST]', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: { mapping_id, price_usd, market_price_id: data?.id },
  })

  revalidateGpu()
  return NextResponse.json({ success: true, data })
}
