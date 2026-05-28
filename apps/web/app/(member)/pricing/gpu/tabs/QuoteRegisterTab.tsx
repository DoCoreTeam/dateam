'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, DollarSign } from 'lucide-react'

interface Supplier {
  id: string
  name: string
  color: string
}

interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: number
  pricing_mode: string
}

export default function QuoteRegisterTab() {
  const [mode, setMode] = useState<'quote' | 'direct'>('quote')
  const [inputType, setInputType] = useState<'text' | 'file' | 'img'>('text')
  const [rawText, setRawText] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState('')
  const [unitPrice, setUnitPrice] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [term, setTerm] = useState('')
  const [minQty, setMinQty] = useState('')
  const [t3ModelInput, setT3ModelInput] = useState('')
  const [t3Krw, setT3Krw] = useState('')
  const [t3Note, setT3Note] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const { data: productsData } = useSWR<{ products: GpuProduct[] }>('/api/pricing/gpu/products', fetcher)
  const { data: suppliersData } = useSWR<{ suppliers: Supplier[] }>('/api/pricing/gpu/suppliers', fetcher)
  const { data: settingsData } = useSWR<{ usd_krw: number }>('/api/pricing/gpu/settings', fetcher)

  const quoteProducts = (productsData?.products ?? []).filter((p) => p.pricing_mode === 'quote')
  const directProducts = (productsData?.products ?? []).filter((p) => p.pricing_mode === 'direct')
  const suppliers = suppliersData?.suppliers ?? []
  const usdKrw = settingsData?.usd_krw ?? 1400

  const t3Usd = t3Krw ? (Number(t3Krw) / usdKrw).toFixed(4) : ''

  const handleManualSubmit = async () => {
    if (!selectedProduct || !unitPrice) {
      setErrorMsg('상품과 공급가를 입력해 주세요.')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct,
          supplier_id: selectedSupplier || null,
          unit_price_usd: Number(unitPrice),
          original_unit: 'USD/GPU·hr',
          term: term || null,
          min_qty: minQty || null,
          valid_until: validUntil || null,
          source_format: 'text',
        }),
      })
      if (!res.ok) throw new Error('등록 실패')
      setSuccessMsg('견적이 검토 대기 목록에 등록되었습니다. 검토 탭에서 확정하면 가격표에 반영됩니다.')
      setRawText(''); setSelectedProduct(''); setSelectedSupplier(''); setUnitPrice('')
      setValidUntil(''); setTerm(''); setMinQty('')
    } catch {
      setErrorMsg('등록 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDirectSubmit = async () => {
    if (!t3Krw) {
      setErrorMsg('판매가를 입력해 주세요.')
      return
    }
    setSubmitting(true)
    setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/direct-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: selectedProduct || null,
          model_input: t3ModelInput || null,
          sell_price_krw: Number(t3Krw),
          note: t3Note || null,
        }),
      })
      if (!res.ok) throw new Error('등록 실패')
      setSuccessMsg('판매가가 가격표에 즉시 반영되었습니다.')
      setT3Krw(''); setT3ModelInput(''); setT3Note(''); setSelectedProduct('')
    } catch {
      setErrorMsg('등록 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      {/* 모드 선택 */}
      <div className="gpu-intake-mode">
        <button
          className={`gpu-im${mode === 'quote' ? ' on' : ''}`}
          onClick={() => setMode('quote')}
        >
          <div className="gpu-im-ic" style={{ background: mode === 'quote' ? 'var(--gpu-accent-soft)' : '#f3f4f8', color: 'var(--gpu-accent)' }}>
            <Sparkles size={18} />
          </div>
          <div>
            <div className="gpu-im-title">Tier 1·2 공급견적 등록</div>
            <div className="gpu-im-desc">견적서·메일·캡처를 입력 → 원가 추적 → 마진 적용</div>
          </div>
        </button>
        <button
          className={`gpu-im${mode === 'direct' ? ' on' : ''}`}
          onClick={() => setMode('direct')}
        >
          <div className="gpu-im-ic" style={{ background: mode === 'direct' ? 'var(--gpu-amber-soft)' : '#f3f4f8', color: 'var(--gpu-amber)' }}>
            <DollarSign size={18} />
          </div>
          <div>
            <div className="gpu-im-title">Tier 3 판매가 직접 설정</div>
            <div className="gpu-im-desc">간헐 공급 — 견적 없이 gcube 판매가를 직접 입력</div>
          </div>
        </button>
      </div>

      {successMsg && (
        <div className="gpu-success-msg">✓ {successMsg}</div>
      )}
      {errorMsg && (
        <div className="gpu-error-msg">✕ {errorMsg}</div>
      )}

      {/* Tier 1·2 등록 폼 */}
      {mode === 'quote' && (
        <div className="gpu-grid2">
          <div className="gpu-panel gpu-card-pad">
            <div className="gpu-card-title">
              <span className="gpu-step">1</span>
              공급 견적 입력
            </div>
            <div className="gpu-card-desc">메일·메신저 캡처·견적서 파일 등 어떤 포맷이든 그대로 넣으세요. 현재는 수동 폼으로 등록합니다 (AI 자동 분석은 다음 버전).</div>

            <div className="gpu-intake-tabs">
              {(['text', 'file', 'img'] as const).map((t) => (
                <button
                  key={t}
                  className={`gpu-it${inputType === t ? ' on' : ''}`}
                  onClick={() => setInputType(t)}
                >
                  {t === 'text' ? '텍스트' : t === 'file' ? '견적서 파일' : '이미지'}
                </button>
              ))}
            </div>

            {inputType === 'text' && (
              <textarea
                className="gpu-intake-textarea"
                placeholder="메일·메신저 내용을 그대로 붙여넣으세요&#10;&#10;예) [GMI Cloud] H100 SXM 80GB: $2.10/GPU·hr (8장 이상)&#10;약정: 3개월 | 견적 유효: 2026-06-15"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            )}
            {(inputType === 'file' || inputType === 'img') && (
              <div className="gpu-dropzone">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                <div className="gpu-dropzone-title">{inputType === 'file' ? '견적서 파일을 끌어다 놓거나 클릭' : '메신저 캡처 / 견적 이미지'}</div>
                <div className="gpu-dropzone-sub">{inputType === 'file' ? 'PDF · XLSX · DOCX (최대 20MB)' : 'Ctrl+V 또는 클릭 · PNG · JPG'}</div>
              </div>
            )}

            {/* 수동 입력 폼 */}
            <div style={{ marginTop: 16 }}>
              <div className="gpu-field">
                <label>GPU 상품 선택</label>
                <select className="gpu-inp" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
                  <option value="">— 상품 선택 —</option>
                  {quoteProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.model_name} {p.memory} (T{p.tier})</option>
                  ))}
                </select>
              </div>
              <div className="gpu-field">
                <label>공급사</label>
                <select className="gpu-inp" value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
                  <option value="">— 공급사 선택 —</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="gpu-field-grid">
                <div className="gpu-field">
                  <label>공급가 (USD/GPU·hr)</label>
                  <input className="gpu-inp" type="number" step="0.01" placeholder="예) 2.10" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
                </div>
                <div className="gpu-field">
                  <label>견적 유효기간</label>
                  <input className="gpu-inp" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              </div>
              <div className="gpu-field-grid">
                <div className="gpu-field">
                  <label>약정 조건</label>
                  <input className="gpu-inp" placeholder="예) 3개월 약정" value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
                <div className="gpu-field">
                  <label>최소 수량</label>
                  <input className="gpu-inp" placeholder="예) 8장 이상" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
                </div>
              </div>
            </div>

            <div className="gpu-row-actions">
              <button
                className="gpu-btn gpu-btn-primary"
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={handleManualSubmit}
                disabled={submitting}
              >
                {submitting ? '등록 중…' : '견적 등록 (검토 대기)'}
              </button>
              <button className="gpu-btn" onClick={() => { setRawText(''); setSelectedProduct(''); setSelectedSupplier(''); setUnitPrice('') }}>
                초기화
              </button>
            </div>
          </div>

          <div className="gpu-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="gpu-ai-empty">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" width="44" height="44"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M9 9h.01M15 9h.01M8 14s1.5 2 4 2 4-2 4-2"/></svg>
              <div className="gpu-ai-empty-t">AI 자동 분석 (Phase 4에서 활성화)</div>
              <div className="gpu-ai-empty-d">좌측 폼에서 수동으로 견적을 입력하면 검토 대기 탭에 등록됩니다. AI 분석·자동 정제 기능은 다음 버전에 추가됩니다.</div>
            </div>
          </div>
        </div>
      )}

      {/* Tier 3 직접 입력 */}
      {mode === 'direct' && (
        <div className="gpu-panel gpu-card-pad" style={{ maxWidth: 580 }}>
          <div className="gpu-card-title">
            <span className="gpu-step" style={{ background: 'var(--gpu-amber)' }}>T3</span>
            Tier 3 판매가 직접 설정
          </div>
          <div className="gpu-card-desc">
            Tier 3는 공급사 견적을 받지 않습니다. gcube 판매가를 직접 입력하면 검토 단계 없이 바로 가격표에 반영됩니다.
          </div>
          <div className="gpu-field">
            <label>GPU 상품 선택</label>
            <select className="gpu-inp" value={selectedProduct} onChange={(e) => setSelectedProduct(e.target.value)}>
              <option value="">— Tier 3 상품 선택 —</option>
              {directProducts.map((p) => (
                <option key={p.id} value={p.id}>{p.model_name} {p.memory}</option>
              ))}
            </select>
          </div>
          <div className="gpu-field-grid">
            <div className="gpu-field">
              <label>판매가 (KRW/hr)</label>
              <input className="gpu-inp" type="number" placeholder="예) 800" value={t3Krw} onChange={(e) => setT3Krw(e.target.value)} />
            </div>
            <div className="gpu-field">
              <label>USD 환산 (오늘 매매기준율 자동)</label>
              <input className="gpu-inp" value={t3Usd ? `$${t3Usd}` : '—'} disabled style={{ background: '#f3f4f8' }} />
            </div>
          </div>
          <div className="gpu-field">
            <label>메모 (선택)</label>
            <input className="gpu-inp" placeholder="예) 수요 기반 직접 책정" value={t3Note} onChange={(e) => setT3Note(e.target.value)} />
          </div>
          <div className="gpu-t3-notice">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--gpu-accent)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
            변경 즉시 가격표에 반영 · <strong>타임스탬프·작성자 로그 자동 기록</strong> · 이전 값은 변동 이력에 보존
          </div>
          <button
            className="gpu-btn gpu-btn-primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleDirectSubmit}
            disabled={submitting}
          >
            {submitting ? '저장 중…' : '판매가 저장 · 가격표 반영'}
          </button>
        </div>
      )}
    </div>
  )
}
