import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'

// GET /api/pricing/gpu/specs
//  실제 gpu_products의 모델(임의 X)별로 gpu_specs를 조인해 반환.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: products } = await db
    .from('gpu_products')
    .select('id, model_name, tier, memory, gpu_count, vcpu, ram_gb, storage_gb, series')
    .order('tier').order('model_name').order('gpu_count')
  const { data: specs } = await db.from('gpu_specs').select('*')

  const specByModel = new Map<string, Record<string, unknown>>()
  for (const s of specs ?? []) specByModel.set(s.model_name as string, s)

  // 모델 단위 그룹 (구성=gpu_products 인스턴스 스펙 배열 포함 — 4탭 표시 스펙의 단일 편집 소스)
  const byModel = new Map<string, Record<string, unknown>>()
  for (const p of products ?? []) {
    const key = p.model_name as string
    if (!byModel.has(key)) {
      byModel.set(key, {
        model_name: key, tier: p.tier, memory: p.memory,
        spec: specByModel.get(key) ?? null, has_spec: specByModel.has(key),
        configs: [],
      })
    }
    ;(byModel.get(key)!.configs as Record<string, unknown>[]).push({
      id: p.id, gpu_count: p.gpu_count, memory: p.memory,
      vcpu: p.vcpu, ram_gb: p.ram_gb, storage_gb: p.storage_gb, series: p.series,
    })
  }
  return NextResponse.json({ models: Array.from(byModel.values()) })
}

const EDITABLE = [
  'architecture', 'vram_gb', 'vram_type', 'cuda_cores', 'tensor_cores',
  'fp16_tflops', 'bf16_tflops', 'fp8_tflops', 'nvlink', 'nvlink_bandwidth',
  'tdp_w', 'interface', 'mig_support', 'release_year', 'datasheet_url', 'notes',
] as const

// PATCH /api/pricing/gpu/specs  — body: { model_name, ...fields }  (사람 수정 → upsert)
export async function PATCH(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const modelName = typeof body.model_name === 'string' ? body.model_name : ''
  if (!modelName) return NextResponse.json({ error: 'model_name 필요' }, { status: 400 })

  const patch: Record<string, unknown> = {
    model_name: modelName,
    ai_generated: false,            // 사람 수정 표기
    edited_by: auth.user.email ?? auth.user.id,
    updated_at: new Date().toISOString(),
  }
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data, error } = await db.from('gpu_specs').upsert(patch, { onConflict: 'model_name' }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ spec: data })
}

// DELETE /api/pricing/gpu/specs?model_name=<m> — 칩 데이터시트 삭제(스펙 초기화)
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const modelName = new URL(req.url).searchParams.get('model_name')
  if (!modelName) return NextResponse.json({ error: 'model_name 필요' }, { status: 400 })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { error } = await db.from('gpu_specs').delete().eq('model_name', modelName)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
