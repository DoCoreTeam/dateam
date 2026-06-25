import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { dedupSupplier } from '@/lib/gpu/dedup'
import { partitionValid, validateSupplierItem, MAX_INTAKE_ITEMS } from '@/lib/gpu/validate'
import { normalizeExtractedModel } from '@/lib/gpu/canonical-model'

// 공급가 미리보기 → 검토 대기 저장(버튼 클릭 시). stream 엔드포인트가 추출한 items를 받아 review_items INSERT.
// 분리 이유: 추출(미리보기)과 저장(사용자 확인)을 명확히 나눔 — 경쟁사 market/import와 동일 패턴.

interface PreviewItem {
  extracted?: Record<string, unknown>
  confidence?: Record<string, number | null>
  evidence?: Record<string, string | null>
  impact_assessment?: { level?: string }
}

export async function POST(req: NextRequest) {
  // 통합입력 제출(검토대기 저장) — 내부 임직원(admin+member) 허용. review_items(검토대기 staging)에만 적재.
  // 라이브 반영/확정(market/import·review 승인)은 admin 유지 — 제출↔확정 권한 분리.
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const user = auth.user

  let body: { items?: unknown; channel?: unknown; is_test?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const allItems = Array.isArray(body.items) ? (body.items as PreviewItem[]) : []
  const truncated = Math.max(0, allItems.length - MAX_INTAKE_ITEMS) // 무음 소실 방지(RC-D) — 응답에 노출
  const items = allItems.slice(0, MAX_INTAKE_ITEMS)
  const channel = typeof body.channel === 'string' ? body.channel : 'own'
  const isTest = body.is_test === true
  const adminClient = createAdminClient()

  // 검증 게이트(H1, lib/gpu/validate) — enum·범위·이상치 위반 항목은 격리(저장 차단), 통과분만 진행.
  //  preserveNoPrice: 미리보기와 동일 정책(RC-C 비대칭 제거) — 무가격 행은 차단 대신 warn로 보존,
  //  검토 큐(review_items)에 flag로 남겨 사람이 판단. "미리보기엔 보였는데 저장하니 사라짐" 방지.
  const { passed, blocked } = partitionValid(items, (it) => validateSupplierItem(it, { preserveNoPrice: true }))
  // 공용 dedup(lib/gpu/dedup) — 저장 직전 중복 제거(방어적). 추출 단계와 동일 키 = 단일 구현 재사용.
  const valid = dedupSupplier(passed)
  if (valid.length === 0) {
    return NextResponse.json({ error: '저장 가능한 항목이 없습니다 (검증 차단)', blocked: blocked.map((b) => b.issues) }, { status: 422 })
  }

  const batchId = crypto.randomUUID()
  const insertRows = valid.map((item, idx) => {
    const conf = item.confidence ?? {}
    const confValues = Object.values(conf).filter((v): v is number => typeof v === 'number')
    const overallConf = confValues.length > 0 ? Math.round(confValues.reduce((a, b) => a + b, 0) / confValues.length) : null
    const impactLevel = (item.impact_assessment?.level ?? 'steady') as string
    const ex = item.extracted ?? {}
    normalizeExtractedModel(ex)   // 입구 정규화(재발방지·SSOT) — 공급사명 prefix 제거
    return {
      source_batch_id: valid.length > 1 ? batchId : null,
      batch_index: idx,
      product_hint: typeof ex.model_name === 'string' ? `${ex.model_name} ${ex.memory ?? ''}`.trim() : null,
      supplier_hint: typeof ex.supplier === 'string' ? ex.supplier : null,
      channel,
      impact_level: impactLevel,
      status: 'pending',
      current_iteration: 1,
      current_extracted: ex,
      current_confidence: item.confidence ?? null,
      overall_confidence: overallConf,
      is_test: isTest,
    }
  })

  // 092 RLS: review_items 쓰기는 service_role 전용 → adminClient (user-client는 거부됨)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inserted, error } = await (adminClient as any).from('review_items').insert(insertRows).select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const arr = (inserted ?? []) as Array<{ id: string }>

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient as any).from('gpu_audit_logs').insert({
    actor: user.email ?? user.id,
    action_type: 'review_created',
    detail: { batch_id: valid.length > 1 ? batchId : null, count: arr.length, review_item_ids: arr.map((i) => i.id), is_test: isTest, via: 'stream-commit', blocked: blocked.length },
  }).then(undefined, () => {})

  return NextResponse.json({ ok: true, count: arr.length, items: arr, blocked: blocked.length, truncated })
}
