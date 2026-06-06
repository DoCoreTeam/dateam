'use client'

import { useState, useRef, useCallback } from 'react'
import { mutate as globalMutate } from 'swr'
import { Sparkles, Send, Paperclip, X, RotateCcw } from 'lucide-react'

interface CompetitorSavedItem {
  competitor: string
  model: string
  memory: string
  price_usd: number
}

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

function getTabLabel(item: ReviewItemResult): string {
  const extracted = item.current_extracted ?? {}
  const model = typeof extracted.model_name === 'string' ? extracted.model_name : ''
  const mem = typeof extracted.memory === 'string' ? extracted.memory : ''
  return model ? `${model}${mem ? ' ' + mem : ''}` : item.product_hint ?? '모델'
}

function getConfColor(pct: number | null): string {
  if (pct == null) return '#9ca3af'
  if (pct >= 80) return 'var(--gpu-green)'
  if (pct >= 60) return 'var(--gpu-amber)'
  return 'var(--gpu-red)'
}

function ResultPanel({ item }: { item: ReviewItemResult }) {
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
              background: isNull ? '#f9fafb' : isLow ? '#fff7ed' : '#f9fafb',
              border: `1px solid ${isNull ? '#f0f0f0' : isLow ? '#fed7aa' : 'var(--color-border)'}`,
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
    </div>
  )
}

