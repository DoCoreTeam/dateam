// 통합입력 미리보기 — 공급가↔경쟁사 인라인 정정 보조(형태 변환 SSOT + 공급가 행 컴포넌트).
// QuoteRegisterTab에서 분리(파일 비대화 방지). 표시 전용 — 데이터 상태는 부모가 소유.

export interface CompetitorSavedItem {
  competitor: string
  model: string
  memory: string
  price_usd: number
  /** 원본 통화(ISO, 'KRW'|'USD'). 입력 통화 그대로 — 표시 기본값은 이 통화. 미상이면 USD 가정. */
  original_currency?: string | null
  /** 원본 통화 기준 금액(GPU 1장·1시간당). 표시 기본값. */
  original_price?: number | null
}

// 가격 표시 SSOT — 원본 통화 기준으로 보여준다(원으로 들어오면 ₩, 달러면 $).
//   USD 환산 표시는 리스트의 "통화 보기" 토글이 담당(여기선 입력 통화 그대로).
export function fmtOriginalPrice(it: { original_currency?: string | null; original_price?: number | null; price_usd: number }): string {
  const cur = it.original_currency
  if (cur === 'KRW' && typeof it.original_price === 'number') {
    return `₩${Math.round(it.original_price).toLocaleString('ko-KR')}/hr`
  }
  if (cur === 'USD' && typeof it.original_price === 'number') {
    return `$${it.original_price}/hr`
  }
  // 통화 미상(기존행 등) → USD 가정 폴백
  return `$${it.price_usd}/hr`
}

export type CompetitorPreviewRaw = { competitor_name: string; model_name: string; memory: string; price_usd: number }

// 가격미상(price_unknown) 판정 SSOT — 추출행/extracted 어디에 실려와도 일관 판정.
// 가격이 비어있거나(0/null) price_unknown 플래그가 있으면 true.
export function isPriceUnknown(it: unknown): boolean {
  const row = (it ?? {}) as Record<string, unknown>
  if (row.price_unknown === true) return true
  const ex = ((row.extracted ?? {}) as Record<string, unknown>)
  if (ex.price_unknown === true) return true
  const priceRaw = ex.unit_price_usd ?? ex.price_usd ?? row.unit_price_usd ?? row.price_usd
  return priceRaw === null || priceRaw === undefined || Number(priceRaw) === 0
}

// 원문 모델명 — 매핑된 model_name과 다를 때만 병기 대상으로 반환(같으면 null).
export function sourceModelMismatch(it: unknown): string | null {
  const row = (it ?? {}) as Record<string, unknown>
  const ex = ((row.extracted ?? {}) as Record<string, unknown>)
  const src = typeof row.source_model_name === 'string'
    ? row.source_model_name
    : (typeof ex.source_model_name === 'string' ? ex.source_model_name : '')
  if (!src.trim()) return null
  const mapped = typeof ex.model_name === 'string' ? ex.model_name : ''
  return src.trim() !== mapped.trim() ? src.trim() : null
}

// 공급가 미리보기({extracted}) → 경쟁사 표시/전송 형태로 변환
export function supplierRowToCompetitor(it: unknown): { display: CompetitorSavedItem; raw: CompetitorPreviewRaw } {
  const ex = ((it as { extracted?: Record<string, unknown> })?.extracted ?? {}) as Record<string, unknown>
  const model = typeof ex.model_name === 'string' ? ex.model_name : ''
  const memory = typeof ex.memory === 'string' ? ex.memory : ''
  const supplier = typeof ex.supplier === 'string' ? ex.supplier : ''
  const priceRaw = ex.unit_price_usd ?? ex.price_usd
  const price = typeof priceRaw === 'number' ? priceRaw : (priceRaw != null ? Number(priceRaw) : 0)
  return {
    display: { competitor: supplier, model, memory, price_usd: price },
    raw: { competitor_name: supplier, model_name: model, memory, price_usd: price },
  }
}

// 경쟁사 표시 형태 → 공급가 commit 전송 형태({extracted})로 변환
export function competitorRowToSupplier(c: CompetitorSavedItem) {
  return {
    extracted: { model_name: c.model, memory: c.memory, supplier: c.competitor, unit_price_usd: c.price_usd },
    confidence: {},
    overall_confidence: null,
  }
}

// 공급가 미리보기 한 행(펼침 상세 + 인라인 "→ 경쟁사" 정정 버튼).
export interface SupplierPreviewRowProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  it: any
  idx: number
  open: boolean
  committed: boolean
  onToggle: (idx: number) => void
  onMoveToCompetitor: (idx: number) => void
}

