// L2 — GPU 가격 SSOT (단일 읽기 파생 지점)
//
// 모든 메뉴(가격표/시장비교/재고/고객판매가)는 이 util의 effective 값을 읽는다.
// 라우트가 제각각 재조인하지 않게 하여 "메뉴 간 가격 불일치"를 구조적으로 제거한다.
//
// 단위 표준 (docs 04 §6 D1):
//   supply_quotes.unit_price_usd = 그 구성(gpu_count) 전체의 시간당 총액
//   per_gpu = unit_price_usd / gpu_count  ← 1장당 단가 (여기서만 산출)
//
// 1장당 전파 (docs 01 §1, 03 §6):
//   모델 그룹의 "최저 1장당 단가"(bestPerGpu)를 모든 구성에 전파.
//   effective_unit_price_usd(config) = min(자기 구성 최저 견적, bestPerGpu × 구성 장수)
//   전파로 산출된 값은 is_propagated=true (UI '추정' 배지 근거).

export interface ConfirmedQuote {
  id?: string
  product_id: string
  supplier_id: string | null
  unit_price_usd: number
  gpu_count: number
  valid_until: string | null
  /** 'cost'=진짜 매입원가(계산 사용) | 'list'=자사·경쟁 공시 판매가(참고용, 계산 제외) */
  price_type?: 'cost' | 'list'
  /** 상품별 고객가격표 기준으로 채택된 견적 여부 */
  is_selected?: boolean
  /** 지정 적용 범위: 'config'=이 구성만 | 'model'=모델 전체(파생구성이 전파로 상속). is_selected=true일 때만 의미. */
  selection_scope?: 'config' | 'model' | null
  /** 약정 기간 라벨(예: '1개월 이상'). 전파 구성은 모태 견적의 약정을 그대로 상속 표시. */
  term?: string | null
  /** 견적 출처. 'market_link'=경쟁사 시장가 추종(추종가), 그 외(mail/pdf/own…)=실제 공급사 견적(실견적).
   *  실견적 우선 규칙에 사용 — 같은 product+supplier에 유효 실견적 있으면 추종가는 제외. */
  source_format?: string | null
  supplier?: { name: string; color: string } | null
}

export interface SupplierLite {
  id: string
  name: string
  color: string
}

export interface CatalogProduct {
  id: string
  model_name: string
  memory: string | null
  tier: 1 | 2 | 3
  pricing_mode: 'quote' | 'direct'
  gpu_count: number
  vcpu: number | null
  ram_gb: number | null
  storage_gb: number | null
  series: string | null
  // 자기 구성 직접 최저견적 (전파 전)
  own_lowest_usd: number | null
  own_supplier: { name: string; color: string } | null
  own_valid_until: string | null
  // 모델 그룹 1장당 전파 결과
  per_gpu_usd: number | null
  effective_unit_price_usd: number | null
  effective_supplier: { name: string; color: string } | null
  is_propagated: boolean
  // 판매가 (effective × 마진)
  sell_price_usd: number | null
  sell_price_krw: number | null
  // ── 콕핏 파생 필드 ─────────────────────────────────────────────────────────
  /** DB 원본 전략가(KRW). null = 미설정. */
  strategic_price_krw: number | null
  /** 실제 사용할 전략가: strategic_price_krw ?? sell_price_krw (자동마진가 fallback) */
  strategic_krw: number | null
  /** strategic_price_krw가 명시적으로 설정되어 있으면 true */
  is_strategic_set: boolean
  /** (strategic_krw - cost_krw) / cost_krw × 100. cost_krw = effective_unit_price_usd × fx. */
  effective_margin_pct: number | null
  /**
   * 시장 중앙값 대비 편차%. 콕핏 API/컴포넌트에서 market route 병합 후 채워진다.
   * buildCatalog 내에서는 시장 데이터를 알 수 없으므로 null로 초기화.
   */
  market_deviation_pct: number | null
  /** 시장 중앙값(USD). 콕핏 API/컴포넌트에서 병합. */
  market_median_krw: number | null
  // ────────────────────────────────────────────────────────────────────────────
  // 기준 공급가 선정 경로
  basis: 'selected' | 'auto' | 'fallback' | 'list' | 'none'
  selected_supplier: { name: string; color: string } | null
  fallback_reason: string | null
  /** 전파/상속의 모태(원본) 견적 id — 파생 구성에서 [공급가 지정] 시 이 견적을 대상으로 삼는다(모태 찾기 불요). */
  propagation_source_quote_id: string | null
  /** 전파 구성의 약정 = 모태 견적의 약정(다른 구성에서 받은 동일 약정). 비전파면 null. */
  propagation_source_term: string | null
}

