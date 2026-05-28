'use client'

import useSWR, { mutate } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Check, X, AlertTriangle } from 'lucide-react'

interface Supplier {
  name: string
  color: string
  location?: string
}

interface GpuProduct {
  model_name: string
  memory: string
  tier: number
}

interface PendingQuote {
  id: string
  unit_price_usd: number
  original_currency: string | null
  original_price: number | null
  original_unit: string | null
  term: string | null
  min_qty: string | null
  valid_until: string | null
  source_format: string | null
  ai_confidence: number | null
  received_at: string | null
  registered_by: string | null
  suppliers: Supplier | null
  gpu_products: GpuProduct | null
}

const fmtUSD = (v: number) => '$' + v.toFixed(2)

export default function ReviewTab() {
  const { data, mutate: revalidate } = useSWR<{ quotes: PendingQuote[] }>('/api/pricing/gpu/quotes/pending', fetcher)
  const quotes = data?.quotes ?? []

  const handleAction = async (quoteId: string, action: 'confirm' | 'reject') => {
    try {
      const res = await fetch(`/api/pricing/gpu/quotes/${quoteId}/${action}`, {
        method: 'POST',
      })
      if (res.ok) {
        await revalidate()
        await mutate('/api/pricing/gpu/products')
      }
    } catch {
      // silent — will retry
    }
  }

  if (quotes.length === 0) {
    return (
      <div>
        <div className="gpu-banner gpu-banner-warning">
          <div className="gpu-banner-dot">
            <AlertTriangle size={16} color="#d97706" />
          </div>
          <div>
            <strong>사람 검토 게이트</strong> · AI가 추출한 견적은 본부장 확정 전까지 가격표에 반영되지 않습니다. 오인식 방지를 위한 안전장치입니다.
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
          검토 대기 견적이 없습니다
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="gpu-banner gpu-banner-warning">
        <div className="gpu-banner-dot">
          <AlertTriangle size={16} color="#d97706" />
        </div>
        <div>
          <strong>사람 검토 게이트</strong> · AI가 추출한 견적은 본부장 확정 전까지 가격표에 반영되지 않습니다. 오인식 방지를 위한 안전장치입니다.
        </div>
      </div>

      {quotes.map((q) => {
        const product = q.gpu_products
        const tierLabels = ['', 'Tier 1', 'Tier 2', 'Tier 3']
        const tierBadges = ['', 'gpu-badge-t1', 'gpu-badge-t2', 'gpu-badge-t3']

        return (
          <div key={q.id} className="gpu-rev-card">
            <div className="gpu-rev-top">
              <div className="gpu-chip" style={{ width: 42, height: 42 }}>
                {product?.model_name?.charAt(0) ?? 'G'}
                <span>{product?.memory ?? ''}</span>
              </div>
              <div className="gpu-rev-info">
                <div className="gpu-rev-nm">
                  {product?.model_name ?? '알 수 없는 모델'} {product?.memory ?? ''}
                  {product?.tier && (
                    <span className={`gpu-badge ${tierBadges[product.tier]}`} style={{ fontSize: '10px', marginLeft: 8 }}>
                      {tierLabels[product.tier]}
                    </span>
                  )}
                </div>
                <div className="gpu-rev-src">
                  {q.suppliers && (
                    <>
                      <span className="gpu-sdot" style={{ background: q.suppliers.color }} />
                      {q.suppliers.name}
                    </>
                  )}
                  {q.source_format && <span className="gpu-badge gpu-badge-gray">{q.source_format}</span>}
                  {q.received_at && <span>{new Date(q.received_at).toLocaleString('ko-KR')}</span>}
                </div>
              </div>
            </div>

            <div className="gpu-rev-fields">
              <div className="gpu-rev-f">
                <div className="gpu-rev-f-lbl">단가 (정규화)</div>
                <div className="gpu-rev-f-val">{fmtUSD(q.unit_price_usd)}/hr</div>
              </div>
              {q.original_price && (
                <div className="gpu-rev-f">
                  <div className="gpu-rev-f-lbl">원본 표기</div>
                  <div className="gpu-rev-f-val" style={{ fontFamily: 'inherit', fontSize: 14 }}>
                    {q.original_price} {q.original_currency} {q.original_unit ? `(${q.original_unit})` : ''}
                  </div>
                </div>
              )}
              <div className="gpu-rev-f">
                <div className="gpu-rev-f-lbl">약정</div>
                <div className="gpu-rev-f-val" style={{ fontFamily: 'inherit' }}>{q.term ?? '—'}</div>
              </div>
              <div className="gpu-rev-f">
                <div className="gpu-rev-f-lbl">유효기간</div>
                <div className="gpu-rev-f-val">{q.valid_until ?? '—'}</div>
              </div>
            </div>

            {q.ai_confidence != null && (
              <div style={{ margin: '12px 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: 'var(--gpu-muted)' }}>
                <div className="gpu-conf-bar" style={{ width: 80 }}>
                  <i
                    className={q.ai_confidence >= 80 ? '' : q.ai_confidence >= 50 ? 'mid' : 'low'}
                    style={{ width: `${q.ai_confidence}%` }}
                  />
                </div>
                AI 신뢰도 {q.ai_confidence}%
              </div>
            )}

            <div className="gpu-rev-actions">
              <button
                className="gpu-btn gpu-btn-primary"
                onClick={() => handleAction(q.id, 'confirm')}
              >
                <Check size={14} /> 확정 · 가격표 반영
              </button>
              <button
                className="gpu-btn gpu-btn-danger"
                onClick={() => handleAction(q.id, 'reject')}
              >
                <X size={14} /> 반려
              </button>
              <span className="gpu-rev-sp">등록자: {q.registered_by ?? '—'}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
