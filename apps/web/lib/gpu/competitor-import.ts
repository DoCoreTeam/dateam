import { normalizeMemory } from '@/lib/gpu/normalize'
import { resolveProductId, type ResolveHeldReason } from '@/lib/gpu/resolve-product'
import { resolveCompetitorId, type CompetitorIdentity } from '@/lib/gpu/resolve-competitor'
import type { VariantCandidate } from '@/lib/gpu/resolve-product'
import { validateCompetitorItem, type Issue } from '@/lib/gpu/validate'
import { toComponentRow, type PriceComponent } from '@/lib/gpu/price-components'
import { canonicalizeModel } from '@/lib/gpu/canonical-model'
import { extractFormFactor } from '@/lib/gpu/form-factor'

export interface CompetitorPriceItem {
  competitor_name: string
  model_name: string
  memory?: string
  /** USD 정규화 가격(GPU 1장·1시간당). 통화 미상/환산불가면 null(저장 시 스킵). */
  price_usd: number | null
  pricing_model?: string
  notes?: string
  /** 원본 통화(ISO, 'KRW'|'USD'). 보존용 — price_usd는 fx 실환율 USD 정규화값. 미상이면 생략(기존행=USD 가정). */
  original_currency?: string | null
  /** 원본 통화 기준 금액(GPU 1장·1시간당). 보존용. */
  original_price?: number | null
  /** ── 관측 원본(확정 기획 P1) — 있으면 market_prices에 그대로 persist. 환산 전 진실값. ── */
  obs?: {
    amount?: number | null           // 관측 금액(obs_currency 기준, 환산 전)
    currency?: string | null         // ISO4217
    pricing_unit?: string | null     // minute|hour|day|month|year
    gpu_count?: number | null        // 이 금액이 포함하는 장수
    tax_basis?: string | null        // tax_excluded|tax_included|unknown
    bundle_inclusive?: boolean | null
    inclusions?: string | null
    segment?: string | null          // raw_gpu|managed_bundle
    comparable?: boolean | null
    fx_rate?: number | null          // 관측시점 환율 스냅샷(1통화=KRW)
    fx_rate_date?: string | null
    fx_source?: string | null
    observed_at?: string | null
    provenance?: string | null
    confirmed_by_kind?: string | null
    /** ── 관측 스펙 축(마이그168) — 인식했으면 반드시 남긴다 ──
     *  실측 사고: AI가 form_factor·memory를 정확히 인식하고도 담을 컬럼이 없어 매칭에만 쓰고 버렸다.
     *  그 결과 신규 모델(GB300) 등록 근거가 사라지고, 변형이 여럿인 모델은 메모리를 알면서도 보류됐다. */
    form_factor?: string | null      // SXM|PCIe|NVL (세대숫자 흡수)
    memory_gb?: number | null
    source_model?: string | null     // 원문 모델 라벨(캐노니컬 이전)
  }
  /**
   * 요금성분 N개(v0.7.351 §3) — 복합요금(기본료+종량+스토리지)의 무손실 진실.
   * 있으면 market_price_components(마이그165)에 관측 헤더와 함께 저장. 없으면 기존 obs_* 경로 그대로(하위호환).
   */
  components?: PriceComponent[]
}

export interface SaveCompetitorResult {
  saved: { competitor: string; model: string; memory: string; price_usd: number }[]
  /** 매칭 실패로 깡통 생성 대신 보류된 항목(사람 처리 필요). candidates=메모리 변형 후보(ambiguous_variant) */
  held: { model: string; reason: ResolveHeldReason; candidates?: VariantCandidate[] }[]
  /** H1 게이트(validate.ts) 차단 항목 — GPU 모델 아님(라벨 오추출)·가격 불가능범위($30,000 등). 저장 거부. */
  rejected: { model: string; issues: Issue[] }[]
}

export interface SaveCompetitorOptions {
  /** market_prices.source_url + 매핑 competitor_url 갱신용(웹 새로고침 경로) */
  sourceUrl?: string | null
  confidence?: number
  /** 사용자가 검토 화면에서 고른 카탈로그 변형 id(ambiguous_variant 해소). 있으면 resolveProductId 대신 이 변형에 직접 결합(기존 행만 — 깡통 생성 아님). 단일 item일 때만 의미. */
  targetProductId?: string | null
}

