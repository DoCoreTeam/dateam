// 통합입력 미리보기 — 공급가↔경쟁사 인라인 정정 보조(형태 변환 SSOT + 공급가 행 컴포넌트).
// QuoteRegisterTab에서 분리(파일 비대화 방지). 표시 전용 — 데이터 상태는 부모가 소유.

export interface CompetitorSavedItem {
  competitor: string
  model: string
  memory: string
  price_usd: number
}

export type CompetitorPreviewRaw = { competitor_name: string; model_name: string; memory: string; price_usd: number }

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
    <div style={{ borderRadius: 8, background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand-soft-2)', overflow: 'hidden' }}>
      <div onClick={() => onToggle(idx)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}>
        <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, flex: 1 }}>{name || '(모델 미상)'}</span>
        {ex.supplier ? <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{String(ex.supplier)}</span> : null}
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)' }}>{price}</span>
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
        <div style={{ padding: '4px 12px 10px 28px', display: 'flex', flexDirection: 'column', gap: 3, borderTop: 'var(--hairline) solid var(--brand-soft-2)', background: 'var(--brand-soft)' }}>
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
