import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'

// 신규 모델 후보 큐(마이그169) — 카탈로그 미등록 관측을 등록 대기로 보존.
//   자동 생성은 여전히 금지(깡통 방지). 여기서 admin이 확인해 승인(gpu_products 생성)/거부한다.

// GET — pending 후보 목록(자주 관측된 순)
export async function GET() {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  const db = createAdminClient() as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (k: string, v: string) => { order: (c: string, o: { ascending: boolean }) => Promise<{ data: unknown[] | null; error: { message: string } | null }> }
      }
    }
  }
  const { data, error } = await db.from('gpu_model_candidates')
    .select('id, source_model, model_core, form_factor, memory_gb, competitor, source_url, observed_count, first_seen_at, last_seen_at')
    .eq('status', 'pending')
    .order('observed_count', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ candidates: data ?? [] })
}

// POST — 후보 승인(register: gpu_products 생성) 또는 거부(reject)
export async function POST(req: NextRequest) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error
  let body: { id?: unknown; action?: unknown; tier?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad request' }, { status: 400 }) }
  const id = typeof body.id === 'string' ? body.id : ''
  const action = body.action === 'register' || body.action === 'reject' ? body.action : null
  if (!id || !action) return NextResponse.json({ error: 'id·action 필수' }, { status: 400 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const now = new Date().toISOString()
  const { data: cand, error: readErr } = await db.from('gpu_model_candidates')
    .select('id, model_core, form_factor, memory_gb, status').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!cand) return NextResponse.json({ error: '후보를 찾을 수 없습니다' }, { status: 404 })
  if (cand.status !== 'pending') return NextResponse.json({ error: '이미 처리된 후보입니다' }, { status: 409 })

  if (action === 'reject') {
    await db.from('gpu_model_candidates').update({ status: 'rejected', resolved_at: now, resolved_by: auth.user?.id ?? null }).eq('id', id)
    return NextResponse.json({ ok: true, action: 'rejected' })
  }

  // register — 폼팩터가 있으면 "core FF"(예 "GB300 SXM"), 없으면 core만. gpu_products에 1장 구성으로 생성.
  const modelName = [cand.model_core, cand.form_factor].filter(Boolean).join(' ')
  const memory = cand.memory_gb ? `${cand.memory_gb}GB` : null
  // 중복 방어 — 같은 이름이 이미 있으면 생성하지 않고 후보만 처리 완료.
  const { data: existing } = await db.from('gpu_products').select('id').eq('model_name', modelName).is('deleted_at', null).maybeSingle()
  if (!existing?.id) {
    const { error: insErr } = await db.from('gpu_products').insert({
      model_name: modelName,
      form_factor: cand.form_factor ?? null,
      ...(memory ? { memory } : {}),
      tier: typeof body.tier === 'number' && [1, 2, 3].includes(body.tier) ? body.tier : 2,
      pricing_mode: 'quote',
      gpu_count: 1,
    })
    if (insErr) return NextResponse.json({ error: `모델 생성 실패: ${insErr.message}` }, { status: 500 })
  }
  await db.from('gpu_model_candidates').update({ status: 'registered', resolved_at: now, resolved_by: auth.user?.id ?? null }).eq('id', id)
  await revalidateGpu()
  return NextResponse.json({ ok: true, action: 'registered', model_name: modelName, already_existed: !!existing?.id })
}