// 관측 원본(obs) → market_prices obs_* 컬럼 매핑(순수·테스트가능). null/undefined 필드는 생략(기존행 무변경).
export function buildObsColumns(obs?: CompetitorPriceItem['obs']): Record<string, unknown> {
  if (!obs) return {}
  const put = (v: unknown) => v !== null && v !== undefined
  const o: Record<string, unknown> = {}
  if (put(obs.amount)) o.obs_amount = obs.amount
  if (put(obs.currency)) o.obs_currency = obs.currency
  if (put(obs.pricing_unit)) o.obs_pricing_unit = obs.pricing_unit
  if (put(obs.gpu_count)) o.obs_gpu_count = obs.gpu_count
  if (put(obs.tax_basis)) o.obs_tax_basis = obs.tax_basis
  if (put(obs.bundle_inclusive)) o.obs_bundle_inclusive = obs.bundle_inclusive
  if (put(obs.inclusions)) o.obs_inclusions = obs.inclusions
  if (put(obs.segment)) o.obs_segment = obs.segment
  if (put(obs.comparable)) o.obs_comparable = obs.comparable
  if (put(obs.fx_rate)) o.fx_rate = obs.fx_rate
  if (put(obs.fx_rate_date)) o.fx_rate_date = obs.fx_rate_date
  if (put(obs.fx_source)) o.fx_source = obs.fx_source
  if (put(obs.provenance)) o.provenance = obs.provenance
  if (put(obs.confirmed_by_kind)) o.confirmed_by_kind = obs.confirmed_by_kind
  // 관측 스펙 축(마이그168) — 신규모델 등록 제안·변형 판별의 근거로 보존
  if (put(obs.form_factor)) o.obs_form_factor = obs.form_factor
  if (put(obs.memory_gb)) o.obs_memory_gb = obs.memory_gb
  if (put(obs.source_model)) o.obs_source_model = obs.source_model
  // observed_at은 insert에서 now()로 이미 설정 — obs.observed_at이 명시되면 우선.
  if (put(obs.observed_at)) o.observed_at = obs.observed_at
  return o
}

