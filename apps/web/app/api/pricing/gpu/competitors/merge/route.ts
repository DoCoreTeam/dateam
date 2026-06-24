import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdminApi } from '@/lib/auth/requireAdminApi'
import { revalidateGpu } from '@/lib/gpu/revalidate'
import { recordGpuAudit } from '@/lib/gpu/audit'
import {
  planCompetitorMerge,
  type CompetitorIdentity,
  type MappingLite,
} from '@/lib/gpu/resolve-competitor'

interface CompetitorRow {
  id: string
  name: string
  short_name: string | null
  website_url: string | null
  supplier_id: string | null
  color: string | null
  aliases: string[] | null
}

// POST /api/pricing/gpu/competitors/merge — 경쟁사 병합(캐노니컬 1개로 흡수)
//   { canonical_id, absorb_ids[] }
//   매핑 이관(충돌 시 시장가 이관 후 비활성) + 별칭 보존 + 흡수 회사 soft-delete. admin 전용.
export async function POST(request: Request) {
  const auth = await requireAdminApi()
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try { body = await request.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }

  const canonicalId = typeof body.canonical_id === 'string' ? body.canonical_id : ''
  const absorbIds = Array.isArray(body.absorb_ids)
    ? Array.from(new Set(body.absorb_ids.filter((x): x is string => typeof x === 'string' && x !== canonicalId)))
    : []
  if (!canonicalId) return NextResponse.json({ error: '대표(캐노니컬) 경쟁사를 지정하세요' }, { status: 400 })
  if (absorbIds.length === 0) return NextResponse.json({ error: '병합할 경쟁사를 1개 이상 선택하세요' }, { status: 400 })
  // 대량 오작동/오남용 가드(DC-SEC MEDIUM-1) — 정상 병합은 소수 표기 변형 수준.
  if (absorbIds.length > 50) return NextResponse.json({ error: '한 번에 최대 50개까지 병합할 수 있습니다' }, { status: 400 })
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(canonicalId) || !absorbIds.every((id) => UUID_RE.test(id))) {
    return NextResponse.json({ error: '경쟁사 식별자 형식 오류' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any

  try {
    // 1) 대상 회사 로드(soft-delete 안 된 것만)
    const allIds = [canonicalId, ...absorbIds]
    const { data: comps, error: compErr } = await db
      .from('competitors')
      .select('id, name, short_name, website_url, supplier_id, color, aliases')
      .in('id', allIds)
      .is('deleted_at', null)
    if (compErr) throw compErr
    const rows = (comps ?? []) as CompetitorRow[]
    const canonicalRow = rows.find((c) => c.id === canonicalId)
    if (!canonicalRow) return NextResponse.json({ error: '대표 경쟁사를 찾을 수 없습니다' }, { status: 404 })
    const absorbedRows = rows.filter((c) => absorbIds.includes(c.id))
    if (absorbedRows.length === 0) return NextResponse.json({ error: '병합 대상 경쟁사를 찾을 수 없습니다' }, { status: 404 })

    const toIdentity = (c: CompetitorRow): CompetitorIdentity => ({
      id: c.id, name: c.name, short_name: c.short_name, website_url: c.website_url, aliases: c.aliases,
    })

    // 2) 매핑 로드(활성/비활성 모두 — 이관/충돌 판정 위해)
    const { data: maps, error: mapErr } = await db
      .from('competitor_product_mapping')
      .select('id, competitor_id, gpu_product_id, pricing_model')
      .in('competitor_id', allIds)
    if (mapErr) throw mapErr
    const mappings = (maps ?? []) as MappingLite[]

    // 3) 순수 계획
    const plan = planCompetitorMerge(
      toIdentity(canonicalRow),
      absorbedRows.map(toIdentity),
      mappings,
    )

    // 4) 실행 — 단일 트랜잭션 RPC(merge_competitors_apply)로 원자 적용(DC-REV HIGH-1: 부분실패 방지).
    //    캐노니컬의 비어있는 도메인/공급사연결/색은 흡수 회사 값으로 보전.
    const firstNonNull = (key: 'website_url' | 'supplier_id' | 'color'): string | null =>
      canonicalRow[key] ?? absorbedRows.map((a) => a[key]).find((v) => v != null) ?? null
    const { error: rpcErr } = await db.rpc('merge_competitors_apply', {
      p_canonical: canonicalId,
      p_aliases: plan.aliases,
      p_repoint: plan.repointMappingIds,
      p_deactivate: plan.deactivateMappingIds,
      p_collisions: plan.collisions.map((c) => ({ from: c.fromMappingId, to: c.toMappingId })),
      p_absorbed: plan.absorbedIds,
      p_website: canonicalRow.website_url ? null : firstNonNull('website_url'),
      p_supplier: canonicalRow.supplier_id ? null : firstNonNull('supplier_id'),
      p_color: canonicalRow.color ? null : firstNonNull('color'),
    })
    if (rpcErr) throw rpcErr

    await recordGpuAudit(db, {
      actor: auth.user.email ?? auth.user.id,
      actionType: 'competitor_merged',
      detail: {
        canonical_id: canonicalId,
        absorbed_ids: plan.absorbedIds,
        repointed: plan.repointMappingIds.length,
        collisions: plan.collisions.length,
        aliases: plan.aliases,
      },
    })
    revalidateGpu()

    return NextResponse.json({
      ok: true,
      canonical_id: canonicalId,
      absorbed: plan.absorbedIds.length,
      mappings_repointed: plan.repointMappingIds.length,
      mappings_merged: plan.deactivateMappingIds.length,
      aliases: plan.aliases,
    })
  } catch (err) {
    console.error('[gpu/competitors/merge POST]', err)
    return NextResponse.json({ error: '경쟁사 병합에 실패했습니다' }, { status: 500 })
  }
}