export interface ModelGroupSupplier {
  supplier_id: string | null
  name: string
  color: string
  per_gpu_usd: number
  unit_price_usd: number // 해당 공급사가 제출한 최저 구성 총액
  gpu_count: number
}

export interface GpuCatalog {
  products: CatalogProduct[]
  // 모델 단위 1장당 전파 정보 (model_key -> ...)
  modelKey: (p: { model_name: string; tier: number }) => string
  bestPerGpuByModel: Map<string, { per_gpu_usd: number; supplier: { name: string; color: string } | null }>
  // 모델별 우리 공급사 목록 (시장비교 our_suppliers 용)
  suppliersByModel: Map<string, ModelGroupSupplier[]>
  margin_pct: number
  usd_krw: number
  fx_date: string | null
}

const PER_GPU_DP = 10000 // 소수 4자리

export function modelKeyOf(p: { model_name: string; tier: number }): string {
  return `${p.tier}|${p.model_name}`
}

/** per_gpu 환산 — 구성 총액 ÷ 장수 */
export function perGpuOf(unitPriceUsd: number, gpuCount: number): number {
  const n = Math.max(1, gpuCount)
  return Math.round((unitPriceUsd / n) * PER_GPU_DP) / PER_GPU_DP
}

export interface CatalogRawData {
  products: Array<{
    id: string; model_name: string; memory: string | null; tier: 1 | 2 | 3
    pricing_mode: 'quote' | 'direct'; gpu_count: number; vcpu: number | null
    ram_gb: number | null; storage_gb: number | null; series: string | null
    /** 마이그레이션 080에서 신설. 컬럼 미존재 환경 대비 옵셔널. */
    strategic_price_krw?: number | null
  }>
  quotes: ConfirmedQuote[]
  suppliers: SupplierLite[]
  direct: Array<{ gpu_products?: { id: string }; sell_price_krw: number }>
  margin_pct: number
  usd_krw: number
  fx_date: string | null
  /** today (YYYY-MM-DD) — 주입 가능(테스트 결정성) */
  today?: string
}