// 경쟁사 가격 DB 저장. 모델은 resolveProductId SSOT로 기존 변형에만 결합 — 매칭 실패 시 깡통 자동생성 금지(보류).
//   service_role(adminClient) 필요. (재사용·단일구현: confirm·refresh 양 경로가 이 함수만 호출)
export async function saveCompetitorPrices(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  items: CompetitorPriceItem[],
  opts: SaveCompetitorOptions = {},
): Promise<SaveCompetitorResult> {
  const sourceUrl = opts.sourceUrl ?? null
  const confidence = typeof opts.confidence === 'number' ? opts.confidence : 85
  const saved: SaveCompetitorResult['saved'] = []
  const held: SaveCompetitorResult['held'] = []
  const rejected: SaveCompetitorResult['rejected'] = []
  const now = new Date().toISOString()

  // 경쟁사 식별 SSOT — 기존 회사 1회 로드 후 도메인/별칭으로 해소(재발 중복 차단).
  //   매칭 실패 시에만 신규 생성하고 인메모리 목록에 추가 → 같은 배치 내 표기 변형도 한 회사로 흡수.
  const { data: allComps } = await db.from('competitors')
    .select('id, name, short_name, website_url, aliases').is('deleted_at', null)
  const existing: CompetitorIdentity[] = (allComps ?? []).map((c: Record<string, unknown>) => ({
    id: c.id as string,
    name: c.name as string,
    short_name: (c.short_name as string | null) ?? null,
    website_url: (c.website_url as string | null) ?? null,
    aliases: (c.aliases as string[] | null) ?? null,
  }))

  for (const item of items) {
    if (!item.competitor_name || !item.model_name || !item.price_usd) continue

    // H1 게이트(validate.ts SSOT) — 저장 경계 최종 방어. 미리보기가 게이트를 새더라도 여기서 차단.
    //   ① GPU 모델 아님(モデルプラン·サービス 등 라벨 오추출) ② 가격 불가능범위(¥→$ 둔갑된 $30,000 등).
    //   price_usd는 위 truthy 체크로 이미 존재 → preserveNoPrice 불요. block이면 저장 거부(깡통 오염 차단).
    const gate = validateCompetitorItem(item)
    if (!gate.ok) {
      rejected.push({ model: item.model_name, issues: gate.issues.filter((i) => i.severity === 'block') })
      continue
    }

    let competitorId: string
    const resolvedCompId = resolveCompetitorId(
      { name: item.competitor_name.trim(), website_url: sourceUrl },
      existing,
    )
    if (resolvedCompId) {
      competitorId = resolvedCompId
    } else {
      const compName = item.competitor_name.trim()
      const { data: newComp, error: compErr } = await db.from('competitors')
        .insert({ name: compName, short_name: compName.slice(0, 20), type: 'specialist', ...(sourceUrl ? { website_url: sourceUrl } : {}) })
        .select('id').single()
      if (compErr || !newComp) {
        // 조용한 드롭 금지(v0.7.362) — 실패를 rejected로 노출해 사용자가 "왜 안 들어갔는지" 알 수 있게 한다.
        console.error('[competitor] 경쟁사 생성 실패:', compErr?.message)
        rejected.push({ model: item.model_name, issues: [{ field: 'competitor', severity: 'block', msg: `경쟁사 생성 실패: ${compErr?.message ?? 'unknown'}` }] })
        continue
      }
      competitorId = newComp.id
      // 같은 배치 후속 항목이 이 회사로 해소되도록 인메모리 목록에 추가
      existing.push({ id: competitorId, name: compName, short_name: compName.slice(0, 20), website_url: sourceUrl, aliases: [] })
    }

    // 모델 변형 매칭 — resolveProductId SSOT(읽기 전용). 경쟁사 on-demand=1장. 매칭 실패 시 깡통 생성 대신 보류.
    // 단, 사용자가 검토 화면에서 변형을 직접 고른 경우(targetProductId)엔 그 기존 변형에 결합(ambiguous 해소).
    const memory = normalizeMemory(item.memory ?? '')
    let gpuProductId: string
    if (opts.targetProductId) {
      // 경쟁사 on-demand=1장 — 사용자가 고른 변형도 1장 구성인지 재검증(공급사 경로와 대칭, 오결합 차단).
      const { data: chosen } = await db.from('gpu_products').select('id, gpu_count').eq('id', opts.targetProductId).is('deleted_at', null).maybeSingle()
      if (!chosen?.id) { held.push({ model: item.model_name, reason: 'no_model' }); continue }
      if ((chosen.gpu_count ?? 1) !== 1) { held.push({ model: item.model_name, reason: 'no_variant' }); continue }
      gpuProductId = chosen.id as string
    } else {
      const resolved = await resolveProductId(db, { modelName: item.model_name, gpuCount: 1, memory: item.memory ?? null })
      if ('held' in resolved) {
        held.push({ model: item.model_name, reason: resolved.reason, candidates: resolved.candidates })
        // 보류를 "버림"이 아니라 "등록 대기"로 — 카탈로그에 아예 없는 모델(no_model)은 관측 근거와 함께
        //   후보 큐(마이그169)에 남긴다. 자동 생성은 여전히 금지(깡통 방지) — 사람이 보고 승인한다.
        //   실사고: GB300이 held되면 관측 스펙까지 사라져, 화면은 "스펙관리에서 등록하라"는데 근거가 없었다.
        if (resolved.reason === 'no_model') {
          await recordModelCandidate(db, item, sourceUrl)
        }
        continue
      }
      gpuProductId = resolved.productId
    }

    let mappingId: string
    const pricingModel = (item.pricing_model ?? 'on_demand').replace(/-/g, '_')
    const { data: existingMap } = await db.from('competitor_product_mapping').select('id')
      .eq('competitor_id', competitorId).eq('gpu_product_id', gpuProductId).eq('pricing_model', pricingModel).single()
    if (existingMap?.id) {
      mappingId = existingMap.id
      if (sourceUrl) await db.from('competitor_product_mapping').update({ competitor_url: sourceUrl }).eq('id', mappingId)
    } else {
      const sku = `${item.model_name} ${memory ?? ''} (${pricingModel})`.trim()
      const { data: newMap, error: mapErr } = await db.from('competitor_product_mapping')
        .insert({ competitor_id: competitorId, gpu_product_id: gpuProductId, competitor_sku: sku, pricing_model: pricingModel, is_active: true, ...(sourceUrl ? { competitor_url: sourceUrl } : {}) }).select('id').single()
      if (mapErr || !newMap) {
        // 실사고: pricing_model='reserved'가 DB CHECK에 없어 매핑 insert가 전부 실패했는데
        //   continue로 조용히 넘어가 월정액 번들이 통째로 유실됐다(SoftBank 저장행 on_demand 2건뿐).
        console.error('[competitor] 매핑 생성 실패:', mapErr?.message, { pricingModel })
        rejected.push({ model: item.model_name, issues: [{ field: 'mapping', severity: 'block', msg: `매핑 생성 실패(${pricingModel}): ${mapErr?.message ?? 'unknown'}` }] })
        continue
      }
      mappingId = newMap.id
    }

    const { data: obsRow, error: obsErr } = await db.from('market_prices').insert({
      mapping_id: mappingId, price_usd: item.price_usd, source_url: sourceUrl,
      source_type: sourceUrl ? 'webpage' : 'manual', recorded_at: now, observed_at: now,
      confidence, is_stale: false, ...(item.notes ? { notes: item.notes } : {}),
      // 원본 통화·금액 보존(W4) — 표시 시 fx 실환율로 양통화 병기. 미상이면 생략(기존행=USD 가정).
      ...(item.original_currency ? { original_currency: item.original_currency } : {}),
      ...(typeof item.original_price === 'number' ? { original_price: item.original_price } : {}),
      // 관측 원본(P1) — 추출이 obs를 주면 그대로 persist(환산 전 진실값). 없으면 생략(기존 경로 무변경).
      ...buildObsColumns(item.obs),
    }).select('id').single()
    if (obsErr) {
      console.error('[competitor] 관측 저장 실패:', obsErr.message)
      rejected.push({ model: item.model_name, issues: [{ field: 'observation', severity: 'block', msg: `관측 저장 실패: ${obsErr.message}` }] })
      continue
    }

    // 요금성분 1:N(마이그165) — 있을 때만. 실패해도 관측 헤더 저장은 되돌리지 않는다(유실0 > 정합, never-block).
    //   성분 저장 실패는 조용히 넘기지 않고 로그로 노출 — 사후 재적재 대상.
    if (obsRow?.id && item.components?.length) {
      const fxSnap = {
        rate: item.obs?.fx_rate ?? null,
        date: item.obs?.fx_rate_date ?? null,
        source: item.obs?.fx_source ?? null,
      }
      const rows = item.components.map((c) => ({ observation_id: obsRow.id, ...toComponentRow(c, fxSnap) }))
      const { error: compErr2 } = await db.from('market_price_components').insert(rows)
      if (compErr2) console.error('[competitor] 요금성분 저장 실패(관측은 저장됨):', compErr2.message, { observation_id: obsRow.id })
    }
    saved.push({ competitor: item.competitor_name, model: item.model_name, memory: memory ?? '', price_usd: item.price_usd })
  }
  return { saved, held, rejected }
}

