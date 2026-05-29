'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { mutate as globalMutate } from 'swr'
import { Sparkles, Send, Paperclip, X, RotateCcw } from 'lucide-react'

interface ReviewItemResult {
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
  available_full:    { label: '재고 있음',  color: '#15803d' },
  available_partial: { label: '일부 가능',  color: '#b45309' },
  out_of_stock:      { label: '재고 없음',  color: '#dc2626' },
  declined:          { label: '공급 거절',  color: '#7c3aed' },
  pending:           { label: '확인 중',    color: '#6b7280' },
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

interface AttachedFile {
  name: string
  mimeType: string
  previewUrl?: string
  textContent?: string
  base64Data?: string
}

export default function QuoteRegisterTab() {
  const [rawText, setRawText] = useState('')
  const [attached, setAttached] = useState<AttachedFile | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeStep, setAnalyzeStep] = useState(0)
  const [analysisResult, setAnalysisResult] = useState<ReviewItemResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [channel, setChannel] = useState('own')
  const [isTest, setIsTest] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const ANALYZE_STEPS = [
    { msg: '요청 전송 중…', sub: 'AI 서버에 데이터를 전송하고 있습니다' },
    { msg: 'Gemini AI 분석 중…', sub: '이미지·텍스트에서 GPU 견적 정보를 인식하고 있습니다' },
    { msg: '견적 정보 추출 중…', sub: '모델명·단가·약정·수량 정보를 구조화하고 있습니다' },
    { msg: '신뢰도 평가 중…', sub: '추출된 각 항목의 정확도를 검증하고 있습니다' },
    { msg: '결과 정리 중…', sub: '검토 대기 목록에 등록할 데이터를 준비하고 있습니다' },
  ]

  useEffect(() => {
    if (!analyzing) { setAnalyzeStep(0); return }
    const delays = [0, 2500, 5000, 8000, 11000]
    const timers = delays.map((delay, i) =>
      setTimeout(() => setAnalyzeStep(i), delay)
    )
    return () => timers.forEach(clearTimeout)
  }, [analyzing])