export function SupplierPreviewRow({ it, idx, open, committed, onToggle, onMoveToCompetitor }: SupplierPreviewRowProps) {
  const ex = (it?.extracted ?? {}) as Record<string, unknown>
  const name = `${ex.model_name ?? ''} ${ex.memory ?? ''}`.trim()
  const priceVal = ex.unit_price_usd ?? ex.price_usd
  const price = priceVal != null ? `$${priceVal}/hr` : '—'
  const priceUnknown = isPriceUnknown(it)
  const srcModel = sourceModelMismatch(it)
  const detailRows: Array<[string, string]> = []
  // 객체/배열은 스킵(내부 구조 노출·[object Object] 방지) — 원시값만 자연어로
  const push = (label: string, v: unknown) => {
    if (v === null || v === undefined || typeof v === 'object') return
    const s = String(v).trim()
    if (s !== '') detailRows.push([label, s])
  }
  const qty = typeof ex.min_qty === 'object' ? null : ex.min_qty
  push('약정', ex.term ?? (ex.term_months ? `${ex.term_months}개월` : null))
  push('최소 수량', qty)
  push('유효기간', ex.valid_until)
  push('원본 금액', ex.original_price != null && typeof ex.original_price !== 'object' ? `${ex.original_price} ${ex.original_currency ?? ''}`.trim() : null)
  push('원본 단위', ex.original_unit)
  push('추천 Tier', ex.tier_suggestion)
  return (
    <div
      data-testid={`supplier-row-${idx}`}
      data-price-unknown={priceUnknown ? 'true' : undefined}
      style={{
        borderRadius: 8,
        background: priceUnknown ? 'var(--warning-bg)' : 'var(--brand-soft)',
        border: `var(--hairline) solid ${priceUnknown ? 'var(--warning-border)' : 'var(--brand-soft-2)'}`,
        overflow: 'hidden',
      }}
    >
      <div onClick={() => onToggle(idx)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer', minHeight: 44 }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600 }}>{name || '(모델 미상)'}</span>
          {srcModel && (
            <span style={{ fontSize: 11, color: 'var(--gpu-amber)' }} title="추출된 모델명이 원문과 다릅니다 — 오매핑 확인">
              (원문: {srcModel})
            </span>
          )}
        </span>
        {ex.supplier ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{String(ex.supplier)}</span> : null}
        {priceUnknown
          ? <span className="gpu-badge gpu-badge-warn" data-testid="price-unknown-badge" title="가격 정보 없음 — 자동 시장반영 제외, 사용자 확인 필요">가격미상</span>
          : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)' }}>{price}</span>}
        {!committed && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveToCompetitor(idx) }}
            className="gpu-btn gpu-row-move-btn"
            data-testid={`move-to-competitor-${idx}`}
            title="이 항목을 경쟁사(시장 비교)로 옮깁니다"
          >→ 경쟁사</button>
        )}
      </div>
      {open && (
        <div style={{ padding: '4px 12px 10px 28px', display: 'flex', flexDirection: 'column', gap: 3, borderTop: 'var(--hairline) solid var(--brand-soft-2)', background: priceUnknown ? 'var(--warning-bg)' : 'var(--brand-soft)' }}>
          {priceUnknown && (
            <div style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--gpu-amber)', fontWeight: 600 }}>
              <span aria-hidden>⚠</span>
              <span>가격 정보가 없어 자동 시장반영에서 제외됩니다 — 직접 확인 후 가격을 입력하세요.</span>
            </div>
          )}
          {detailRows.length > 0 ? detailRows.map(([k, v]) => (
            <div key={k} style={{ display: 'flex', fontSize: 11.5, gap: 8 }}>
              <span style={{ color: 'var(--text-muted)', minWidth: 64 }}>{k}</span>
              <span style={{ color: 'var(--text)', fontWeight: 500 }}>{v}</span>
            </div>
          )) : <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>추가 상세 정보 없음</span>}
        </div>
      )}
    </div>
  )
}

// ── 단일 모델 추출 결과 패널(레거시 탭뷰) — 표시 전용. 파일 비대화 방지로 Tab에서 분리. ──

export interface ReviewItemResult {
  id: string
  product_hint: string | null
  supplier_hint: string | null
  channel: string | null
  impact_level: string | null
  overall_confidence: number | null
  current_extracted: Record<string, unknown> | null
  current_confidence: Record<string, number | null> | null
  is_test: boolean
}

const CONF_LABELS: Record<string, string> = {
  model_name: '모델명',
  memory: '메모리',
  supplier: '공급사',
  unit_price_usd: '단가 (USD)',
  original_price: '원본 금액',
  original_currency: '원본 통화',
  original_unit: '원본 단위',
  term: '약정 원문',
  term_months: '약정 (개월)',
  min_qty: '최소 수량',
  valid_until: '유효기간',
  tier_suggestion: 'Tier 추천',
  tier_reason: 'Tier 근거',
  has_quantity_info: '재고 정보',
  quantity: '재고 현황',
}