/**
 * 카탈로그 미등록 모델 후보 기록(마이그169) — 같은 모델이 반복 관측되면 observed_count가 오른다.
 *   never-block: 후보 기록 실패가 시세 저장을 막지 않는다(로그만).
 */
async function recordModelCandidate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  item: CompetitorPriceItem,
  sourceUrl: string | null,
): Promise<void> {
  try {
    const raw = item.obs?.source_model ?? item.model_name
    const { core, formFactor } = extractFormFactor(canonicalizeModel(raw).canonical || raw)
    const ff = item.obs?.form_factor ?? formFactor ?? null
    const key = `${core.toLowerCase().replace(/[\s\-_]+/g, '')}|${ff ?? ''}`
    const now = new Date().toISOString()
    const { data: existing } = await db.from('gpu_model_candidates')
      .select('id, observed_count').eq('candidate_key', key).maybeSingle()
    if (existing?.id) {
      await db.from('gpu_model_candidates')
        .update({ observed_count: (existing.observed_count ?? 1) + 1, last_seen_at: now })
        .eq('id', existing.id)
      return
    }
    await db.from('gpu_model_candidates').insert({
      candidate_key: key,
      source_model: raw,
      model_core: core,
      form_factor: ff,
      memory_gb: item.obs?.memory_gb ?? null,
      competitor: item.competitor_name,
      source_url: sourceUrl,
    })
  } catch (e) {
    console.error('[competitor] 모델 후보 기록 실패(시세 저장에는 영향 없음):', e instanceof Error ? e.message : e)
  }
}
