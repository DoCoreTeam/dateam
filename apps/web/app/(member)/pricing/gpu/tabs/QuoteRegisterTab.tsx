'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useSWRConfig } from 'swr'
import { Sparkles, Send, Paperclip, X, RotateCcw } from 'lucide-react'
import IntakeGateSummary, { type GateRow } from './IntakeGateSummary'
import CatalogUploadSection from '@/components/pricing/gpu/CatalogUploadSection'
import { useFormCore } from '@/lib/forms/useFormCore'
import DraftRestoreBanner from '@/components/ui/DraftRestoreBanner'
import { classifyFile, ACCEPT_ALL, formatMB } from '@/lib/gpu/intake-files'
import { fmtUSD } from '@/lib/gpu/format-price'
import { downscaleImage } from '@/lib/gpu/image-downscale'
import {
  SupplierPreviewRow,
  supplierRowToCompetitor,
  competitorRowToSupplier,
  isPriceUnknown,
  fmtOriginalPrice,
  ResultPanel,
  getTabLabel,
  getConfColor,
  type CompetitorSavedItem,
  type ReviewItemResult,
} from './QuoteRegisterPreview'

// 행수 대조 결과(백엔드 done 페이로드). 추출<원본이면 누락 경고 표시.
interface Reconciliation {
  source_rows: number
  extracted: number
  missing: number
  missing_labels: string[]
}

interface AttachedFile {
  name: string
  mimeType: string
  textContent?: string
}

// 단일 드롭존 → stream(이미지/PDF) 경로 첨부. 원본 File을 보관해 multipart로 전송(base64 인플레 회피).
interface StreamFile {
  file: File
  name: string
  kind: 'image' | 'pdf'
  previewUrl?: string
}

