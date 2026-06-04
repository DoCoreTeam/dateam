import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// PATCH /api/pricing/gpu/products/[id] — 구성(gpu_products)의 인스턴스 스펙 수정
//  가격표·시장비교·재고·고객판매가격표 4탭이 공통으로 표시하는 스펙(VRAM/vCPU/RAM/SSD)의 단일 편집 지점.
const SPEC_FIELDS = ['memory', 'vcpu', 'ram_gb', 'storage_gb', 'series'] as const

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const patch: Record<string, unknown> = {}
  for (const k of SPEC_FIELDS) {
    if (!(k in body)) continue
    const v = body[k]
    if (k === 'memory' || k === 'series') patch[k] = (typeof v === 'string' && v.trim()) ? v.trim() : null
    else patch[k] = (v === '' || v === null) ? null : Number(v)   // vcpu/ram_gb/storage_gb (storage_gb nullable)
  }
  // 필수: vcpu/ram_gb는 null 불가
  if ('vcpu' in patch && patch.vcpu == null) return NextResponse.json({ error: 'vCPU는 비울 수 없습니다' }, { status: 400 })
  if ('ram_gb' in patch && patch.ram_gb == null) return NextResponse.json({ error: 'RAM은 비울 수 없습니다' }, { status: 400 })
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: '변경할 필드가 없습니다' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('gpu_products').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  revalidateGpu()
  return NextResponse.json({ product: data })
}

// DELETE /api/pricing/gpu/products/[id] — 구성 삭제 (확정 견적 연결 시 차단 — 정합성)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const { id } = await params
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  const { count } = await db.from('supply_quotes').select('id', { count: 'exact', head: true }).eq('product_id', id)
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: `견적 ${count}건이 연결되어 삭제할 수 없습니다. 견적을 먼저 정리하세요.` }, { status: 409 })
  }
  const { error } = await db.from('gpu_products').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  revalidateGpu()
  return NextResponse.json({ ok: true })
}
