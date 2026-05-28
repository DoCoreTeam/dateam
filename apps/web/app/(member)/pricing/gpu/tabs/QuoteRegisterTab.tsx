'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Sparkles, DollarSign, CheckCircle2, AlertCircle, Send } from 'lucide-react'

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
  gpu_count: number
  vcpu: number
  ram_gb: number
  storage_gb: number
  series: string
}

interface Parsed {
  supplierName?: string
  unitPrice?: string
  validUntil?: string
  term?: string
  minQty?: string
  productId?: string
  confidence: number
}

function parseQuoteText(text: string, products: GpuProduct[]): Parsed {
  if (!text.trim()) return { confidence: 0 }
  const result: Parsed = { confidence: 0 }
  let hits = 0

  const supM = text.match(/\[([^\]]+)\]/)
  if (supM) { result.supplierName = supM[1].trim(); hits++ }

  const priceM = text.match(/\$\s*(\d+(?:\.\d+)?)\s*\/?\s*GPU/i) ||
                 text.match(/USD\s*(\d+(?:\.\d+)?)/i) ||
                 text.match(/\$\s*(\d+(?:\.\d+)?)/)
  if (priceM) { result.unitPrice = priceM[1]; hits++ }

  const dateM = text.match(/(\d{4}-\d{2}-\d{2})/)
  if (dateM) { result.validUntil = dateM[1]; hits++ }

  const termM = text.match(/(\d+개월\s*약정)/i) ||
                text.match(/약정[:\s]+(\d+개월)/i) ||
                text.match(/(\d+\s*month[s]?\s*commit)/i)
  if (termM) { result.term = termM[1].trim(); hits++ }

  const minM = text.match(/(\d+\s*장\s*이상)/i) || text.match(/(\d+\s*units?\s*min)/i)
  if (minM) { result.minQty = minM[1].trim(); hits++ }

  const sorted = [...products].sort((a, b) => b.model_name.length - a.model_name.length)
  const upper = text.toUpperCase()
  for (const p of sorted) {
    if (upper.includes(p.model_name.toUpperCase()) &&
        upper.includes(p.memory.replace('GB', '') + 'GB')) {
      result.productId = p.id; hits++; break
    }
  }
  if (!result.productId) {
    for (const p of sorted) {
      if (upper.includes(p.model_name.toUpperCase())) {
        result.productId = p.id; hits++; break
      }
    }
  }

  result.confidence = Math.min(Math.round((hits / 6) * 100), 100)
  return result
}