  const processFile = useCallback((file: File) => {
    const isText = file.type.startsWith('text/') || /\.(txt|csv|md|json)$/i.test(file.name)
    const isImage = file.type.startsWith('image/')

    if (isText) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setRawText(content)
        setAttached({ name: file.name, mimeType: file.type, textContent: content })
      }
      reader.readAsText(file)
    } else if (isImage) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string
        const base64 = dataUrl.split(',')[1] ?? ''
        const url = URL.createObjectURL(file)
        setAttached({ name: file.name, mimeType: file.type, previewUrl: url, base64Data: base64 })
      }
      reader.readAsDataURL(file)
    } else {
      setAttached({ name: file.name, mimeType: file.type })
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }, [processFile])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) { processFile(file); e.preventDefault(); return }
      }
    }
  }, [processFile])

  const reset = useCallback(() => {
    setRawText(''); setAttached(null); setAnalysisResult(null)
    setErrorMsg(''); setSuccessMsg('')
  }, [])

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim() || attached?.textContent?.trim() || ''
    const hasImage = !!attached?.base64Data
    if (!text && !hasImage) { setErrorMsg('텍스트 또는 이미지를 입력해 주세요.'); return }

    const effectiveChannel = hasImage && !text ? 'img' : channel

    setAnalyzing(true); setErrorMsg(''); setSuccessMsg(''); setAnalysisResult(null)
    try {
      const payload: Record<string, unknown> = { text, channel: effectiveChannel, is_test: isTest }
      if (hasImage) {
        payload.imageData = { data: attached!.base64Data, mimeType: attached!.mimeType }
      }
      const res = await fetch('/api/pricing/gpu/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!res.ok) { setErrorMsg(j.error ?? 'AI 분석 실패'); return }
      setAnalysisResult(j.item)
      await globalMutate('/api/pricing/gpu/review?status=pending')
      setSuccessMsg('AI 분석이 완료되어 검토 대기 탭에 추가되었습니다.')
    } catch {
      setErrorMsg('서버 연결 실패')
    } finally {
      setAnalyzing(false)
    }
  }, [rawText, attached, channel, isTest])

  const result = analysisResult
  const extracted = result?.current_extracted ?? {}
  const confidence = result?.current_confidence ?? {}
  const overallPct = result?.overall_confidence ?? 0
  const impact = IMPACT_CONFIG[result?.impact_level ?? 'steady'] ?? IMPACT_CONFIG.steady

  return (
    <div>
      {successMsg && (
        <div className="gpu-success-msg" style={{ marginBottom: 12 }}>
          ✓ {successMsg}
          <button className="gpu-btn" style={{ marginLeft: 12, fontSize: 11 }} onClick={reset}>새 견적 입력</button>
        </div>
      )}
      {errorMsg && <div className="gpu-error-msg" style={{ marginBottom: 12 }}>✕ {errorMsg}</div>}

      <div className="gpu-grid2">
        {/* 왼쪽: 입력 */}
        <div className="gpu-panel gpu-card-pad">
          <div className="gpu-card-title">
            <span className="gpu-step">1</span>
            견적·가용량 정보 붙여넣기
          </div>
          <div className="gpu-card-desc">
            메일·메신저·견적서를 그대로 붙여넣으면 Gemini AI가 가격·수량·공급사를 자동 추출합니다.
          </div>

          <div
            style={{
              position: 'relative', borderRadius: 10,
              border: `1.5px ${isDragging ? 'dashed var(--gpu-accent)' : 'solid #e5e7eb'}`,
              background: isDragging ? 'var(--gpu-accent-soft)' : '#fff',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <textarea
              ref={textareaRef}
              className="gpu-intake-textarea"
              style={{ minHeight: 180, border: 'none', borderRadius: 10, background: 'transparent', resize: 'vertical' }}
              placeholder={"메일·메신저 내용을 그대로 붙여넣으세요.\n\n예) [GMI Cloud] H100 SXM 80GB: $2.10/GPU·hr (8장 이상)\n약정: 3개월 | 견적 유효: 2026-06-15\n가용: 현재 32장 즉시 공급 가능"}
              value={rawText}
              onChange={(e) => { setRawText(e.target.value); setSuccessMsg(''); setErrorMsg('') }}
              onPaste={handlePaste}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderTop: '1px solid #f0f0f0' }}>
              <label
                htmlFor="gpu-file-input-v2"
                className="gpu-btn"
                style={{ padding: '4px 8px', fontSize: 12, gap: 4, color: '#6b7280', cursor: 'pointer' }}
              >
                <Paperclip size={13} /> 파일 첨부
              </label>
              <span style={{ fontSize: 11, color: '#d1d5db' }}>Ctrl+V로 이미지 붙여넣기 가능</span>
            </div>
          </div>

          {attached && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: '#f8faff', border: '1px solid #e0e7ff' }}>
              {attached.previewUrl
                ? <img src={attached.previewUrl} alt={attached.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                : <Paperclip size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
              }
              <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attached.name}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af' }} onClick={() => setAttached(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          <input
            id="gpu-file-input-v2"
            type="file"
            accept=".txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) processFile(f); e.target.value = '' }}
          />

          {/* 채널 & 테스트 설정 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--gpu-muted)' }}>채널</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #e5e7eb', fontSize: 12 }}
              >
                <option value="own">자체</option>
                <option value="mail">메일</option>
                <option value="msg">메신저</option>
                <option value="pdf">PDF</option>
                <option value="img">이미지</option>
              </select>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} style={{ accentColor: 'var(--gpu-accent)' }} />
              테스트 데이터로 태깅
            </label>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              className="gpu-btn gpu-btn-primary"
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={handleAnalyze}
              disabled={analyzing || (!rawText.trim() && !attached)}
            >
              <Sparkles size={14} />
              {analyzing ? 'AI 분석 중…' : 'AI 분석 시작'}
            </button>
            {(rawText || attached || result) && (
              <button className="gpu-btn" onClick={reset}>
                <RotateCcw size={13} /> 초기화
              </button>
            )}
          </div>
        </div>

        {/* 오른쪽: AI 분석 결과 */}
        <div className="gpu-panel gpu-card-pad" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="gpu-card-title">
            <Sparkles size={15} style={{ color: 'var(--gpu-accent)' }} />
            AI 추출 결과
            {result && (
              <span
                className="gpu-badge"
                style={{ marginLeft: 8, background: overallPct >= 80 ? 'var(--gpu-green)' : overallPct >= 60 ? 'var(--gpu-amber)' : 'var(--gpu-red)', color: '#fff', fontSize: 10 }}
              >
                신뢰도 {overallPct}%
              </span>
            )}
          </div>

          {analyzing ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, padding: '32px 0' }}>
              <Sparkles size={36} className="gpu-analyzing-icon" />
              <div style={{ textAlign: 'center' }}>
                <div className="gpu-analyzing-text" style={{ fontSize: 14, fontWeight: 600, color: 'var(--gpu-accent)' }} data-testid="analyze-step-msg">
                  {ANALYZE_STEPS[analyzeStep]?.msg ?? ANALYZE_STEPS[0].msg}
                </div>
                <div style={{ fontSize: 12, color: 'var(--gpu-muted)', marginTop: 4 }}>
                  {ANALYZE_STEPS[analyzeStep]?.sub ?? ANALYZE_STEPS[0].sub}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                {ANALYZE_STEPS.map((_, i) => (
                  <div
                    key={i}
                    style={{
                      width: 6, height: 6, borderRadius: '50%',
                      background: i <= analyzeStep ? 'var(--gpu-accent)' : '#e5e7eb',
                      transition: 'background 0.4s',
                    }}
                  />
                ))}
              </div>
            </div>
          ) : !result ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 0', color: '#9ca3af' }}>
              <Sparkles size={36} style={{ opacity: 0.3 }} />
              <div style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
                왼쪽에 내용을 붙여넣고<br/>&quot;AI 분석 시작&quot;을 누르세요
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, overflowY: 'auto' }}>
              {/* 임팩트 배지 */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                <span className="gpu-badge" style={{ background: impact.color, color: '#fff', fontSize: 10 }}>
                  {impact.label}
                </span>
                {result.product_hint && (
                  <span className="gpu-badge gpu-badge-gray">{result.product_hint}</span>
                )}
                {result.supplier_hint
                  ? <span className="gpu-badge gpu-badge-gray">{result.supplier_hint}</span>
                  : <span className="gpu-badge" style={{ background: 'var(--gpu-amber)', color: '#fff', fontSize: 10 }}>⚠ 공급사 미확인</span>
                }
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
                      background: isNull ? '#f9fafb' : isLow ? '#fff7ed' : '#f9fafb',
                      border: `1px solid ${isNull ? '#f0f0f0' : isLow ? '#fed7aa' : '#e5e7eb'}`,
                      opacity: isNull ? 0.55 : 1,
                    }}
                  >
                    <span style={{ fontSize: 12, color: 'var(--gpu-muted)', minWidth: 80 }}>{CONF_LABELS[key] ?? key}</span>
                    <span style={{ fontSize: 13, fontWeight: isNull ? 400 : 600, flex: 1, color: isNull ? '#9ca3af' : '#111827', fontStyle: isNull ? 'italic' : 'normal' }}>
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

              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d' }}>
                <Send size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                검토 대기 탭에 추가되었습니다. 본부장 검토 후 가격표에 반영됩니다.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