/**
 * GPU 카탈로그 SSOT 조회.
 * @param db  any 타입 supabase 클라이언트 (server)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getGpuCatalog(db: any): Promise<GpuCatalog> {
  const [productsRes, quotesRes, suppliersRes, directRes, settingsRes, fxRes] = await Promise.all([
    db.from('gpu_products')
      .select('id, model_name, memory, tier, pricing_mode, gpu_count, vcpu, ram_gb, storage_gb, series, strategic_price_krw')
      .is('deleted_at', null).order('tier').order('model_name'),
    // 확정·유효 견적 전체 (v_lowest_quotes는 구성별 최저만 → 전파 위해 원천 견적 직접 사용)
    // deleted_at IS NULL: 소프트삭제된 견적은 카탈로그 계산에서 제외
    db
      .from('supply_quotes')
      .select('id, product_id, supplier_id, unit_price_usd, gpu_count, valid_until, price_type, is_selected, selection_scope, source_format, term')
      .eq('status', 'confirmed')
      .is('deleted_at', null),
    db.from('suppliers').select('id, name, color'),
    db.from('direct_prices').select('*, gpu_products(id)').eq('is_current', true).is('deleted_at', null),
    db.from('pricing_settings').select('margin_pct').eq('id', 1).single(),
    db.from('fx_rates').select('usd_krw, rate_date').order('rate_date', { ascending: false }).limit(1).single(),
  ])

  return buildCatalog({
    products: productsRes.data ?? [],
    quotes: quotesRes.data ?? [],
    suppliers: suppliersRes.data ?? [],
    direct: directRes.data ?? [],
    margin_pct: settingsRes.data?.margin_pct ?? 18,
    usd_krw: fxRes.data?.usd_krw ?? 1400,
    fx_date: fxRes.data?.rate_date ?? null,
  })
}

/** 순수 계산부 — 1장당 전파 + effective 산출 (테스트 대상) */
export function buildCatalog(raw: CatalogRawData): GpuCatalog {
  const marginPct = raw.margin_pct
  const usdKrw = raw.usd_krw
  const fxDate = raw.fx_date

  const supplierMap = new Map<string, SupplierLite>(
    (raw.suppliers ?? []).map((s: SupplierLite) => [s.id, s])
  )

  // 만료 비활성(v0.7.226): 공급가는 영속 원가기준 — valid_until 경과해도 폐기/폴백하지 않는다.
  //   (사용자 정책: "공급가는 매번 받는 게 아니다 — 만료라는 건 없다")
  //   만료 개념 재도입 시 아래 한 줄을 `const isValid = (vu) => vu == null || vu >= (raw.today ?? new Date().toISOString().slice(0,10))`로 되돌리면 전 게이팅 복원.
  const isValid = (_vu: string | null) => true

  // 전체 확정견적 정규화 (유효성 필터 전 — 채택 만료 감지에 필요)
  const allConfirmed: ConfirmedQuote[] = (raw.quotes ?? []).map((q: ConfirmedQuote) => ({
    ...q,
    gpu_count: Math.max(1, Number(q.gpu_count) || 1),
    unit_price_usd: Number(q.unit_price_usd),
    price_type: (q.price_type ?? 'cost') as 'cost' | 'list',
  }))

  // 공급원가 풀 = cost 견적만 (gcube 등 'list' 공시 판매가 제외 — 옵션 B)
  const costAllRaw = allConfirmed.filter((q) => q.price_type !== 'list')

  // 실견적 우선: 같은 product+supplier에 유효한 실견적(source_format != 'market_link')이 있으면
  //   그 쌍의 추종가(market_link, 경쟁사 시장가 유래)는 공급원가 풀에서 제외.
  //   (source_format 미지정 견적은 실견적으로 간주 — 후방호환)
  const pairKey = (q: ConfirmedQuote) => `${q.product_id}::${q.supplier_id ?? ''}`
  const realQuotePairs = new Set<string>()
  for (const q of costAllRaw) {
    if (q.source_format !== 'market_link' && isValid(q.valid_until)) realQuotePairs.add(pairKey(q))
  }
  const costAll = costAllRaw.filter(
    (q) => !(q.source_format === 'market_link' && realQuotePairs.has(pairKey(q)))
  )

  // 상품별 채택 견적 (cost 중 is_selected) — 유효성 무관하게 잡아 만료 폴백 감지
  const selectedByProduct = new Map<string, ConfirmedQuote>()
  for (const q of costAll) {
    if (q.is_selected) selectedByProduct.set(q.product_id, q)
  }

  // 자동 최저가/전파 풀 = 유효한 cost 견적만
  const quotes: ConfirmedQuote[] = costAll.filter((q) => isValid(q.valid_until))

  // 'list'(자사·경쟁 공시 판매가) — cost 견적이 없는 상품의 고객가 패스스루용
  //  (gcube 공시가는 이미 '판매가'이므로 마진 미적용으로 그대로 사용)
  const listLowestByProduct = new Map<string, ConfirmedQuote>()
  for (const q of allConfirmed) {
    if (q.price_type !== 'list' || !isValid(q.valid_until)) continue
    const prev = listLowestByProduct.get(q.product_id)
    if (!prev || q.unit_price_usd < prev.unit_price_usd) listLowestByProduct.set(q.product_id, q)
  }

  // 상품 인덱스 (model_key 산출용)
  const productById = new Map<string, { model_name: string; tier: number }>(
    (raw.products ?? []).map((p: { id: string; model_name: string; tier: number }) => [
      p.id,
      { model_name: p.model_name, tier: p.tier },
    ])
  )

  // 모델별 list(공시가) 1장당 — 파생 구성(×2/×4/×8)에 공시가를 per-card로 전파해 고객가 산출
  const listPerCardByModel = new Map<string, number>()
  for (const q of allConfirmed) {
    if (q.price_type !== 'list' || !isValid(q.valid_until)) continue
    const meta = productById.get(q.product_id); if (!meta) continue
    const mk = modelKeyOf(meta)
    const perCard = q.unit_price_usd / Math.max(q.gpu_count, 1)
    const prev = listPerCardByModel.get(mk)
    if (prev == null || perCard < prev) listPerCardByModel.set(mk, perCard)
  }

  // 구성(product)별 자기 최저견적
  const ownLowestByProduct = new Map<string, ConfirmedQuote>()
  // 모델별 최저 1장당 + 공급사별 최저
  const bestPerGpuByModel = new Map<string, { per_gpu_usd: number; supplier: { name: string; color: string } | null; quote_id: string | null; term: string | null }>()
  const suppliersByModel = new Map<string, Map<string, ModelGroupSupplier>>()

  for (const q of quotes) {
    // own lowest
    const prevOwn = ownLowestByProduct.get(q.product_id)
    if (!prevOwn || q.unit_price_usd < prevOwn.unit_price_usd) {
      ownLowestByProduct.set(q.product_id, q)
    }

    const meta = productById.get(q.product_id)
    if (!meta) continue
    const mk = modelKeyOf(meta)
    const perGpu = perGpuOf(q.unit_price_usd, q.gpu_count)
    const sup = q.supplier_id ? supplierMap.get(q.supplier_id) ?? null : null
    const supLite = sup ? { name: sup.name, color: sup.color } : null

    // 모델 최저 1장당
    const prevBest = bestPerGpuByModel.get(mk)
    if (!prevBest || perGpu < prevBest.per_gpu_usd) {
      bestPerGpuByModel.set(mk, { per_gpu_usd: perGpu, supplier: supLite, quote_id: q.id ?? null, term: q.term ?? null })
    }

    // 모델×공급사별 최저 1장당
    let supMap = suppliersByModel.get(mk)
    if (!supMap) {
      supMap = new Map()
      suppliersByModel.set(mk, supMap)
    }
    const supKey = q.supplier_id ?? '__none__'
    const prevSup = supMap.get(supKey)
    if (!prevSup || perGpu < prevSup.per_gpu_usd) {
      supMap.set(supKey, {
        supplier_id: q.supplier_id,
        name: sup?.name ?? '공급사 미지정',
        color: sup?.color ?? '#f59e0b',
        per_gpu_usd: perGpu,
        unit_price_usd: q.unit_price_usd,
        gpu_count: q.gpu_count,
      })
    }
  }

  // 모델범위 지정(selection_scope='model') — 한 견적을 지정하면 모델의 모든 파생 구성이
  //   그 견적의 per-GPU×장수를 '지정공급가(전파)'로 상속한다(사용자 "4개 전부 지정").
  //   자체 지정(scope='config')이 없는 구성에만 상속(자체 지정 우선).
  const modelSelected = new Map<string, { per_gpu_usd: number; supplier: { name: string; color: string } | null; quote_id: string; owner_product_id: string; term: string | null }>()
  for (const q of quotes) {
    if (!q.is_selected || q.selection_scope !== 'model' || !q.id) continue
    const meta = productById.get(q.product_id); if (!meta) continue
    const mk = modelKeyOf(meta)
    if (modelSelected.has(mk)) continue // 모델당 하나(select API가 모델 내 단일 보장)
    const sup = q.supplier_id ? supplierMap.get(q.supplier_id) ?? null : null
    modelSelected.set(mk, {
      per_gpu_usd: perGpuOf(q.unit_price_usd, q.gpu_count),
      supplier: sup ? { name: sup.name, color: sup.color } : null,
      quote_id: q.id,
      owner_product_id: q.product_id,
      term: q.term ?? null,
    })
  }

  const directMap = new Map<string, { sell_price_krw: number }>(
    (raw.direct ?? []).map((p: { gpu_products?: { id: string }; sell_price_krw: number }) => [
      p.gpu_products?.id as string,
      { sell_price_krw: Number(p.sell_price_krw) },
    ])
  )

  const products: CatalogProduct[] = (raw.products ?? []).map(
    (p: {
      id: string; model_name: string; memory: string | null; tier: 1 | 2 | 3
      pricing_mode: 'quote' | 'direct'; gpu_count: number; vcpu: number | null
      ram_gb: number | null; storage_gb: number | null; series: string | null
      strategic_price_krw?: number | null
    }) => {
      const mk = modelKeyOf(p)
      const count = Math.max(1, Number(p.gpu_count) || 1)

      if (p.pricing_mode === 'direct') {
        const direct = directMap.get(p.id)
        const sellKrw = direct ? direct.sell_price_krw : null
        const rawStrategicKrw = p.strategic_price_krw != null ? Number(p.strategic_price_krw) : null
        const strategicKrw = rawStrategicKrw ?? sellKrw
        // direct 상품은 effective_unit_price_usd=null → effective_margin_pct 산출 불가
        return {
          ...p,
          gpu_count: count,
          own_lowest_usd: null, own_supplier: null, own_valid_until: null,
          per_gpu_usd: null, effective_unit_price_usd: null, effective_supplier: null,
          is_propagated: false,
          sell_price_usd: sellKrw != null ? sellKrw / usdKrw : null,
          sell_price_krw: sellKrw,
          strategic_price_krw: rawStrategicKrw,
          strategic_krw: strategicKrw,
          is_strategic_set: rawStrategicKrw != null,
          effective_margin_pct: null,
          market_deviation_pct: null,
          market_median_krw: null,
          basis: 'none' as const,
          selected_supplier: null,
          fallback_reason: null,
          propagation_source_quote_id: null,
          propagation_source_term: null,
        }
      }

      const own = ownLowestByProduct.get(p.id)
      const ownUsd = own ? own.unit_price_usd : null
      const ownSup = own?.supplier_id ? supplierMap.get(own.supplier_id) ?? null : null

      const best = bestPerGpuByModel.get(mk) ?? null
      const propagatedUsd = best ? Math.round(best.per_gpu_usd * count * PER_GPU_DP) / PER_GPU_DP : null

      // effective = min(자기 구성 견적, 전파 = bestPerGpu × count)
      let effective: number | null = null
      let effectiveSupplier: { name: string; color: string } | null = null
      let isPropagated = false
      if (ownUsd != null && propagatedUsd != null) {
        if (propagatedUsd < ownUsd) {
          effective = propagatedUsd
          effectiveSupplier = best!.supplier
          isPropagated = true
        } else {
          effective = ownUsd
          effectiveSupplier = ownSup ? { name: ownSup.name, color: ownSup.color } : null
          isPropagated = false
        }
      } else if (ownUsd != null) {
        effective = ownUsd
        effectiveSupplier = ownSup ? { name: ownSup.name, color: ownSup.color } : null
      } else if (propagatedUsd != null) {
        effective = propagatedUsd
        effectiveSupplier = best!.supplier
        isPropagated = true
      }

      // 채택(is_selected) 우선 — 자동 최저가/전파보다 우선. 단 cost·유효 견적만.
      let basis: 'selected' | 'auto' | 'fallback' | 'list' | 'none' = effective != null ? 'auto' : 'none'
      let selectedSupplier: { name: string; color: string } | null = null
      let fallbackReason: string | null = null
      // 전파/상속 모태 견적 id: 전파값이면 그 per-GPU의 원본 견적(자동최저든 모델지정이든)을 가리켜
      //   파생 구성에서 [공급가 지정] 시 모태를 바로 대상 삼게 한다(모태 찾기 불요).
      let propagationSourceQuoteId: string | null = isPropagated ? (best?.quote_id ?? null) : null
      // 전파 구성의 약정 = 모태 견적의 약정을 그대로 상속(다른 구성에서 받은 동일 약정).
      let propagationSourceTerm: string | null = isPropagated ? (best?.term ?? null) : null
      const sel = selectedByProduct.get(p.id)
      const mSel = modelSelected.get(mk)
      if (sel) {
        if (isValid(sel.valid_until)) {
          // 채택 견적이 유효 → 이것이 기준
          effective = sel.unit_price_usd
          const selSup = sel.supplier_id ? supplierMap.get(sel.supplier_id) ?? null : null
          effectiveSupplier = selSup ? { name: selSup.name, color: selSup.color } : null
          selectedSupplier = effectiveSupplier
          isPropagated = false
          basis = 'selected'
          propagationSourceQuoteId = null
          propagationSourceTerm = null
        } else {
          // 채택 견적 만료 → 자동 최저가로 폴백 + 경고
          basis = effective != null ? 'fallback' : 'none'
          fallbackReason = '채택 견적 만료 — 자동 최저가로 복귀'
        }
      } else if (mSel) {
        // 자체 지정 없음 + 모델범위 지정 존재 → 모태 per-GPU×장수를 '지정공급가(전파)'로 상속
        effective = Math.round(mSel.per_gpu_usd * count * PER_GPU_DP) / PER_GPU_DP
        effectiveSupplier = mSel.supplier
        selectedSupplier = mSel.supplier
        isPropagated = true
        basis = 'selected'
        propagationSourceQuoteId = mSel.quote_id
        propagationSourceTerm = mSel.term
      }

      // 판매가 = effective(원가) × (1+마진)
      let sellUsd = effective != null ? effective * (1 + marginPct / 100) : null

      // cost 견적이 전혀 없는 상품 → 'list'(gcube 공시 판매가)를 고객가로 그대로 사용 (마진 미적용)
      if (effective == null) {
        const listQ = listLowestByProduct.get(p.id)
        if (listQ) {
          sellUsd = listQ.unit_price_usd // 이미 판매가 — 마진 재적용 금지(이중마진 방지)
          basis = 'list'
          const listSup = listQ.supplier_id ? supplierMap.get(listQ.supplier_id) ?? null : null
          effectiveSupplier = listSup ? { name: listSup.name, color: listSup.color } : null
        } else {
          // 자기 구성에 공시가 없음 → 모델 공시가 1장당 × 장수로 전파(파생 구성 ×2/×4/×8 고객가)
          const perCard = listPerCardByModel.get(mk)
          if (perCard != null) { sellUsd = Math.round(perCard * count * PER_GPU_DP) / PER_GPU_DP; basis = 'list' }
        }
      }
      const sellKrw = sellUsd != null ? Math.round(sellUsd * usdKrw) : null
      const rawStrategicKrw = p.strategic_price_krw != null ? Number(p.strategic_price_krw) : null
      const strategicKrw = rawStrategicKrw ?? sellKrw

      // effective_margin_pct = (strategic_krw - cost_krw) / cost_krw × 100
      // cost_krw = effective_unit_price_usd × usd_krw
      let effectiveMarginPct: number | null = null
      if (effective != null && strategicKrw != null) {
        const costKrw = effective * usdKrw
        if (costKrw > 0) {
          effectiveMarginPct = ((strategicKrw - costKrw) / costKrw) * 100
        }
      }

      return {
        ...p,
        gpu_count: count,
        own_lowest_usd: ownUsd,
        own_supplier: ownSup ? { name: ownSup.name, color: ownSup.color } : null,
        own_valid_until: own?.valid_until ?? null,
        per_gpu_usd: basis === 'selected'
          ? perGpuOf(effective as number, count)
          : (best ? best.per_gpu_usd : (ownUsd != null ? perGpuOf(ownUsd, count) : null)),
        effective_unit_price_usd: effective,
        effective_supplier: effectiveSupplier,
        is_propagated: isPropagated,
        sell_price_usd: sellUsd,
        sell_price_krw: sellKrw,
        strategic_price_krw: rawStrategicKrw,
        strategic_krw: strategicKrw,
        is_strategic_set: rawStrategicKrw != null,
        effective_margin_pct: effectiveMarginPct,
        market_deviation_pct: null,
        market_median_krw: null,
        basis,
        selected_supplier: selectedSupplier,
        fallback_reason: fallbackReason,
        propagation_source_quote_id: propagationSourceQuoteId,
        propagation_source_term: propagationSourceTerm,
      }
    }
  )

  // suppliersByModel: Map<string, Map> → Map<string, array(정렬)>
  const suppliersByModelArr = new Map<string, ModelGroupSupplier[]>()
  Array.from(suppliersByModel.entries()).forEach(([mk, supMap]) => {
    const arr: ModelGroupSupplier[] = Array.from(supMap.values())
    arr.sort((a, b) => a.per_gpu_usd - b.per_gpu_usd)
    suppliersByModelArr.set(mk, arr)
  })

  return {
    products,
    modelKey: modelKeyOf,
    bestPerGpuByModel,
    suppliersByModel: suppliersByModelArr,
    margin_pct: marginPct,
    usd_krw: usdKrw,
    fx_date: fxDate,
  }
}
