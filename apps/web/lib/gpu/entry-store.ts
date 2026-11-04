import 'server-only'

// 정해진 칸 입력 저장 — 이전 입력과 같은 길을 탄다: 검토 항목(review_items)을 만들고 확정 함수(confirmReviewItem)로 반영
// 관리자가 저장하면 그 자리에서 확정, 일반 회원이 저장하면 확정 대기로 남는다 (관리자가 검토 화면에서 확정)
// 줄 하나라도 칸이 틀리면 아무것도 저장하지 않는다, 틀린 칸을 줄 번호와 함께 돌려준다
// 검토 항목 쓰기는 서비스롤만 된다(마이그 092), 부르는 창구가 requireMemberApi 로 사람을 먼저 확인한다

import type { createClient, createAdminClient } from '@/lib/supabase/server'
import { confirmReviewItem, type ReviewItemRow } from '@/lib/gpu/confirm-review-item'
import { recordGpuAudit } from '@/lib/gpu/audit'
import { kstTodayKey } from '@/lib/datetime/kst'
import { validateEntries, toExtracted, type EntryError, type EntryProduct } from './entry'

type UserClient = Awaited<ReturnType<typeof createClient>>
type AdminClient = ReturnType<typeof createAdminClient>

/** 환율 칸이 비었거나 이상하면 확정 함수와 같은 기준으로 막는다 */
const FX_MIN = 800
const FX_MAX = 3000

export interface EntryLineResult {
  line: number
  status: 'confirmed' | 'pending'
  review_item_id: string
  /** 관리자 확정이 막혀 대기로 남은 까닭 */
  reason?: string
}

export type CreateEntriesResult =
  | { ok: true; confirmed: number; pending: number; lines: EntryLineResult[] }
  | { ok: false; status: 400 | 500; error: 'invalid' | 'no_fx'; errors?: EntryError[] }

export async function createEntries(
  userDb: UserClient,
  adminDb: AdminClient,
  actor: { name: string; isAdmin: boolean },
  rows: unknown[],
): Promise<CreateEntriesResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = adminDb as any
  const { data: products, error: productErr } = await admin
    .from('gpu_products').select('id, model_name, memory, gpu_count').is('deleted_at', null).eq('is_active', true)
  if (productErr) throw productErr
  const productList = (products ?? []) as EntryProduct[]

  const { entries, errors } = validateEntries(rows, productList, kstTodayKey())
  if (errors.length > 0 || entries.length === 0) return { ok: false, status: 400, error: 'invalid', errors }

  const { data: fx } = await admin.from('fx_rates').select('usd_krw').order('rate_date', { ascending: false }).limit(1).single()
  const krwPerUsd = Number(fx?.usd_krw)
  if (!(krwPerUsd >= FX_MIN && krwPerUsd <= FX_MAX)) return { ok: false, status: 500, error: 'no_fx' }

  const byId = new Map(productList.map((p) => [p.id, p]))
  const batchId = crypto.randomUUID()
  const insertRows = entries.map((e, idx) => {
    const product = byId.get(e.product_id) as EntryProduct
    return {
      source_batch_id: entries.length > 1 ? batchId : null,
      batch_index: idx,
      target: e.kind === 'market' ? 'competitor' : 'supplier',
      product_hint: `${product.model_name} ${product.memory ?? ''}`.trim(),
      supplier_hint: e.vendor,
      channel: 'own',
      impact_level: 'steady',
      status: 'pending',
      current_iteration: 1,
      current_extracted: toExtracted(e, product, krwPerUsd),
      overall_confidence: 100,
      is_test: false,
    }
  })
  const { data: inserted, error: insertErr } = await admin.from('review_items').insert(insertRows).select()
  if (insertErr) throw insertErr
  const items = (inserted ?? []) as ReviewItemRow[]

  await recordGpuAudit(adminDb, {
    actor: actor.name, actionType: 'review_created',
    detail: { via: 'entry', batch_id: batchId, count: items.length, review_item_ids: items.map((i) => i.id) },
  })

  const lines: EntryLineResult[] = []
  for (const [idx, item] of items.entries()) {
    const line = idx + 1
    if (!actor.isAdmin) {
      lines.push({ line, status: 'pending', review_item_id: item.id })
      continue
    }
    const result = await confirmReviewItem(userDb, adminDb, item, actor.name, { productId: entries[idx].product_id })
    lines.push(result.ok
      ? { line, status: 'confirmed', review_item_id: item.id }
      : { line, status: 'pending', review_item_id: item.id, reason: result.error ?? '확정하지 못했습니다' })
  }
  return {
    ok: true,
    confirmed: lines.filter((l) => l.status === 'confirmed').length,
    pending: lines.filter((l) => l.status === 'pending').length,
    lines,
  }
}
