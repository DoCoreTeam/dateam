import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// PATCH /api/pricing/gpu/market/competitors/[id] — 경쟁사 ↔ 공급사 연결/해제
//   body { supplier_id: uuid }  → 연결
//   body { supplier_id: null }  → 해제
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  const { id } = await params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: '경쟁사 ID 형식 오류' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  if (!('supplier_id' in body)) {
    return NextResponse.json({ error: 'supplier_id 필수(연결 해제는 null)' }, { status: 400 })
  }

  // 정규화: '' → null. 그 외엔 uuid 검증.
  const raw = body.supplier_id
  const supplierId: string | null =
    raw === null || raw === '' ? null : (typeof raw === 'string' ? raw : '__invalid__')
  if (supplierId === '__invalid__' || (supplierId !== null && !UUID_RE.test(supplierId))) {
    return NextResponse.json({ error: 'supplier_id는 uuid 또는 null이어야 합니다' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  // 대상 경쟁사 존재 확인
  const { data: comp, error: compErr } = await db
    .from('competitors')
    .select('id, name, supplier_id')
    .eq('id', id)
    .maybeSingle()
  if (compErr) {
    console.error('[market/competitors/[id] PATCH] lookup', compErr)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }
  if (!comp) {
    return NextResponse.json({ error: '경쟁사를 찾을 수 없습니다' }, { status: 404 })
  }

  // 연결 시 공급사 실재 확인 (FK가 있으나 명시적 400 메시지 제공)
  if (supplierId !== null) {
    const { data: sup, error: supErr } = await db
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .maybeSingle()
    if (supErr) {
      console.error('[market/competitors/[id] PATCH] supplier lookup', supErr)
      return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
    }
    if (!sup) {
      return NextResponse.json({ error: '연결할 공급사를 찾을 수 없습니다' }, { status: 400 })
    }
  }

  const { data, error } = await db
    .from('competitors')
    .update({ supplier_id: supplierId })
    .eq('id', id)
    .select('id, name, supplier_id')
    .single()
  if (error) {
    console.error('[market/competitors/[id] PATCH] update', error)
    return NextResponse.json({ error: '요청 처리 실패' }, { status: 500 })
  }

  await recordGpuAudit(db, {
    actor: auth.user.email ?? auth.user.id,
    actionType: 'market_price_updated',
    detail: {
      op: 'competitor_supplier_link',
      competitor_id: id,
      before_supplier_id: comp.supplier_id ?? null,
      after_supplier_id: supplierId,
    },
  })

  revalidateGpu()
  return NextResponse.json({ competitor: data })
}
