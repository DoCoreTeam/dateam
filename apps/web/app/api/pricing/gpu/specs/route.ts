import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { baseModelKey, baseModelName } from '@/lib/gpu/canonical-model'
import { extractFormFactor, type FormFactor } from '@/lib/gpu/form-factor'

interface ConfigRow {
  id: string; gpu_count: number; memory: string | null
  vcpu: number | null; ram_gb: number | null; storage_gb: number | null; series: string | null
}
// 변형(폼팩터) 단위 — model_name 하나 = 한 변형. 기존 ModelRow와 동형이라 SpecModal이 그대로 재사용.
interface Variant {
  model_name: string; form_factor: FormFactor | null; tier: number; memory: string | null
  spec: Record<string, unknown> | null; has_spec: boolean; configs: ConfigRow[]
}
// base 모델 그룹 — "H100" 하나에 폼팩터 변형(generic/SXM/PCIe/NVL)을 하위로 묶는다.
interface ModelGroup {
  base_key: string; base_name: string; tier: number; config_count: number; variants: Variant[]
}

// 폼팩터 표시 순서: generic(null) → SXM → PCIe → NVL
const FF_ORDER: Record<string, number> = { SXM: 1, PCIe: 2, NVL: 3 }
const ffRank = (f: FormFactor | null): number => (f ? FF_ORDER[f] ?? 9 : 0)

// GET /api/pricing/gpu/specs
//  실제 gpu_products를 base 모델(캐노니컬)로 그룹핑 → 폼팩터 하위축 → 구성(장수) 배열. gpu_specs 조인.
//  "H100 SXM/PCIe/NVL/H100"이 한 "H100" 그룹으로 묶여 화면에 1종으로 뜬다(그룹핑 SSOT=baseModelKey).
export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
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

  // 1) model_name 단위 변형 조립 (폼팩터는 model_name에서 파생 — baseModelKey와 동일 SSOT)
  const byVariant = new Map<string, Variant>()
  for (const p of products ?? []) {
    const key = p.model_name as string
    if (!byVariant.has(key)) {
      byVariant.set(key, {
        model_name: key, form_factor: extractFormFactor(key).formFactor,
        tier: p.tier, memory: p.memory,
        spec: specByModel.get(key) ?? null, has_spec: specByModel.has(key), configs: [],
      })
    }
    byVariant.get(key)!.configs.push({
      id: p.id, gpu_count: p.gpu_count, memory: p.memory,
      vcpu: p.vcpu, ram_gb: p.ram_gb, storage_gb: p.storage_gb, series: p.series,
    })
  }

  // 2) base 모델로 그룹핑 (폼팩터를 하위로 접음)
  const byBase = new Map<string, ModelGroup>()
  for (const v of Array.from(byVariant.values())) {
    const bk = baseModelKey(v.model_name)
    if (!byBase.has(bk)) {
      byBase.set(bk, { base_key: bk, base_name: baseModelName(v.model_name), tier: v.tier, config_count: 0, variants: [] })
    }
    const g = byBase.get(bk)!
    g.variants.push(v)
    g.config_count += v.configs.length
    g.tier = Math.min(g.tier, v.tier)   // 그룹 tier = 최상위(데이터센터=1 우선)
  }
  for (const g of Array.from(byBase.values())) {
    g.variants.sort((a: Variant, b: Variant) => ffRank(a.form_factor) - ffRank(b.form_factor) || a.model_name.localeCompare(b.model_name))
  }

  return NextResponse.json({ models: Array.from(byBase.values()) })
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