export default function QuoteRegisterTab() {
  const [rawText, setRawText] = useState('')
  const [attached, setAttached] = useState<AttachedFile | null>(null)   // 텍스트 파일(단일)
  const [images, setImages] = useState<AttachedFile[]>([])              // 이미지(다중)
  const [isDragging, setIsDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [analysisResults, setAnalysisResults] = useState<ReviewItemResult[]>([])
  const [competitorResults, setCompetitorResults] = useState<CompetitorSavedItem[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [previewItems, setPreviewItems] = useState<any[]>([])   // 반영 대기 경쟁가 원본
  const [previewSourceUrl, setPreviewSourceUrl] = useState<string | null>(null)
  const [applied, setApplied] = useState(false)
  const [applying, setApplying] = useState(false)
  const [activeTabIdx, setActiveTabIdx] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [channel, setChannel] = useState('own')
  const [isTest, setIsTest] = useState(false)
  // 실시간 스트리밍 상태
  const [liveMsgs, setLiveMsgs] = useState<string[]>([])      // 실 진행 로그
  const [streamText, setStreamText] = useState('')            // AI가 지금 쓰고 있는 실 토큰
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [supplierPreview, setSupplierPreview] = useState<any[]>([])  // 공급가 추출 미리보기(저장 X)
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)  // 공급가 미리보기 상세 펼침
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 스트림 raw JSON → 자연어 파싱 (내부 필드명 노출 안 함). 누적 버퍼에서 모델·가격을 뽑아 친화적으로 표시.
  const streamFindings: Array<{ model: string; price?: string }> = (() => {
    if (!streamText) return []
    const found: Array<{ model: string; price?: string }> = []
    const re = /"model_name"\s*:\s*"([^"]+)"(?:[\s\S]*?"(?:unit_price_usd|price_usd)"\s*:\s*([0-9.]+))?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(streamText)) !== null) {
      if (m[1] && m[1].trim()) found.push({ model: m[1].trim(), price: m[2] })
    }
    return found.slice(-6)
  })()

  // (실 진행은 SSE progress 이벤트로 표시 — 가짜 타이머 제거)

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
        // 다중 이미지 — 누적 추가
        setImages((p) => [...p, { name: file.name, mimeType: file.type, previewUrl: url, base64Data: base64 }])
      }
      reader.readAsDataURL(file)
    } else {
      setAttached({ name: file.name, mimeType: file.type })
    }
  }, [])

  // 여러 파일 한 번에 처리
  const processFiles = useCallback((files: FileList | File[]) => {
    for (const f of Array.from(files)) processFile(f)
  }, [processFile])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false)
    if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files)
  }, [processFiles])

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData.items
    const imgs: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) { const f = item.getAsFile(); if (f) imgs.push(f) }
    }
    if (imgs.length) { processFiles(imgs); e.preventDefault(); return }
  }, [processFiles])

  const reset = useCallback(() => {
    setRawText(''); setAttached(null); setImages([]); setAnalysisResults([])
    setCompetitorResults([]); setActiveTabIdx(0); setErrorMsg(''); setSuccessMsg('')
    setLiveMsgs([]); setStreamText(''); setSupplierPreview([]); setCommitted(false)
    setPreviewItems([]); setPreviewSourceUrl(null); setApplied(false); setExpandedIdx(null)
  }, [])

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim() || attached?.textContent?.trim() || ''
    const imgPayload = images.filter((im) => im.base64Data).map((im) => ({ data: im.base64Data as string, mimeType: im.mimeType }))
    const hasImage = imgPayload.length > 0
    if (!text && !hasImage) { setErrorMsg('텍스트 또는 이미지를 입력해 주세요.'); return }
    const effectiveChannel = hasImage && !text ? 'img' : channel

    setAnalyzing(true); setErrorMsg(''); setSuccessMsg('')
    setAnalysisResults([]); setCompetitorResults([]); setActiveTabIdx(0)
    setPreviewItems([]); setPreviewSourceUrl(null); setApplied(false)
    setLiveMsgs([]); setStreamText(''); setSupplierPreview([]); setCommitted(false)

    // ── 텍스트·이미지 모두 SSE 실시간 스트리밍 ──
    try {
      const payload: Record<string, unknown> = { text, channel: effectiveChannel, is_test: isTest }
      if (hasImage) payload.images = imgPayload
      const res = await fetch('/api/pricing/gpu/review/stream', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok || !res.body) { setErrorMsg('AI 분석 시작 실패'); setAnalyzing(false); return }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const chunks = buf.split('\n\n')
        buf = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const evMatch = chunk.match(/event: (.+)/)
          const dataMatch = chunk.match(/data: (.+)/)
          if (!evMatch || !dataMatch) continue
          const ev = evMatch[1].trim()
          let data: Record<string, unknown> = {}
          try { data = JSON.parse(dataMatch[1]) } catch { continue }
          if (ev === 'progress') {
            setLiveMsgs((prev) => [...prev, String(data.msg ?? '')])
          } else if (ev === 'token') {
            setStreamText((prev) => (prev + String(data.delta ?? '')).slice(-1200))
          } else if (ev === 'preview') {
            const items = (data.items ?? []) as unknown[]
            if (data.type === 'competitor') {
              const cp = items as Array<{ competitor_name: string; model_name: string; memory?: string; price_usd: number }>
              setCompetitorResults(cp.map((p) => ({ competitor: p.competitor_name, model: p.model_name, memory: p.memory ?? '', price_usd: p.price_usd })))
              setPreviewItems(items); setPreviewSourceUrl((data.source_url as string) ?? null)
            } else {
              setSupplierPreview(items)
            }
          } else if (ev === 'error') {
            setErrorMsg(String(data.msg ?? 'AI 분석 실패'))
          }
        }
      }
    } catch {
      setErrorMsg('서버 연결 실패')
    } finally {
      setAnalyzing(false); setStreamText('')
    }
  }, [rawText, attached, images, channel, isTest])

  // 공급가 미리보기 → 검토 대기 저장(버튼)
  const commitSupplier = useCallback(async () => {
    if (supplierPreview.length === 0) return
    setCommitting(true); setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/review/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: supplierPreview, channel, is_test: isTest }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErrorMsg(j.error ?? '저장 실패'); return }
      await globalMutate('/api/pricing/gpu/review?status=pending')
      setCommitted(true)
      setSuccessMsg(`공급가 ${j.count}건이 검토 대기에 추가되었습니다.`)
    } catch { setErrorMsg('저장 실패') } finally { setCommitting(false) }
  }, [supplierPreview, channel, isTest])

  // 경쟁가 미리보기를 시장비교에 실제 반영(저장)
  const applyCompetitor = useCallback(async () => {
    if (previewItems.length === 0) return
    setApplying(true); setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/market/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: previewItems, source_url: previewSourceUrl }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErrorMsg(j.error ?? '반영 실패'); return }
      await globalMutate('/api/pricing/gpu/market')
      setApplied(true)
      setSuccessMsg(`경쟁사 가격 ${j.count}건이 시장 비교에 반영되었습니다.`)
    } catch {
      setErrorMsg('반영 실패')
    } finally { setApplying(false) }
  }, [previewItems, previewSourceUrl])

  const hasResults = analysisResults.length > 0
  const hasCompetitorResults = competitorResults.length > 0

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
            가격·견적 정보 붙여넣기
          </div>
          <div className="gpu-card-desc">
            경쟁사 가격 · 공급사 견적 · 가격 페이지 내용 — 무엇이든 붙여넣으면 AI가 종류를 자동 판별합니다.
            <br />🟢 경쟁사 가격 → 시장 비교에 반영 / 🟡 공급사 견적 → 검토 대기 후 가격표 반영.
            클라우드사 가상 인스턴스명은 보유 스펙과 대조해 표준 모델로 매핑합니다.
          </div>

          <div
            style={{
              position: 'relative', borderRadius: 10,
              border: `1.5px ${isDragging ? 'dashed var(--gpu-accent)' : 'solid var(--color-border)'}`,
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
              placeholder={"메일·메신저·가격표 내용을 그대로 붙여넣으세요. AI가 경쟁사/공급가를 자동 분류합니다.\n\n예1) 공급가 — [GMI Cloud] H100 SXM 80GB: $2.10/GPU·hr (8장 이상)\n약정: 3개월 | 가용: 32장 즉시\n\n예2) 경쟁사 — NHN Cloud 인스턴스 80GB HBM3 SXM, 시간당 5,500원\n(가상 인스턴스명도 스펙으로 표준 모델 매핑)"}
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

          {/* 텍스트 파일 첨부(단일) */}
          {attached && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: '#f8faff', border: '1px solid #e0e7ff' }}>
              <Paperclip size={16} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#374151', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attached.name}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#9ca3af' }} onClick={() => setAttached(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* 이미지 첨부(다중) — 썸네일 그리드 */}
          {images.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }} data-testid="image-thumbs">
              {images.map((im, i) => (
                <div key={i} style={{ position: 'relative', width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: '1px solid #e0e7ff' }}>
                  {im.previewUrl && <img src={im.previewUrl} alt={im.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                  <button onClick={() => setImages((p) => p.filter((_, idx) => idx !== i))} title="제거"
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(15,23,42,.7)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
              <span style={{ alignSelf: 'center', fontSize: 11.5, color: '#64748b' }}>{images.length}장</span>
            </div>
          )}

          <input
            id="gpu-file-input-v2"
            type="file"
            multiple
            accept=".txt,.csv,.md,.json,.png,.jpg,.jpeg,.webp"
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = '' }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--gpu-muted)' }}>채널</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: 6, border: '2px solid var(--border-color)', fontSize: 12 }}
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
              disabled={analyzing || (!rawText.trim() && !attached && images.length === 0)}
            >
              <Sparkles size={14} />
              {analyzing ? 'AI 분석 중…' : 'AI 분석 시작'}
            </button>
            {(rawText || attached || images.length > 0 || hasResults) && (
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
            {analysisResults.length > 1 && (
              <span className="gpu-badge" style={{ marginLeft: 8, background: 'var(--gpu-accent)', color: '#fff', fontSize: 10 }}>
                {analysisResults.length}개 모델 감지
              </span>
            )}
          </div>

          {analyzing ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 0', overflowY: 'auto' }} data-testid="analyze-live">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Sparkles size={18} className="gpu-analyzing-icon" />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-accent)' }}>AI가 실시간으로 분석 중…</span>
              </div>
              {/* 실 진행 로그 */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }} data-testid="analyze-live-log">
                {liveMsgs.map((m, i) => {
                  const isLast = i === liveMsgs.length - 1
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: isLast ? '#0f172a' : '#94a3b8' }}>
                      <span style={{ color: isLast ? 'var(--gpu-accent)' : '#cbd5e1' }}>{isLast ? '▸' : '✓'}</span>
                      <span>{m}</span>
                    </div>
                  )
                })}
              </div>
              {/* AI가 찾고 있는 항목 — 자연어 파싱(raw JSON 비노출) */}
              {streamFindings.length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>찾은 항목</div>
                  {streamFindings.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, background: 'var(--color-bg)', border: '2px solid var(--border-color)', fontSize: 12 }}>
                      <span style={{ color: 'var(--gpu-accent)' }}>✦</span>
                      <span style={{ fontWeight: 600, color: '#334155', flex: 1 }}>{f.model}</span>
                      {f.price && <span style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>${f.price}/hr</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (supplierPreview.length > 0 || hasCompetitorResults) && !hasResults ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8, overflowY: 'auto' }}>
              {/* 경쟁사 가격 (혼합 시 위) */}
              {hasCompetitorResults && (
                <div data-testid="competitor-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span className="gpu-badge" style={{ background: 'var(--gpu-accent)', color: '#fff', fontSize: 10 }}>🟢 경쟁사 가격</span>
                    <span className="gpu-badge" style={{ background: applied ? 'var(--gpu-green)' : 'var(--gpu-amber)', color: '#fff', fontSize: 10 }}>
                      {applied ? '반영 완료' : '반영 대기'}
                    </span>
                  </div>
                  {competitorResults.map((item, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                      <span style={{ fontSize: 12, color: '#374151', fontWeight: 600, minWidth: 80 }}>{item.competitor}</span>
                      <span style={{ fontSize: 12, color: '#6b7280', flex: 1 }}>{item.model} {item.memory}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-accent)' }}>${item.price_usd}/hr</span>
                    </div>
                  ))}
                  {!applied ? (
                    <button onClick={applyCompetitor} disabled={applying} className="gpu-btn gpu-btn-primary" style={{ marginTop: 4, justifyContent: 'center', gap: 6 }}>
                      {applying ? '반영 중…' : `시장비교에 반영 (${competitorResults.length}건)`}
                    </button>
                  ) : (
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d' }}>
                      ✓ 시장 비교 탭에 반영되었습니다.
                    </div>
                  )}
                </div>
              )}
              {/* 공급사 견적 */}
              {supplierPreview.length > 0 && (
                <div data-testid="supplier-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span className="gpu-badge" style={{ background: 'var(--brand)', color: '#fff', fontSize: 10 }}>🟡 공급사 견적</span>
                    <span className="gpu-badge" style={{ background: committed ? 'var(--gpu-green)' : 'var(--gpu-amber)', color: '#fff', fontSize: 10 }}>
                      {committed ? '검토 대기 추가됨' : '저장 대기'}
                    </span>
                  </div>
                  {supplierPreview.map((it, i) => {
                    const ex = (it?.extracted ?? {}) as Record<string, unknown>
                    const name = `${ex.model_name ?? ''} ${ex.memory ?? ''}`.trim()
                    const priceVal = ex.unit_price_usd ?? ex.price_usd
                    const price = priceVal != null ? `$${priceVal}/hr` : '—'
                    const open = expandedIdx === i
                    const detailRows: Array<[string, string]> = []
                    // 객체/배열은 스킵(내부 구조 노출·[object Object] 방지) — 원시값만 자연어로
                    const push = (label: string, v: unknown) => {
                      if (v === null || v === undefined) return
                      if (typeof v === 'object') return
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
                      <div key={i} style={{ borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', overflow: 'hidden' }}>
                        <div onClick={() => setExpandedIdx(open ? null : i)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', cursor: 'pointer' }}>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{open ? '▾' : '▸'}</span>
                          <span style={{ fontSize: 12, color: '#374151', fontWeight: 600, flex: 1 }}>{name || '(모델 미상)'}</span>
                          {ex.supplier ? <span style={{ fontSize: 11, color: '#6b7280' }}>{String(ex.supplier)}</span> : null}
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--brand-dark)' }}>{price}</span>
                        </div>
                        {open && (
                          <div style={{ padding: '4px 12px 10px 28px', display: 'flex', flexDirection: 'column', gap: 3, borderTop: '1px solid #ddd6fe', background: '#f5f3ff' }}>
                            {detailRows.length > 0 ? detailRows.map(([k, v]) => (
                              <div key={k} style={{ display: 'flex', fontSize: 11.5, gap: 8 }}>
                                <span style={{ color: '#8b8b9e', minWidth: 64 }}>{k}</span>
                                <span style={{ color: '#374151', fontWeight: 500 }}>{v}</span>
                              </div>
                            )) : <span style={{ fontSize: 11.5, color: '#94a3b8' }}>추가 상세 정보 없음</span>}
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {!committed ? (
                    <button onClick={commitSupplier} disabled={committing} className="gpu-btn gpu-btn-primary" data-testid="supplier-commit-btn" style={{ marginTop: 4, justifyContent: 'center', gap: 6 }}>
                      {committing ? '저장 중…' : `검토 대기에 추가 (${supplierPreview.length}건)`}
                    </button>
                  ) : (
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d' }}>
                      ✓ 검토 대기 탭에 추가되었습니다. 본부장 검토 후 가격표에 반영됩니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : !hasResults ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 0', color: '#9ca3af' }}>
              <Sparkles size={36} style={{ opacity: 0.3 }} />
              <div style={{ textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
                왼쪽에 내용을 붙여넣고<br />&quot;AI 분석 시작&quot;을 누르세요
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8, overflowY: 'auto' }}>
              {/* 탭 (2개 이상일 때만 표시) */}
              {analysisResults.length > 1 && (
                <div
                  data-testid="multi-model-tabs"
                  style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: '2px solid var(--color-border)', paddingBottom: 8, marginBottom: 4 }}
                >
                  {analysisResults.map((item, idx) => {
                    const label = getTabLabel(item)
                    const conf = item.overall_confidence
                    const isActive = idx === activeTabIdx
                    return (
                      <button
                        key={item.id}
                        data-testid={`model-tab-${idx}`}
                        onClick={() => setActiveTabIdx(idx)}
                        style={{
                          padding: '5px 12px',
                          borderRadius: '6px 6px 0 0',
                          border: `1.5px solid ${isActive ? 'var(--gpu-accent)' : 'var(--color-border)'}`,
                          borderBottom: isActive ? '2px solid #fff' : '1.5px solid var(--color-border)',
                          background: isActive ? '#fff' : 'var(--color-bg)',
                          color: isActive ? 'var(--gpu-accent)' : '#6b7280',
                          fontWeight: isActive ? 700 : 500,
                          fontSize: 12,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                          marginBottom: -2,
                        }}
                      >
                        <span
                          style={{
                            width: 6, height: 6, borderRadius: '50%',
                            background: getConfColor(conf),
                            flexShrink: 0,
                          }}
                        />
                        {label}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* 선택된 모델 결과 */}
              {analysisResults[activeTabIdx] && (
                <ResultPanel item={analysisResults[activeTabIdx]} />
              )}

              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d' }}>
                <Send size={12} style={{ marginRight: 5, verticalAlign: 'middle' }} />
                {analysisResults.length > 1
                  ? `${analysisResults.length}개 항목이 검토 대기에 추가되었습니다. 본부장 검토 후 가격표에 반영됩니다.`
                  : '검토 대기 탭에 추가되었습니다. 본부장 검토 후 가격표에 반영됩니다.'
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