const QTY_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available_full:    { label: '재고 있음',  color: 'var(--success)' },
  available_partial: { label: '일부 가능',  color: 'var(--warning)' },
  out_of_stock:      { label: '재고 없음',  color: 'var(--danger)' },
  declined:          { label: '공급 거절',  color: 'var(--brand)' },
  pending:           { label: '확인 중',    color: 'var(--text-muted)' },
}

function formatExtractedValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return '—'
  if (typeof val === 'boolean') return val ? '있음' : '없음'
  if (key === 'quantity' && typeof val === 'object' && val !== null) {
    const q = val as Record<string, unknown>
    const statusKey = typeof q.status === 'string' ? q.status : ''
    const statusLabel = QTY_STATUS_LABELS[statusKey]?.label ?? statusKey
    const qty = q.resp_qty !== null && q.resp_qty !== undefined ? ` · ${q.resp_qty}개` : ''
    return `${statusLabel}${qty}`
  }
  if (typeof val === 'object') {
    const raw = JSON.stringify(val)
    return raw.length > 80 ? raw.slice(0, 80) + '…' : raw
  }
  return String(val)
}

const IMPACT_CONFIG: Record<string, { label: string; color: string }> = {
  new_model: { label: '신규 모델', color: 'var(--gpu-accent)' },
  big_swing: { label: '급격한 변동', color: 'var(--gpu-red)' },
  price_low_change: { label: '소폭 변동', color: 'var(--gpu-amber)' },
  steady: { label: '안정적', color: 'var(--gpu-green)' },
}

export function getTabLabel(item: ReviewItemResult): string {
  const extracted = item.current_extracted ?? {}
  const model = typeof extracted.model_name === 'string' ? extracted.model_name : ''
  const mem = typeof extracted.memory === 'string' ? extracted.memory : ''
  return model ? `${model}${mem ? ' ' + mem : ''}` : item.product_hint ?? '모델'
}

export function getConfColor(pct: number | null): string {
  if (pct == null) return 'var(--text-faint)'
  if (pct >= 80) return 'var(--gpu-green)'
  if (pct >= 60) return 'var(--gpu-amber)'
  return 'var(--gpu-red)'
}

export function ResultPanel({ item }: { item: ReviewItemResult }) {
  const extracted = item.current_extracted ?? {}
  const confidence = item.current_confidence ?? {}
  const overallPct = item.overall_confidence ?? 0
  const impact = IMPACT_CONFIG[item.impact_level ?? 'steady'] ?? IMPACT_CONFIG.steady

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* 임팩트 배지 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
        <span className="gpu-badge" style={{ background: impact.color, color: '#fff', fontSize: 10 }}>
          {impact.label}
        </span>
        {item.product_hint && (
          <span className="gpu-badge gpu-badge-gray">{item.product_hint}</span>
        )}
        {item.supplier_hint
          ? <span className="gpu-badge gpu-badge-gray">{item.supplier_hint}</span>
          : <span className="gpu-badge" style={{ background: 'var(--gpu-amber)', color: '#fff', fontSize: 10 }}>⚠ 공급사 미확인</span>
        }
        <span className="gpu-badge" style={{ background: getConfColor(overallPct), color: '#fff', fontSize: 10 }}>
          신뢰도 {overallPct}%
        </span>
      </div>

      {/* 필드별 */}
      {Object.entries(extracted).map(([key, val]) => {
        const conf = confidence[key]
        const isNull = val === null || val === undefined
        const displayVal = formatExtractedValue(key, val)
        const isLow = typeof conf === 'number' && conf < 90
        return (
          <div
            key={key}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
              borderRadius: 8,
              background: isNull ? 'var(--surface-bg)' : isLow ? 'var(--warning-bg)' : 'var(--surface-bg)',
              border: `var(--hairline) solid ${isNull ? 'var(--surface-bg)' : isLow ? 'var(--warning-border)' : 'var(--color-border)'}`,
              opacity: isNull ? 0.55 : 1,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--gpu-muted)', minWidth: 80 }}>{CONF_LABELS[key] ?? key}</span>
            <span style={{ fontSize: 13, fontWeight: isNull ? 400 : 600, flex: 1, color: isNull ? 'var(--text-faint)' : 'var(--text)', fontStyle: isNull ? 'italic' : 'normal' }}>
              {displayVal}
            </span>
            {typeof conf === 'number' && !isNull && (
              <span style={{ fontSize: 11, fontWeight: 700, color: isLow ? 'var(--gpu-amber)' : 'var(--gpu-green)' }}>
                {conf}%
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}