export default function QuoteRegisterTab() {
  const [mode, setMode] = useState<'quote' | 'direct'>('quote')
  const [inputType, setInputType] = useState<'text' | 'file' | 'img'>('text')
  const [rawText, setRawText] = useState('')
  const [t3ModelInput, setT3ModelInput] = useState('')
  const [t3Krw, setT3Krw] = useState('')
  const [t3Note, setT3Note] = useState('')
  const [selectedProduct, setSelectedProduct] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [parsed, setParsed] = useState<Parsed>({ confidence: 0 })
  const parseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: productsData, mutate: mutateProducts } = useSWR<{ products: GpuProduct[] }>('/api/pricing/gpu/products', fetcher)
  const { data: suppliersData, mutate: mutateSuppliers } = useSWR<{ suppliers: Supplier[] }>('/api/pricing/gpu/suppliers', fetcher)
  const { data: settingsData } = useSWR<{ usd_krw: number }>('/api/pricing/gpu/settings', fetcher)

  const allProducts = productsData?.products ?? []
  const suppliers = suppliersData?.suppliers ?? []
  const usdKrw = settingsData?.usd_krw ?? 1400
  const t3Usd = t3Krw ? (Number(t3Krw) / usdKrw).toFixed(4) : ''
  const directProducts = allProducts.filter((p) => p.pricing_mode === 'direct')

  useEffect(() => {
    if (parseTimer.current) clearTimeout(parseTimer.current)
    parseTimer.current = setTimeout(() => {
      setParsed(parseQuoteText(rawText, allProducts))
    }, 400)
    return () => { if (parseTimer.current) clearTimeout(parseTimer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, allProducts.length])

  const resetQuote = (keepMsg?: boolean) => {
    setRawText(''); setParsed({ confidence: 0 })
    if (!keepMsg) { setSuccessMsg(''); setErrorMsg('') }
  }

  const handleRegister = async () => {
    if (!parsed.productId || !parsed.unitPrice) {
      setErrorMsg('분석 결과에서 상품과 공급가를 인식하지 못했습니다. 텍스트를 보완하거나 직접 입력해 주세요.')
      return
    }
    setSubmitting(true); setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: parsed.productId,
          supplier_name: parsed.supplierName || null,
          unit_price_usd: Number(parsed.unitPrice),
          original_unit: 'USD/GPU·hr',
          term: parsed.term || null,
          min_qty: parsed.minQty || null,
          valid_until: parsed.validUntil || null,
          source_format: 'text',
        }),
      })
      if (!res.ok) throw new Error('등록 실패')
      setSuccessMsg('견적이 검토 대기 목록에 등록되었습니다.')
      mutateSuppliers(); mutateProducts(); resetQuote(true)
    } catch {
      setErrorMsg('등록 중 오류가 발생했습니다.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDirectSubmit = async () => {
    if (!t3Krw) { setErrorMsg('판매가를 입력해 주세요.'); return }
    setSubmitting(true); setErrorMsg('')
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

  const matchedProduct = allProducts.find(p => p.id === parsed.productId)
  const isNewSupplier = parsed.supplierName
    ? !suppliers.find(s => s.name.toLowerCase() === parsed.supplierName!.toLowerCase())
    : false
  const canRegister = !!parsed.productId && !!parsed.unitPrice

  return (
    <div>
      {/* 모드 선택 */}
      <div className="gpu-intake-mode">
        <button className={`gpu-im${mode === 'quote' ? ' on' : ''}`} onClick={() => setMode('quote')}>
          <div className="gpu-im-ic" style={{ background: mode === 'quote' ? 'var(--gpu-accent-soft)' : '#f3f4f8', color: 'var(--gpu-accent)' }}>
            <Sparkles size={18} />
          </div>
          <div>
            <div className="gpu-im-title">Tier 1·2 공급견적 등록</div>
            <div className="gpu-im-desc">견적서·메일·캡처를 입력 → 원가 추적 → 마진 적용</div>
          </div>
        </button>
        <button className={`gpu-im${mode === 'direct' ? ' on' : ''}`} onClick={() => setMode('direct')}>
          <div className="gpu-im-ic" style={{ background: mode === 'direct' ? 'var(--gpu-amber-soft)' : '#f3f4f8', color: 'var(--gpu-amber)' }}>
            <DollarSign size={18} />
          </div>
          <div>
            <div className="gpu-im-title">Tier 3 판매가 직접 설정</div>
            <div className="gpu-im-desc">간헐 공급 — 견적 없이 gcube 판매가를 직접 입력</div>
          </div>
        </button>
      </div>

      {successMsg && <div className="gpu-success-msg">✓ {successMsg}</div>}
      {errorMsg && <div className="gpu-error-msg">✕ {errorMsg}</div>}

      {/* Tier 1·2: 텍스트 입력 + AI 분석 결과 */}
      {mode === 'quote' && (
        <div className="gpu-grid2">
          {/* 왼쪽: 텍스트 입력만 */}
          <div className="gpu-panel gpu-card-pad">
            <div className="gpu-card-title">
              <span className="gpu-step">1</span>
              견적 내용 붙여넣기
            </div>
            <div className="gpu-card-desc">
              메일·메신저·견적서를 그대로 붙여넣으세요. AI가 자동으로 분석합니다.
            </div>

            <div className="gpu-intake-tabs">
              {(['text', 'file', 'img'] as const).map((t) => (
                <button key={t} className={`gpu-it${inputType === t ? ' on' : ''}`} onClick={() => setInputType(t)}>
                  {t === 'text' ? '텍스트' : t === 'file' ? '견적서 파일' : '이미지'}
                </button>
              ))}
            </div>

            {inputType === 'text' && (
              <textarea
                className="gpu-intake-textarea"
                style={{ minHeight: 240 }}
                placeholder={"메일·메신저 내용을 그대로 붙여넣으세요\n\n예) [GMI Cloud] H100 SXM 80GB: $2.10/GPU·hr (8장 이상)\n약정: 3개월 | 견적 유효: 2026-06-15"}
                value={rawText}
                onChange={(e) => { setRawText(e.target.value); setSuccessMsg(''); setErrorMsg('') }}
              />
            )}
            {(inputType === 'file' || inputType === 'img') && (
              <div className="gpu-dropzone" style={{ minHeight: 180 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="30" height="30"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                <div className="gpu-dropzone-title">{inputType === 'file' ? '견적서 파일을 끌어다 놓거나 클릭' : '메신저 캡처 / 견적 이미지'}</div>
                <div className="gpu-dropzone-sub">{inputType === 'file' ? 'PDF · XLSX · DOCX (최대 20MB)' : 'Ctrl+V 또는 클릭 · PNG · JPG'}</div>
              </div>
            )}

            {rawText && (
              <button className="gpu-btn" style={{ marginTop: 8, fontSize: 12 }} onClick={resetQuote}>
                초기화
              </button>
            )}
          </div>

          {/* 오른쪽: AI 분석 결과 + 등록 버튼 */}
          <div className="gpu-panel gpu-card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="gpu-card-title">
              <Sparkles size={15} style={{ color: 'var(--gpu-accent)' }} />
              AI 분석 결과
              {parsed.confidence > 0 && (
                <span className="gpu-badge gpu-badge-t2" style={{ marginLeft: 8 }}>
                  신뢰도 {parsed.confidence}%
                </span>
              )}
            </div>

            {parsed.confidence === 0 ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 0', color: '#9ca3af' }}>
                <Sparkles size={36} style={{ opacity: 0.3 }} />
                <div style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
                  왼쪽에 견적 내용을 붙여넣으면<br/>자동으로 분석합니다
                  <div style={{ marginTop: 8, fontSize: 11, color: '#d1d5db' }}>
                    예) [GMI Cloud] H100 80GB: $2.10/GPU·hr<br/>
                    약정: 3개월 | 유효: 2026-06-15
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <ParsedField label="공급사" value={parsed.supplierName} missing="인식 안됨 — 공급사명 포함 시 자동 생성" />
                <ParsedField
                  label="GPU 상품"
                  value={matchedProduct ? `${matchedProduct.model_name} ${matchedProduct.memory} ×${matchedProduct.gpu_count} (T${matchedProduct.tier})` : undefined}
                  missing="인식 안됨 — 모델명을 정확히 입력해 주세요"
                />
                <ParsedField label="공급가" value={parsed.unitPrice ? `$${parsed.unitPrice}/GPU·hr` : undefined} missing="인식 안됨" />
                <ParsedField label="유효기간" value={parsed.validUntil} />
                <ParsedField label="약정" value={parsed.term} />
                <ParsedField label="최소 수량" value={parsed.minQty} />

                {isNewSupplier && parsed.supplierName && (
                  <div className="gpu-t3-notice" style={{ marginTop: 4 }}>
                    <AlertCircle size={14} style={{ color: 'var(--gpu-amber)' }} />
                    <span>&quot;{parsed.supplierName}&quot; 새 공급사로 자동 등록됩니다</span>
                  </div>
                )}
              </div>
            )}

            {/* 등록 버튼 — 오른쪽 패널 하단 */}
            <div style={{ marginTop: 16 }}>
              {!canRegister && parsed.confidence > 0 && (
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, textAlign: 'center' }}>
                  상품과 공급가를 인식해야 등록할 수 있습니다
                </div>
              )}
              <button
                className="gpu-btn gpu-btn-primary"
                style={{ width: '100%', justifyContent: 'center', opacity: canRegister ? 1 : 0.5 }}
                onClick={handleRegister}
                disabled={submitting || !canRegister}
              >
                <Send size={15} />
                {submitting ? '등록 중…' : '견적 등록 (검토 대기)'}
              </button>
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
                <option key={p.id} value={p.id}>{p.model_name} {p.memory} (T{p.tier})</option>
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
          <button className="gpu-btn gpu-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={handleDirectSubmit} disabled={submitting}>
            {submitting ? '저장 중…' : '판매가 저장 · 가격표 반영'}
          </button>
        </div>
      )}
    </div>
  )
}

function ParsedField({ label, value, missing }: { label: string; value?: string; missing?: string }) {
  const ok = !!value
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
      borderRadius: 8, background: ok ? '#f0fdf4' : '#fafafa',
      border: `1px solid ${ok ? '#bbf7d0' : '#e5e7eb'}`
    }}>
      {ok
        ? <CheckCircle2 size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
        : <AlertCircle size={14} style={{ color: '#d1d5db', flexShrink: 0 }} />
      }
      <span style={{ fontSize: 12, color: '#6b7280', minWidth: 64 }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: ok ? '#15803d' : '#d1d5db', flex: 1 }}>
        {value ?? (missing ?? '—')}
      </span>
    </div>
  )
}