export default function QuoteRegisterTab() {
  // Context-aware mutate — 전역 mutate는 SWRProvider 영속캐시를 못 건드림(저장 후 미반영 회귀 방지)
  const { mutate } = useSWRConfig()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rawTextDraft = useFormCore<string>({ formId: 'gpu-intake', initial: '', scopeRef: textareaRef })
  const rawText = rawTextDraft.value
  const setRawText = rawTextDraft.set
  const [attached, setAttached] = useState<AttachedFile | null>(null)   // 텍스트 파일(단일)
  const [streamFiles, setStreamFiles] = useState<StreamFile[]>([])      // 이미지/PDF(다중) — multipart 전송
  const [catalogFile, setCatalogFile] = useState<File | null>(null)     // xlsx/csv 파일 → catalog 자동 흡수
  // 언마운트 시 미해제 objectURL 정리(누수 방어) — ref로 최신 streamFiles 추적.
  const streamFilesRef = useRef<StreamFile[]>([])
  streamFilesRef.current = streamFiles
  useEffect(() => () => { streamFilesRef.current.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl)) }, [])
  const [isDragging, setIsDragging] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  // OS 감지(단축키 힌트 ⌘ vs Ctrl) — 클라이언트 마운트 후 설정해 hydration 불일치 방지.
  const [isMac, setIsMac] = useState(false)
  useEffect(() => {
    const p = `${navigator.platform} ${navigator.userAgent}`
    setIsMac(/Mac|iPhone|iPad|iPod/i.test(p))
  }, [])
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
  // 인입 종류 선언 — 넣기 전에 "무엇을 넣는지" 사용자가 고른다(추측 제거, 헌법 제1조). 'auto'면 기존 자동판별.
  const [declaredKind, setDeclaredKind] = useState<'auto' | 'supplier' | 'competitor'>('auto')
  // 실시간 스트리밍 상태
  const [liveMsgs, setLiveMsgs] = useState<string[]>([])      // 실 진행 로그
  const [streamText, setStreamText] = useState('')            // AI가 지금 쓰고 있는 실 토큰
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [supplierPreview, setSupplierPreview] = useState<any[]>([])  // 공급가 추출 미리보기(저장 X)
  const [committing, setCommitting] = useState(false)
  const [committed, setCommitted] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)  // 공급가 미리보기 상세 펼침
  const [truncated, setTruncated] = useState(false)  // 상한 도달로 일부 항목이 잘림(백엔드 고지)
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null)  // 원본 행수 대조(누락 감지)

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

  // 단일 드롭존 — 파일 종류 자동 분기(classifyFile SSOT). 무음 실패 금지: 상한초과·미지원은 안내.
  const processFile = useCallback(async (file: File) => {
    const d = classifyFile(file)
    if (d.tooLarge) {
      setErrorMsg(`${file.name}: 파일이 너무 큽니다(최대 ${formatMB(d.maxBytes)}). 더 작은 파일로 나눠 올려주세요.`)
      return
    }
    if (d.route === 'catalog') {
      // xlsx/csv 파일 → catalog 자동 흡수(controlled CatalogUploadSection이 처리)
      setCatalogFile(file)
      return
    }
    if (d.route === 'text') {
      if (d.kind === 'unknown') {
        setErrorMsg(`${file.name}: 지원하지 않는 형식입니다. 텍스트·이미지·PDF·엑셀·CSV를 올려 주세요.`)
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        setRawText(content)
        setAttached({ name: file.name, mimeType: file.type, textContent: content })
      }
      reader.readAsText(file)
      return
    }
    // stream 경로(이미지/PDF) — 원본 File 보관(multipart). 이미지 大용량은 클라이언트 다운스케일.
    const finalFile = d.kind === 'image' && d.shouldDownscale ? await downscaleImage(file) : file
    const previewUrl = d.kind === 'image' ? URL.createObjectURL(finalFile) : undefined
    setStreamFiles((p) => [...p, { file: finalFile, name: file.name, kind: d.kind === 'pdf' ? 'pdf' : 'image', previewUrl }])
  }, [])

  // 여러 파일 한 번에 처리(혼합 가능 — 각자 자동 분기)
  const processFiles = useCallback((files: FileList | File[]) => {
    for (const f of Array.from(files)) void processFile(f)
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
    setRawText(''); rawTextDraft.clear(); setAttached(null)
    setStreamFiles((p) => { p.forEach((s) => s.previewUrl && URL.revokeObjectURL(s.previewUrl)); return [] })
    setCatalogFile(null); setAnalysisResults([])
    setCompetitorResults([]); setActiveTabIdx(0); setErrorMsg(''); setSuccessMsg('')
    setLiveMsgs([]); setStreamText(''); setSupplierPreview([]); setCommitted(false)
    setPreviewItems([]); setPreviewSourceUrl(null); setApplied(false); setExpandedIdx(null)
    setTruncated(false); setReconciliation(null)
  }, [])

  const handleAnalyze = useCallback(async () => {
    const text = rawText.trim() || attached?.textContent?.trim() || ''
    const hasFiles = streamFiles.length > 0
    if (!text && !hasFiles) { setErrorMsg('텍스트 또는 파일을 입력해 주세요.'); return }

    setAnalyzing(true); setErrorMsg(''); setSuccessMsg('')
    setAnalysisResults([]); setCompetitorResults([]); setActiveTabIdx(0)
    setPreviewItems([]); setPreviewSourceUrl(null); setApplied(false)
    setLiveMsgs([]); setStreamText(''); setSupplierPreview([]); setCommitted(false); setTruncated(false)
    setReconciliation(null)

    // ── multipart 전송(이미지/PDF raw 바이너리 — base64 인플레 없음) → SSE 실시간 스트리밍 ──
    try {
      const fd = new FormData()
      fd.append('text', text)
      if (declaredKind !== 'auto') fd.append('declared_kind', declaredKind)  // 사용자가 종류를 선택했으면 추측 대신 그 값으로 확정(헌법 제1조)
      for (const sf of streamFiles) fd.append('files', sf.file, sf.name)
      // Content-Type 헤더 미지정 — 브라우저가 multipart boundary 자동 설정
      const res = await fetch('/api/pricing/gpu/review/stream', { method: 'POST', body: fd })
      if (!res.ok || !res.body) { setErrorMsg('AI 분석 시작 실패'); setAnalyzing(false); return }
      // AI 분석을 실행했으면 임시저장(복원 draft)은 제거 — 새로고침 시 복원 배너가 다시 뜨지 않게.
      //  (분석을 안 누르면 draft 유지되어 복원됨. clear는 persist만 지우고 textarea 값은 그대로 둠.)
      rawTextDraft.clear()
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
          // 잘림 고지(silent truncation 제거) — 백엔드가 어느 이벤트로 줄지 불확실하므로 옵셔널 방어
          if (data.truncated === true || data.step === 'truncated') setTruncated(true)
          if (ev === 'progress') {
            setLiveMsgs((prev) => [...prev, String(data.msg ?? '')])
          } else if (ev === 'token') {
            setStreamText((prev) => (prev + String(data.delta ?? '')).slice(-1200))
          } else if (ev === 'preview') {
            const items = (data.items ?? []) as unknown[]
            if (data.type === 'competitor') {
              const cp = items as Array<{ competitor_name: string; model_name: string; memory?: string; price_usd: number; original_currency?: string | null; original_price?: number | null }>
              setCompetitorResults(cp.map((p) => ({ competitor: p.competitor_name, model: p.model_name, memory: p.memory ?? '', price_usd: p.price_usd, original_currency: p.original_currency ?? null, original_price: p.original_price ?? null })))
              setPreviewItems(items); setPreviewSourceUrl((data.source_url as string) ?? null)
            } else {
              setSupplierPreview(items)
            }
          } else if (ev === 'done') {
            // 행수 대조 결과 — 방어적으로 형태 검증 후 누락(missing>0)일 때만 보관.
            const rc = data.reconciliation as Partial<Reconciliation> | null | undefined
            if (rc && typeof rc.missing === 'number' && rc.missing > 0) {
              setReconciliation({
                source_rows: Number(rc.source_rows ?? 0),
                extracted: Number(rc.extracted ?? 0),
                missing: rc.missing,
                missing_labels: Array.isArray(rc.missing_labels)
                  ? rc.missing_labels.map((l) => String(l))
                  : [],
              })
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
  }, [rawText, attached, streamFiles, rawTextDraft])

  // 공급가 미리보기 → 검토 대기 저장(버튼). 가격미상 행은 자동 반영 금지 — 확정에서 제외.
  const commitSupplier = useCallback(async () => {
    if (supplierPreview.length === 0) return
    const committable = supplierPreview.filter((it) => !isPriceUnknown(it))
    const skipped = supplierPreview.length - committable.length
    if (committable.length === 0) {
      setErrorMsg('가격미상 항목만 있어 자동 반영할 수 없습니다 — 가격을 직접 입력해 주세요.')
      return
    }
    setCommitting(true); setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/review/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: committable, channel, is_test: isTest }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErrorMsg(j.error ?? '저장 실패'); return }
      await mutate('/api/pricing/gpu/review?status=pending')
      setCommitted(true)
      setSuccessMsg(
        `공급가 ${j.count}건이 검토 대기에 추가되었습니다.` +
        (skipped > 0 ? ` 가격미상 ${skipped}건은 제외 — 직접 확인이 필요합니다.` : '')
      )
    } catch { setErrorMsg('저장 실패') } finally { setCommitting(false) }
  }, [supplierPreview, channel, isTest])

  // 경쟁가 미리보기를 시장비교에 실제 반영(저장)
  const applyCompetitor = useCallback(async () => {
    if (previewItems.length === 0) return
    // 가격미상 경쟁가 행은 자동 시장반영 금지 — 제외하고 전송.
    const importable = previewItems.filter((it) => !isPriceUnknown(it))
    const skipped = previewItems.length - importable.length
    if (importable.length === 0) {
      setErrorMsg('가격미상 항목만 있어 시장에 반영할 수 없습니다 — 가격을 직접 확인해 주세요.')
      return
    }
    setApplying(true); setErrorMsg('')
    try {
      const res = await fetch('/api/pricing/gpu/market/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: importable, source_url: previewSourceUrl, is_test: isTest }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setErrorMsg(j.error ?? '반영 실패'); return }
      // member 제출은 검토대기 staging(staged:true), admin은 라이브 반영. 메시지·갱신 분기.
      if (j.staged) { await mutate('/api/pricing/gpu/review?status=pending') } else { await mutate('/api/pricing/gpu/market') }
      setApplied(true)
      setSuccessMsg(
        (j.staged
          ? `경쟁사 가격 ${j.count}건을 검토 대기에 제출했습니다 — 관리자 확정 후 시장 비교에 반영됩니다.`
          : `경쟁사 가격 ${j.count}건이 시장 비교에 반영되었습니다.`) +
        (skipped > 0 ? ` 가격미상 ${skipped}건은 제외 — 직접 확인이 필요합니다.` : '')
      )
    } catch {
      setErrorMsg('반영 실패')
    } finally { setApplying(false) }
  }, [previewItems, previewSourceUrl, isTest, mutate])

  // 인라인 정정 — 공급가 → 경쟁사 이동. 이동 항목은 경쟁사 import 경로(market/import)를 타도록
  // competitorResults(표시)와 previewItems(전송 원본) 양쪽에 동기 추가하고 supplierPreview에서 제거.
  const moveToCompetitor = useCallback((idx: number) => {
    setSupplierPreview((sp) => {
      const it = sp[idx]
      if (!it) return sp
      const { display, raw } = supplierRowToCompetitor(it)
      setCompetitorResults((cr) => [...cr, display])
      setPreviewItems((pi) => [...pi, raw])
      setApplied(false)
      return sp.filter((_, i) => i !== idx)
    })
  }, [])

  // 인라인 정정 — 경쟁사 → 공급가 이동. 이동 항목은 공급가 commit 경로(review/commit)를 타도록
  // supplierPreview(전송 형태 {extracted})에 추가하고 competitorResults·previewItems에서 제거.
  const moveToSupplier = useCallback((idx: number) => {
    setCompetitorResults((cr) => {
      const c = cr[idx]
      if (!c) return cr
      setSupplierPreview((sp) => [...sp, competitorRowToSupplier(c)])
      setPreviewItems((pi) => pi.filter((_, i) => i !== idx))
      setCommitted(false)
      return cr.filter((_, i) => i !== idx)
    })
  }, [])

  const hasResults = analysisResults.length > 0
  const hasCompetitorResults = competitorResults.length > 0

  // §05 통합 표 행: 공급원가(미리보기) + 시장가(경쟁사) 합산. 신뢰도 게이트는 공급원가만 대상.
  const gateRows: GateRow[] = [
    ...supplierPreview.map((it): GateRow => {
      const ex = ((it as { extracted?: Record<string, unknown> })?.extracted ?? {}) as Record<string, unknown>
      // 신뢰도는 서버 산출 overall_confidence를 우선 사용(ResultPanel과 동일 값) — 없을 때만 필드 평균 폴백.
      const serverOverall = (it as { overall_confidence?: number | null })?.overall_confidence
      const conf = (it as { confidence?: Record<string, number | null> })?.confidence ?? {}
      const confVals = Object.values(conf).filter((v): v is number => typeof v === 'number')
      const overall = typeof serverOverall === 'number'
        ? serverOverall
        : (confVals.length > 0 ? Math.round(confVals.reduce((a, b) => a + b, 0) / confVals.length) : null)
      const priceRaw = ex.unit_price_usd ?? ex.price_usd
      return {
        kind: 'supply',
        model: `${ex.model_name ?? ''} ${ex.memory ?? ''}`.trim(),
        party: typeof ex.supplier === 'string' ? ex.supplier : '',
        priceUsd: typeof priceRaw === 'number' ? priceRaw : (priceRaw != null ? Number(priceRaw) : null),
        confidence: overall,
      }
    }),
    ...competitorResults.map((c): GateRow => ({
      kind: 'market',
      model: `${c.model}${c.memory ? ' ' + c.memory : ''}`.trim(),
      party: c.competitor,
      priceUsd: typeof c.price_usd === 'number' ? c.price_usd : Number(c.price_usd),
      confidence: null,
    })),
  ]
  const confirmCount = supplierPreview.length + competitorResults.length
  // 가격미상 공급가 — 자동 확정 대상에서 제외(사람 확인 필요)
  const supplierUnknownCount = supplierPreview.filter((it) => isPriceUnknown(it)).length
  const supplierCommittable = supplierPreview.length - supplierUnknownCount

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
            붙여넣으면 공급가·경쟁가를 자동 분류합니다. 공급가는 검토 대기, 경쟁가는 시장 비교에 반영됩니다.
          </div>

          {/* 지원 형식 — 정보성 표시(클릭 대상 아님). 끌어다 놓으면 종류별 자동 분류. */}
          <div className="gpu-intake-formats" data-testid="intake-formats">
            <div className="gpu-intake-formats-list">
              <span className="gpu-intake-formats-label">자동 인식</span>
              <span className="gpu-format-badge gpu-format-badge-static">텍스트·메일</span>
              <span className="gpu-format-badge gpu-format-badge-static">이미지</span>
              <span className="gpu-format-badge gpu-format-badge-static">PDF</span>
              <span className="gpu-format-badge gpu-format-badge-static">엑셀</span>
              <span className="gpu-format-badge gpu-format-badge-static">URL</span>
              <span className="gpu-format-badge gpu-format-badge-static">CSV·표</span>
            </div>
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
            <DraftRestoreBanner show={rawTextDraft.hasDraft} onRestore={rawTextDraft.restore} onDiscard={rawTextDraft.discard} />
            <textarea
              ref={textareaRef}
              className="gpu-intake-textarea"
              style={{ minHeight: 180, border: 'none', borderRadius: 10, background: 'transparent', resize: 'vertical' }}
              placeholder={"견적·가격 정보를 여기 붙여넣거나, 파일(이미지·PDF·엑셀·CSV)을 끌어다 놓으세요.\n종류는 자동으로 인식·분류됩니다.\n\n예) [GMI Cloud] H100 SXM 80GB $2.10/GPU·hr, 약정 3개월, 32장 즉시"}
              value={rawText}
              onChange={(e) => { setRawText(e.target.value); setSuccessMsg(''); setErrorMsg('') }}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                // ⌘+Enter(맥) / Ctrl+Enter(윈도우)로 즉시 분석. metaKey=⌘, ctrlKey=Ctrl 둘 다 허용.
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  if (!analyzing && (rawText.trim() || attached || streamFiles.length > 0)) void handleAnalyze()
                }
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderTop: 'var(--hairline) solid var(--surface-bg)' }}>
              <label
                htmlFor="gpu-file-input-v2"
                className="gpu-btn"
                style={{ padding: '4px 8px', fontSize: 12, gap: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <Paperclip size={13} /> 파일 첨부
              </label>
              <span style={{ fontSize: 11, color: 'var(--border-subtle)' }}>이미지·PDF·엑셀·CSV · {isMac ? '⌘' : 'Ctrl'}+Enter 분석</span>
            </div>
          </div>

          {/* 텍스트 파일 첨부(단일) */}
          {attached && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, padding: '6px 10px', borderRadius: 8, background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--brand-soft-2)' }}>
              <Paperclip size={16} style={{ color: 'var(--brand)', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attached.name}</span>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-faint)' }} onClick={() => setAttached(null)}>
                <X size={14} />
              </button>
            </div>
          )}

          {/* 이미지/PDF 첨부(다중) — 썸네일 그리드. multipart로 전송. */}
          {streamFiles.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }} data-testid="image-thumbs">
              {streamFiles.map((im, i) => (
                <div key={i} title={im.name} style={{ position: 'relative', width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: 'var(--hairline) solid var(--brand-soft-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-bg)' }}>
                  {im.previewUrl
                    ? <img src={im.previewUrl} alt={im.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)' }}>PDF</span>}
                  <button onClick={() => setStreamFiles((p) => { const t = p[i]; if (t?.previewUrl) URL.revokeObjectURL(t.previewUrl); return p.filter((_, idx) => idx !== i) })} title="제거"
                    style={{ position: 'absolute', top: 2, right: 2, width: 18, height: 18, borderRadius: '50%', background: 'rgba(15,23,42,.7)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
                    <X size={11} />
                  </button>
                </div>
              ))}
              <span style={{ alignSelf: 'center', fontSize: 11.5, color: 'var(--text-muted)' }}>{streamFiles.length}개</span>
            </div>
          )}

          {/* 엑셀/CSV 파일 → 자동 catalog 흡수(controlled). 단일 드롭존이 넘긴 파일을 그 자리에서 처리(결과는 초기화 전까지 유지). */}
          {catalogFile !== null && (
            <CatalogUploadSection isTest={isTest} file={catalogFile} />
          )}

          <input
            id="gpu-file-input-v2"
            type="file"
            multiple
            accept={ACCEPT_ALL}
            style={{ display: 'none' }}
            onChange={(e) => { if (e.target.files?.length) processFiles(e.target.files); e.target.value = '' }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--gpu-muted)' }} title="무엇을 넣는지 먼저 고르면 시스템이 추측하지 않고 정확히 분류합니다">넣는 종류</span>
              <select
                className="input-field"
                value={declaredKind}
                onChange={(e) => setDeclaredKind(e.target.value as 'auto' | 'supplier' | 'competitor')}
                style={{ height: 30, padding: '2px 8px', fontSize: 12, width: 'auto' }}
                aria-label="넣는 데이터 종류 선택"
              >
                <option value="auto">자동 판별</option>
                <option value="supplier">공급사 견적(우리 매입가)</option>
                <option value="competitor">경쟁사 시장가(남의 판매가)</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ color: 'var(--gpu-muted)' }}>채널</span>
              <select
                className="input-field"
                value={channel}
                onChange={(e) => setChannel(e.target.value)}
                style={{ height: 30, padding: '2px 8px', fontSize: 12, width: 'auto' }}
                aria-label="입력 채널 선택"
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
              disabled={analyzing || (!rawText.trim() && !attached && streamFiles.length === 0)}
            >
              <Sparkles size={14} />
              {analyzing ? 'AI 분석 중…' : 'AI 분석 시작'}
            </button>
            {(rawText || attached || streamFiles.length > 0 || catalogFile || hasResults) && (
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
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: isLast ? 'var(--text)' : 'var(--text-faint)' }}>
                      <span style={{ color: isLast ? 'var(--gpu-accent)' : 'var(--border-subtle)' }}>{isLast ? '▸' : '✓'}</span>
                      <span>{m}</span>
                    </div>
                  )
                })}
              </div>
              {/* AI가 찾고 있는 항목 — 자연어 파싱(raw JSON 비노출) */}
              {streamFindings.length > 0 && (
                <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>찾은 항목</div>
                  {streamFindings.map((f, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 6, background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)', fontSize: 12 }}>
                      <span style={{ color: 'var(--gpu-accent)' }}>✦</span>
                      <span style={{ fontWeight: 600, color: 'var(--text)', flex: 1 }}>{f.model}</span>
                      {f.price && <span style={{ fontWeight: 700, color: 'var(--brand-dark)' }}>${f.price}/hr</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (supplierPreview.length > 0 || hasCompetitorResults) && !hasResults ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8, overflowY: 'auto' }}>
              {/* 누락 대조 경고 — done.reconciliation.missing>0 일 때만 노출 */}
              {reconciliation && reconciliation.missing > 0 && (
                <div className="gpu-banner gpu-banner-warning" style={{ marginBottom: 0 }} data-testid="reconciliation-banner" role="alert">
                  <span className="gpu-banner-dot" aria-hidden>⚠</span>
                  <span>
                    원본 {reconciliation.source_rows}행 중 {reconciliation.extracted}행만 추출 — {reconciliation.missing}행 누락 의심
                    {reconciliation.missing_labels.length > 0 && <>: {reconciliation.missing_labels.join(' · ')}</>}.
                    {' '}원본을 나눠 다시 시도하거나 직접 추가하세요.
                  </span>
                </div>
              )}
              {/* 잘림 고지 배너 — 백엔드가 상한 도달을 알릴 때만 노출(없으면 미표시) */}
              {truncated && (
                <div className="gpu-banner gpu-banner-warning" style={{ marginBottom: 0 }} data-testid="truncation-banner" role="alert">
                  <span className="gpu-banner-dot" aria-hidden>⚠</span>
                  <span>일부 항목이 상한으로 잘렸습니다 — 입력을 나눠서 다시 시도하세요.</span>
                </div>
              )}
              {/* §05 신뢰도 자동 게이트 3구간 요약 + 통합 표 */}
              <div>
                <h3 className="gpu-card-title" style={{ marginBottom: 8 }}>
                  추출 결과 — 신뢰도 자동 게이트
                  <span className="gpu-badge gpu-badge-t2" style={{ marginLeft: 8 }}>검토 피로 제거</span>
                </h3>
                <IntakeGateSummary rows={gateRows} />
              </div>
              {/* 경쟁사 가격 (혼합 시 위) */}
              {hasCompetitorResults && (
                <div data-testid="competitor-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span className="gpu-badge" style={{ background: 'var(--gpu-accent)', color: '#fff', fontSize: 10 }}>🟢 경쟁사 가격</span>
                    <span className="gpu-badge" style={{ background: applied ? 'var(--gpu-green)' : 'var(--gpu-amber)', color: '#fff', fontSize: 10 }}>
                      {applied ? '반영 완료' : '반영 대기'}
                    </span>
                  </div>
                  {competitorResults.map((item, i) => {
                    const unknown = isPriceUnknown({ price_usd: item.price_usd })
                    return (
                    <div key={i} data-testid={`competitor-row-${i}`} data-price-unknown={unknown ? 'true' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', minHeight: 44, borderRadius: 8, background: unknown ? 'var(--warning-bg)' : 'var(--success-bg)', border: `var(--hairline) solid ${unknown ? 'var(--warning-border)' : 'var(--success-border)'}` }}>
                      <span style={{ fontSize: 12, color: 'var(--text)', fontWeight: 600, minWidth: 80 }}>{item.competitor}</span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', flex: 1 }}>{item.model} {item.memory}</span>
                      {unknown
                        ? <span className="gpu-badge gpu-badge-warn" title="가격 정보 없음 — 시장반영 제외, 사용자 확인 필요">가격미상</span>
                        : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gpu-accent)' }} title={item.original_currency && item.original_currency !== 'USD' ? `USD 환산 ${fmtUSD(item.price_usd)}/hr` : undefined}>{fmtOriginalPrice(item)}</span>}
                      {!applied && (
                        <button
                          onClick={() => moveToSupplier(i)}
                          className="gpu-btn gpu-row-move-btn"
                          data-testid={`move-to-supplier-${i}`}
                          title="이 항목을 공급가(검토 대기)로 옮깁니다"
                        >→ 공급가</button>
                      )}
                    </div>
                    )
                  })}
                  {!applied ? (
                    <button onClick={applyCompetitor} disabled={applying} className="gpu-btn gpu-btn-primary" style={{ marginTop: 4, justifyContent: 'center', gap: 6 }}>
                      {applying ? '반영 중…' : `시장비교에 반영 (${competitorResults.length}건)`}
                    </button>
                  ) : (
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', fontSize: 12, color: 'var(--success)' }}>
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
                  {supplierPreview.map((it, i) => (
                    <SupplierPreviewRow
                      key={i}
                      it={it}
                      idx={i}
                      open={expandedIdx === i}
                      committed={committed}
                      onToggle={(idx) => setExpandedIdx(expandedIdx === idx ? null : idx)}
                      onMoveToCompetitor={moveToCompetitor}
                    />
                  ))}
                  {!committed ? (
                    <>
                      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2 }}>
                        공급가 {supplierPreview.length}건 검토 대기 · 시장가 {competitorResults.length}건 반영
                      </div>
                      {supplierUnknownCount > 0 && (
                        <div style={{ display: 'flex', gap: 6, fontSize: 11.5, color: 'var(--gpu-amber)', fontWeight: 600 }} data-testid="supplier-unknown-note" role="alert">
                          <span aria-hidden>⚠</span>
                          <span>가격미상 {supplierUnknownCount}건은 자동 반영에서 제외됩니다 — 직접 확인이 필요합니다.</span>
                        </div>
                      )}
                      <button onClick={commitSupplier} disabled={committing || supplierCommittable === 0} className="gpu-btn gpu-btn-primary" data-testid="supplier-commit-btn" style={{ marginTop: 4, justifyContent: 'center', gap: 6 }}>
                        {committing ? '저장 중…' : `확정 (${supplierCommittable})`}
                      </button>
                    </>
                  ) : (
                    <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', fontSize: 12, color: 'var(--success)' }}>
                      ✓ 검토 대기 탭에 추가되었습니다. 본부장 검토 후 가격표에 반영됩니다.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : !hasResults ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '32px 0', color: 'var(--text-faint)' }}>
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
                  style={{ display: 'flex', gap: 4, flexWrap: 'wrap', borderBottom: 'var(--border-w-2) solid var(--color-border)', paddingBottom: 8, marginBottom: 4 }}
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
                          borderBottom: isActive ? 'var(--border-w-2) solid #fff' : '1.5px solid var(--color-border)',
                          background: isActive ? '#fff' : 'var(--color-bg)',
                          color: isActive ? 'var(--gpu-accent)' : 'var(--text-muted)',
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

              <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', fontSize: 12, color: 'var(--success)' }}>
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
