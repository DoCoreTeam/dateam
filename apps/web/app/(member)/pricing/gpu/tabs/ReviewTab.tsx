'use client'

import { useState, useCallback, useMemo } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { AlertTriangle, CheckCircle2, RotateCcw, ChevronDown, ChevronUp, Search, Plus, Building2, X } from 'lucide-react'
import { PriceBreakdownPanel, BillingPanel, RecheckResultPanel, EvidenceLink, type RecheckResult } from '@/components/pricing/gpu/review/ReviewPanels'

interface Supplier {
  id: string
  name: string
  color: string
  location: string | null
}

// 공급사명 유사도 점수 (0~1)
function supplierScore(extracted: string, name: string): number {
  const a = extracted.toLowerCase().replace(/[\s\-_.]/g, '')
  const b = name.toLowerCase().replace(/[\s\-_.]/g, '')
  if (a === b) return 1
  if (b.includes(a) || a.includes(b)) return 0.85
  // 약어 매칭: CoreWeave → CW, Lambda Labs → LL
  const abbr = name.split(/[\s\-_]/).map((w) => w[0] ?? '').join('').toLowerCase()
  if (abbr === a) return 0.9
  return 0
}

interface SupplierPickerProps {
  extractedName: string
  confidence: number | null
  onSelect: (supplier: Supplier | null) => void
  onManualName: (name: string) => void
  selectedId: string | null
  manualName: string
  allSuppliers: Supplier[]
}

function SupplierPicker({ extractedName, confidence, onSelect, onManualName, selectedId, manualName, allSuppliers }: SupplierPickerProps) {
  const [open, setOpen] = useState((confidence ?? 100) < 90)
  const [query, setQuery] = useState('')
  const [manualMode, setManualMode] = useState(false)
  const [manualInput, setManualInput] = useState(manualName)
  const [dupWarning, setDupWarning] = useState('')

  const suggestions = useMemo(() =>
    allSuppliers
      .map((s) => ({ ...s, score: supplierScore(extractedName, s.name) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3),
    [allSuppliers, extractedName]
  )

  const filtered = useMemo(() => {
    if (!query.trim()) return allSuppliers
    const q = query.toLowerCase()
    return allSuppliers.filter((s) =>
      s.name.toLowerCase().includes(q) || (s.location ?? '').toLowerCase().includes(q)
    )
  }, [allSuppliers, query])

  const selected = allSuppliers.find((s) => s.id === selectedId)

  function handleManualConfirm() {
    const trimmed = manualInput.trim()
    if (!trimmed) return
    const dup = allSuppliers.find((s) => supplierScore(trimmed, s.name) > 0.8)
    if (dup) {
      setDupWarning(`"${dup.name}"과(와) 유사한 공급사가 이미 등록되어 있습니다. 선택하시겠어요?`)
      return
    }
    setDupWarning('')
    onManualName(trimmed)
    onSelect(null)
    setOpen(false)
  }

  const confidenceLow = (confidence ?? 100) < 90

  return (
    <div style={{ marginTop: 4 }}>
      {/* 현재 선택 표시 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {selected ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: selected.color + '22', border: `var(--hairline) solid ${selected.color}55`, fontSize: 12, fontWeight: 600, color: selected.color }}>
            <Building2 size={11} /> {selected.name}
            <button onClick={() => { onSelect(null); onManualName('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: selected.color, display: 'flex', padding: 0 }}><X size={11} /></button>
          </span>
        ) : manualName ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, background: 'var(--success-bg)', border: 'var(--hairline) solid var(--success-border)', fontSize: 12, fontWeight: 600, color: 'var(--success)' }}>
            <Plus size={11} /> {manualName} (신규)
            <button onClick={() => { onManualName(''); setManualInput('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', display: 'flex', padding: 0 }}><X size={11} /></button>
          </span>
        ) : (
          <span style={{ fontSize: 12, color: confidenceLow ? 'var(--warning)' : 'var(--gpu-faint)' }}>
            {confidenceLow ? '⚠️ 공급사 확인 필요' : '공급사 미선택 (AI 추출값 사용)'}
          </span>
        )}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ fontSize: 11, color: 'var(--gpu-accent)', background: 'none', border: 'var(--hairline) solid var(--gpu-accent)', borderRadius: 12, padding: '2px 8px', cursor: 'pointer' }}
        >
          {open ? '닫기' : (selected || manualName) ? '변경' : '선택'}
        </button>
      </div>

      {open && (
        <div style={{ marginTop: 8, borderRadius: 10, border: 'var(--hairline) solid var(--brand-soft-2)', background: 'var(--surface-bg)', padding: '10px 12px' }}>
          {/* 추천 공급사 */}
          {suggestions.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--brand-dark)', marginBottom: 5 }}>✦ 유사 공급사 추천</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {suggestions.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => { onSelect(s); onManualName(''); setOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px',
                      borderRadius: 8, border: `1.5px solid ${selectedId === s.id ? s.color : 'var(--brand-soft-2)'}`,
                      background: selectedId === s.id ? s.color + '18' : '#fff',
                      cursor: 'pointer', textAlign: 'left',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{s.name}</span>
                    {s.location && <span style={{ fontSize: 11, color: 'var(--gpu-muted)' }}>{s.location}</span>}
                    <span style={{ fontSize: 10, color: 'var(--brand)', fontWeight: 700 }}>{Math.round(s.score * 100)}% 일치</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 전체 검색 */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5 }}>등록된 공급사 검색</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '6px 10px', borderRadius: 8, border: 'var(--border-w-2) solid var(--border-color)', background: '#fff' }}>
              <Search size={13} style={{ color: 'var(--gpu-muted)', flexShrink: 0 }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="공급사명 검색…"
                style={{ flex: 1, border: 'none', outline: 'none', fontSize: 12, background: 'transparent' }}
              />
            </div>
            <div style={{ maxHeight: 150, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
              {filtered.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--gpu-faint)', padding: '6px 4px' }}>검색 결과 없음</div>
              ) : filtered.map((s) => (
                <button
                  key={s.id}
                  onClick={() => { onSelect(s); onManualName(''); setOpen(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                    borderRadius: 7, border: `var(--hairline) solid ${selectedId === s.id ? s.color : 'transparent'}`,
                    background: selectedId === s.id ? s.color + '18' : 'transparent',
                    cursor: 'pointer', textAlign: 'left',
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: 12, color: 'var(--text)' }}>{s.name}</span>
                  {s.location && <span style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>{s.location}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* 직접 입력 */}
          <div style={{ borderTop: 'var(--hairline) solid var(--brand-soft-2)', paddingTop: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Plus size={11} /> 직접 입력 (신규 공급사)
            </div>
            {!manualMode ? (
              <button
                onClick={() => { setManualMode(true); setManualInput(extractedName) }}
                style={{ fontSize: 11, color: 'var(--gpu-muted)', background: 'none', border: 'var(--hairline) dashed var(--border-subtle)', borderRadius: 7, padding: '5px 12px', cursor: 'pointer' }}
              >
                &quot;{extractedName}&quot; 이름으로 직접 등록
              </button>
            ) : (
              <div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={manualInput}
                    onChange={(e) => { setManualInput(e.target.value); setDupWarning('') }}
                    placeholder="공급사명"
                    style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: 'var(--hairline) solid var(--brand-soft-2)', fontSize: 12 }}
                  />
                  <button
                    onClick={handleManualConfirm}
                    className="gpu-btn gpu-btn-primary"
                    style={{ fontSize: 11, padding: '0 12px' }}
                    disabled={!manualInput.trim()}
                  >
                    확인
                  </button>
                  <button onClick={() => { setManualMode(false); setDupWarning('') }} className="gpu-btn" style={{ fontSize: 11, padding: '0 10px' }}>취소</button>
                </div>
                {dupWarning && (
                  <div style={{ marginTop: 6, fontSize: 11, color: 'var(--warning)', background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)', borderRadius: 6, padding: '5px 9px' }}>
                    {dupWarning}
                    {allSuppliers.filter((s) => supplierScore(manualInput, s.name) > 0.8).map((s) => (
                      <button
                        key={s.id}
                        onClick={() => { onSelect(s); onManualName(''); setOpen(false); setManualMode(false); setDupWarning('') }}
                        style={{ marginLeft: 8, fontSize: 11, color: s.color, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
                      >
                        {s.name} 선택
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

interface ReviewItem {
  id: string
  target?: string | null
  product_hint: string | null
  supplier_hint: string | null
  channel: string | null
  impact_level: string | null
  status: string
  current_iteration: number
  current_extracted: Record<string, unknown> | null
  current_confidence: Record<string, number | null> | null
  overall_confidence: number | null
  created_at: string
  is_test: boolean
  evidence_drive_file_id?: string | null
}

const IMPACT_CONFIG: Record<string, { label: string; color: string }> = {
  new_model: { label: '신규 모델', color: 'var(--gpu-accent)' },
  big_swing: { label: '급격한 변동', color: 'var(--gpu-red)' },
  price_low_change: { label: '소폭 변동', color: 'var(--gpu-amber)' },
  steady: { label: '안정적', color: 'var(--gpu-green)' },
}

const CONF_FIELDS = ['model_name', 'unit_price_usd', 'supplier', 'term', 'valid_until', 'min_qty']
const CONF_LABELS: Record<string, string> = {
  model_name: '모델명',
  unit_price_usd: '단가 (USD)',
  supplier: '공급사',
  term: '약정',
  valid_until: '유효기간',
  min_qty: '최소 수량',
}

function ConfidenceBar({ value, label }: { value: number | null; label: string }) {
  const pct = value ?? 0
  const color = pct >= 90 ? 'var(--gpu-green)' : pct >= 70 ? 'var(--gpu-amber)' : 'var(--gpu-red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span style={{ minWidth: 64, color: 'var(--gpu-muted)' }}>{label}</span>
      <div className="gpu-conf-bar" style={{ flex: 1, maxWidth: 120 }}>
        <i style={{ width: `${pct}%`, background: color }} />
      </div>
      <span style={{ minWidth: 32, fontWeight: 700, color }}>{value != null ? `${value}%` : '—'}</span>
    </div>
  )
}

function ReviewCard({ item, onDone, allSuppliers, selected, onToggleSelect, krwPerUsd }: { item: ReviewItem; onDone: () => void; allSuppliers: Supplier[]; selected: boolean; onToggleSelect: () => void; krwPerUsd: number | null }) {
  const [expanded, setExpanded] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const [recheckResult, setRecheckResult] = useState<RecheckResult | null>(null)
  const [checking, setChecking] = useState<Set<string>>(new Set())
  const [confirming, setConfirming] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [recheckErr, setRecheckErr] = useState('')
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null)
  const [manualSupplierName, setManualSupplierName] = useState('')

  const extracted = item.current_extracted ?? {}
  const confidence = item.current_confidence ?? {}
  const isCompetitor = item.target === 'competitor'   // 경쟁사 카탈로그 항목 — 공급사 UI 비적용

  // 신뢰도 90% 미만 항목 — 필수 체크 (경쟁사 항목은 공급사 필드 신뢰도가 없어 자동 확정 가능)
  const lowConfFields = isCompetitor ? [] : CONF_FIELDS.filter((f) => {
    const v = confidence[f]
    return v != null && v < 90
  })
  const allLowChecked = lowConfFields.every((f) => checking.has(f))
  const canConfirm = allLowChecked || lowConfFields.length === 0

  const toggleCheck = (field: string) => {
    setChecking((prev) => {
      const next = new Set(prev)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  const handleConfirm = useCallback(async () => {
    setConfirming(true)
    try {
      const body: Record<string, unknown> = {
        action: 'confirm',
        confirmed_items: Array.from(checking),
      }
      if (selectedSupplier) {
        body.supplier_id = selectedSupplier.id
      } else if (manualSupplierName) {
        body.override_extracted = { supplier: manualSupplierName }
      }
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(j.error ?? '확정 실패')
        return
      }
      // M5: 재고 연계 결과 — 부분커밋(가격 확정·재고 실패) 시 사용자에게 알림
      if (j.stock && j.stock.ok === false) {
        alert(`확정됨. 다만 ${j.stock.msg}`)
      }
      onDone()
    } catch {
      alert('확정 실패 — 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.')
    } finally {
      setConfirming(false)
    }
  }, [item.id, checking, onDone, selectedSupplier, manualSupplierName])

  const handleReject = useCallback(async () => {
    setRejecting(true)
    try {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', rejected_reason: rejectReason || null }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        alert(j.error ?? '반려 실패')
        return
      }
      onDone()
    } catch {
      alert('반려 실패 — 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.')
    } finally {
      setRejecting(false)
    }
  }, [item.id, rejectReason, onDone])

  const handleRecheck = useCallback(async () => {
    if (!feedback.trim()) { setRecheckErr('피드백을 입력해 주세요.'); return }
    setRechecking(true); setRecheckErr('')
    try {
      const res = await fetch(`/api/pricing/gpu/review/${item.id}/recheck`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedback,
          original_text: extracted.original_text ?? '',
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setRecheckErr(j.error ?? 'AI 재분석 실패')
        return
      }
      // 재분석 결과 보존 — "무엇이/왜 바뀌었는지" 리포트로 표시(이전엔 응답을 버려 결과가 안 보였음)
      setRecheckResult({
        summary: typeof j.change_summary === 'string' ? j.change_summary : '',
        diff: Array.isArray(j.diff) ? (j.diff as RecheckResult['diff']) : [],
        iteration: typeof j.iteration === 'number' ? j.iteration : item.current_iteration + 1,
      })
      setFeedback('')
      onDone()
    } catch {
      setRecheckErr('네트워크 오류 — 서버에 연결할 수 없습니다. 잠시 후 다시 시도하세요.')
    } finally {
      setRechecking(false)
    }
  }, [item.id, feedback, extracted.original_text, onDone, item.current_iteration])

  const impact = IMPACT_CONFIG[item.impact_level ?? 'steady'] ?? IMPACT_CONFIG.steady
  const overallPct = item.overall_confidence ?? 0

  return (
    <div className="gpu-rev-card" style={{ border: selected ? 'var(--border-w-2) solid var(--gpu-accent)' : item.is_test ? 'var(--hairline) dashed var(--brand-soft-2)' : undefined }}>
      {/* 헤더 */}
      <div className="gpu-rev-top" style={{ alignItems: 'flex-start' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label="선택"
          style={{ width: 17, height: 17, marginTop: 13, marginRight: 2, accentColor: 'var(--gpu-accent)', flexShrink: 0, cursor: 'pointer' }}
        />
        <div className="gpu-chip" style={{ width: 42, height: 42, flexShrink: 0 }}>
          {(item.product_hint ?? 'G').charAt(0)}
          <span style={{ fontSize: 9 }}>GPU</span>
        </div>
        <div className="gpu-rev-info" style={{ flex: 1 }}>
          <div className="gpu-rev-nm" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {item.product_hint ?? '모델 미인식'}
            {item.is_test && <span className="gpu-badge gpu-badge-gray">TEST</span>}
            <span
              className="gpu-badge"
              style={{ background: impact.color, color: '#fff', fontSize: 10 }}
            >
              {impact.label}
            </span>
            {item.current_iteration > 1 && (
              <span className="gpu-badge gpu-badge-t2" style={{ fontSize: 10 }}>
                {item.current_iteration}차 재분석
              </span>
            )}
          </div>
          <div className="gpu-rev-src" style={{ flexWrap: 'wrap', gap: 6 }}>
            {item.supplier_hint && <span>{item.supplier_hint}</span>}
            {item.channel && <span className="gpu-badge gpu-badge-gray">{item.channel}</span>}
            <span style={{ color: 'var(--gpu-faint)', fontSize: 11 }}>{new Date(item.created_at).toLocaleString('ko-KR')}</span>
          </div>
        </div>
        {/* 전체 신뢰도 */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: overallPct >= 80 ? 'var(--gpu-green)' : overallPct >= 60 ? 'var(--gpu-amber)' : 'var(--gpu-red)', fontFamily: 'var(--font-mono, monospace)' }}>
            {overallPct}%
          </div>
          <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>전체 신뢰도</div>
        </div>
      </div>

      {/* 경쟁사 카탈로그 항목 — 업체/모델/가격 컴팩트 표시 */}
      {isCompetitor && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="competitor-review-fields">
          <span className="gpu-badge gpu-badge-t2" style={{ alignSelf: 'flex-start', fontSize: 10 }}>경쟁사 카탈로그</span>
          {([['업체', 'competitor_name'], ['모델', 'model_name'], ['메모리', 'memory'], ['가격(USD/hr)', 'price_usd'], ['요금제', 'pricing_model']] as Array<[string, string]>).map(([label, key]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--color-border)' }}>
              <span style={{ minWidth: 96, fontSize: 12, color: 'var(--gpu-muted)' }}>{label}</span>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {extracted[key] != null && String(extracted[key]).trim() !== '' ? String(extracted[key]) : <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>—</span>}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 추출 항목별 신뢰도 (공급사 항목) */}
      {!isCompetitor && (
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {CONF_FIELDS.map((f) => {
          const val = extracted[f]
          const conf = confidence[f]
          const isLow = conf != null && conf < 90
          const isChecked = checking.has(f)

          const isSupplier = f === 'supplier'

          return (
            <div
              key={f}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                background: isLow ? (isChecked ? 'var(--success-bg)' : 'var(--warning-bg)') : 'var(--surface-bg)',
                border: `var(--hairline) solid ${isLow ? (isChecked ? 'var(--success-border)' : 'var(--warning-border)') : 'var(--color-border)'}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {isLow ? (
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleCheck(f)}
                    style={{ width: 15, height: 15, accentColor: 'var(--gpu-green)', flexShrink: 0 }}
                  />
                ) : (
                  <CheckCircle2 size={15} style={{ color: 'var(--gpu-green)', flexShrink: 0 }} />
                )}
                <span style={{ minWidth: 72, fontSize: 12, color: 'var(--gpu-muted)' }}>{CONF_LABELS[f] ?? f}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {isSupplier
                    ? (() => {
                        const display = selectedSupplier?.name ?? (manualSupplierName || null) ?? (val != null ? String(val) : null)
                        return display ?? <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>미인식</span>
                      })()
                    : val != null ? String(val) : <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>미인식</span>
                  }
                </span>
                <ConfidenceBar value={conf ?? null} label="" />
              </div>
              {isSupplier && (
                <SupplierPicker
                  extractedName={val != null ? String(val) : (item.supplier_hint ?? '')}
                  confidence={conf ?? null}
                  onSelect={setSelectedSupplier}
                  onManualName={setManualSupplierName}
                  selectedId={selectedSupplier?.id ?? null}
                  manualName={manualSupplierName}
                  allSuppliers={allSuppliers}
                />
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* 단가 산출 근거 + 과금구조(설치비/월단가) — 컴포넌트 분리(globals.css .gpu-rev-* SSOT) */}
      {!isCompetitor && (
        <PriceBreakdownPanel
          extracted={extracted}
          krwPerUsd={krwPerUsd}
          open={showBreakdown}
          onToggle={() => setShowBreakdown((v) => !v)}
        />
      )}
      {!isCompetitor && <BillingPanel extracted={extracted} />}

      {/* 낮은 신뢰도 안내 */}
      {lowConfFields.length > 0 && !allLowChecked && (
        <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)', fontSize: 12, color: 'var(--warning)' }}>
          ⚠️ 신뢰도 90% 미만 항목이 있습니다. 각 항목을 직접 확인하고 체크해야 확정할 수 있습니다.
        </div>
      )}

      {/* 원본 데이터 토글 + Drive 원본 링크(역추적) */}
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          style={{ fontSize: 12, color: 'var(--gpu-muted)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, padding: 0 }}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          전체 추출 데이터 {expanded ? '숨기기' : '보기'}
        </button>
        {item.evidence_drive_file_id && <EvidenceLink fileId={item.evidence_drive_file_id} />}
      </div>
      {expanded && (
        <pre style={{ marginTop: 8, padding: '10px 12px', borderRadius: 8, background: 'var(--surface-muted)', fontSize: 11, overflowX: 'auto', maxHeight: 200, color: 'var(--text)', lineHeight: 1.6 }}>
          {JSON.stringify(extracted, null, 2)}
        </pre>
      )}

      {/* AI 재분석 섹션 (공급사 항목 전용 — 경쟁사 카탈로그는 미적용) */}
      {!isCompetitor && (
      <div style={{ marginTop: 14, padding: '12px', borderRadius: 8, background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--brand-soft-2)' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--brand-dark)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
          <RotateCcw size={12} /> AI 재분석 요청
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="예) 단가가 월 단위인 것 같습니다. 시간당으로 환산해 주세요."
          style={{ width: '100%', minHeight: 60, padding: '7px 10px', borderRadius: 7, border: 'var(--hairline) solid var(--brand-soft-2)', fontSize: 12, resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
        />
        {recheckErr && <div style={{ fontSize: 12, color: 'var(--gpu-red)', marginTop: 4 }}>{recheckErr}</div>}
        <button
          className="gpu-btn"
          style={{ marginTop: 6, fontSize: 12 }}
          onClick={handleRecheck}
          disabled={rechecking || !feedback.trim()}
        >
          {rechecking ? '재분석 중…' : 'AI 재분석'}
        </button>

        {/* 재분석 결과 리포트 — 변경 전/후 diff + AI 근거 (이전엔 결과가 안 보였음) */}
        {recheckResult && <RecheckResultPanel result={recheckResult} />}
      </div>
      )}

      {/* 액션 버튼 */}
      <div className="gpu-rev-actions" style={{ marginTop: 14 }}>
        <button
          className="gpu-btn gpu-btn-primary"
          onClick={handleConfirm}
          disabled={confirming || !canConfirm}
          title={!canConfirm ? '신뢰도 낮은 항목을 모두 확인 후 체크해 주세요' : ''}
          style={{ opacity: canConfirm ? 1 : 0.5 }}
        >
          {confirming ? '확정 중…' : '✓ 확정 · 가격표 반영'}
        </button>

        {!showReject ? (
          <button className="gpu-btn gpu-btn-danger" onClick={() => setShowReject(true)}>
            반려
          </button>
        ) : (
          <div style={{ display: 'flex', flex: 1, gap: 6 }}>
            <input
              type="text"
              placeholder="반려 사유 (선택)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 7, border: 'var(--border-w-2) solid var(--border-color)', fontSize: 12 }}
            />
            <button className="gpu-btn gpu-btn-danger" onClick={handleReject} disabled={rejecting}>
              {rejecting ? '처리 중…' : '반려 확정'}
            </button>
            <button className="gpu-btn" onClick={() => setShowReject(false)}>취소</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReviewTab() {
  // Context-aware mutate — 전역 mutate는 SWRProvider 영속캐시를 못 건드림(저장 후 미반영 회귀 방지)
  const { mutate } = useSWRConfig()
  const { data, mutate: revalidate } = useSWR<{ items: ReviewItem[] }>(
    '/api/pricing/gpu/review?status=pending',
    fetcher,
    // 전역 revalidateIfStale:false(영속캐시) 때문에 통합입력 등록 후 검토대기 진입 시
    // stale 목록이 떠 새로고침해야 보이던 회귀 → 이 핵심 목록만 마운트 시 항상 신선 재검증.
    { revalidateOnMount: true, revalidateIfStale: true }
  )
  const { data: suppliersData } = useSWR<{ suppliers: Supplier[] }>(
    '/api/pricing/gpu/suppliers',
    fetcher
  )
  // 매매기준율 — 단가 산출 근거 표시용(SSOT 환율). settings 엔드포인트 재사용.
  const { data: settingsData } = useSWR<{ usd_krw: number | null }>(
    '/api/pricing/gpu/settings',
    fetcher
  )
  const krwPerUsd = typeof settingsData?.usd_krw === 'number' ? settingsData.usd_krw : null
  const items = useMemo(() => data?.items ?? [], [data])
  const allSuppliers = (suppliersData?.suppliers ?? []).map((s) => ({
    id: s.id, name: s.name, color: s.color, location: s.location,
  }))

  // 공급사/경쟁사 필터 + 선택(일괄 삭제)
  const [targetFilter, setTargetFilter] = useState<'all' | 'supplier' | 'competitor'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [bulkConfirming, setBulkConfirming] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const filtered = useMemo(() => items.filter((it) => {
    if (targetFilter === 'all') return true
    const t = it.target === 'competitor' ? 'competitor' : 'supplier'  // 미지정(레거시)=supplier
    return t === targetFilter
  }), [items, targetFilter])

  const counts = useMemo(() => ({
    all: items.length,
    competitor: items.filter((it) => it.target === 'competitor').length,
    supplier: items.filter((it) => it.target !== 'competitor').length,
  }), [items])

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const allVisibleSelected = filtered.length > 0 && filtered.every((it) => selected.has(it.id))
  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const n = new Set(prev)
      if (filtered.every((it) => n.has(it.id))) filtered.forEach((it) => n.delete(it.id))
      else filtered.forEach((it) => n.add(it.id))
      return n
    })
  }, [filtered])

  const handleDone = useCallback(async () => {
    await revalidate()
    await mutate('/api/pricing/gpu/products')
    await mutate('/api/pricing/gpu/review?status=pending')
  }, [revalidate])

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`선택한 ${ids.length}건을 검토 대기에서 영구 삭제합니다. 되돌릴 수 없습니다. 계속할까요?`)) return
    setDeleting(true)
    try {
      const res = await fetch('/api/pricing/gpu/review/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert(j.error ?? '일괄 삭제 실패'); return }
      setSelected(new Set())
      await revalidate()
    } catch {
      alert('일괄 삭제 실패 — 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.')
    } finally {
      setDeleting(false)
    }
  }, [selected, revalidate])

  // 선택 항목 일괄 확정 — 수십 건을 한 번의 동의로 가격표 반영.
  // 신뢰도 90% 미만(직접 확인 권장) 항목도 포함하되, 다이얼로그에서 1회 명시 동의를 받는다(사람 검토 게이트의 일괄 대체).
  // 기존 단건 confirm 엔드포인트 재사용(서버·pricing 무변경). 공급사/모델 미특정 등 서버 거부 항목은 실패로 집계·안내.
  const lowConfFieldsOf = useCallback((it: ReviewItem): string[] => {
    if (it.target === 'competitor') return []
    const conf = it.current_confidence ?? {}
    return CONF_FIELDS.filter((f) => conf[f] != null && (conf[f] as number) < 90)
  }, [])

  // TODO(SSOT): 다건 시 서버 트랜잭션이 더 견고. /api/pricing/gpu/review/bulk 에 action:'confirm' 확장 후 1회 호출로 전환 검토.
  const handleBulkConfirm = useCallback(async () => {
    const targets = filtered.filter((it) => selected.has(it.id))
    if (targets.length === 0) return
    const lowConfItems = targets.filter((it) => lowConfFieldsOf(it).length > 0)
    const lowConfNames = lowConfItems.map((it) => it.product_hint ?? it.id)
    const msg = lowConfItems.length > 0
      ? `선택한 ${targets.length}건을 가격표에 일괄 확정합니다.\n\n` +
        `아래 ${lowConfItems.length}건은 신뢰도 90% 미만(직접 확인 권장)이지만 일괄 확정에 포함됩니다:\n` +
        `${lowConfNames.slice(0, 6).map((n) => `· ${n}`).join('\n')}${lowConfNames.length > 6 ? `\n…외 ${lowConfNames.length - 6}건` : ''}\n\n` +
        `계속할까요?`
      : `선택한 ${targets.length}건을 가격표에 일괄 확정합니다. 계속할까요?`
    if (!confirm(msg)) return

    setBulkConfirming(true)
    setBulkProgress({ done: 0, total: targets.length })
    const succeededIds: string[] = []
    const failed: string[] = []
    try {
      for (let i = 0; i < targets.length; i++) {
        const it = targets[i]
        try {
          const res = await fetch(`/api/pricing/gpu/review/${it.id}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // confirmed_items=[] (사람이 직접 확인한 필드 없음 — 거짓 기록 금지). 일괄 동의는 bulk 플래그로 정직하게 기록.
            body: JSON.stringify({ action: 'confirm', confirmed_items: [], bulk: true, auto_accepted_low_conf: lowConfFieldsOf(it) }),
          })
          if (res.ok) {
            succeededIds.push(it.id)
          } else {
            const j = await res.json().catch(() => ({}))
            failed.push(`· ${it.product_hint ?? it.id}: ${j.error ?? `확정 실패 (${res.status})`}`)
          }
        } catch {
          failed.push(`· ${it.product_hint ?? it.id}: 네트워크 오류`)
        }
        setBulkProgress({ done: i + 1, total: targets.length })
      }
      // 성공한 항목만 선택 해제 — 실패 항목은 선택에 남겨 사용자가 바로 개별 처리 가능
      setSelected((prev) => {
        const n = new Set(prev)
        succeededIds.forEach((id) => n.delete(id))
        return n
      })
      await revalidate()
      await mutate('/api/pricing/gpu/products')
      const summary = `일괄 확정 완료 — ${succeededIds.length}건 가격표 반영`
        + (failed.length ? `\n\n${failed.length}건은 확정하지 못했습니다(공급사·모델 미특정 등 — 선택에 남겨두었으니 개별 확인하세요):\n${failed.slice(0, 10).join('\n')}${failed.length > 10 ? `\n…외 ${failed.length - 10}건` : ''}` : '')
      alert(summary)
    } finally {
      setBulkConfirming(false)
      setBulkProgress(null)
    }
  }, [filtered, selected, revalidate, mutate, lowConfFieldsOf])

  const FILTERS: Array<['all' | 'supplier' | 'competitor', string, number]> = [
    ['all', '전체', counts.all], ['supplier', '공급사', counts.supplier], ['competitor', '경쟁사', counts.competitor],
  ]

  return (
    <div>
      <div className="gpu-banner gpu-banner-warning">
        <div className="gpu-banner-dot">
          <AlertTriangle size={16} color="var(--warning)" />
        </div>
        <div>
          <strong>사람 검토 게이트</strong> · AI가 추출한 견적은 본부장 확정 전까지 가격표에 반영되지 않습니다.
          신뢰도 90% 미만 항목은 직접 확인 체크 후에만 확정 버튼이 활성화됩니다.
        </div>
      </div>

      {/* 필터 + 일괄 작업 바 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {FILTERS.map(([key, label, n]) => (
            <button
              key={key}
              onClick={() => setTargetFilter(key)}
              className="gpu-btn"
              style={{
                fontSize: 12, padding: '5px 12px',
                background: targetFilter === key ? 'var(--gpu-accent)' : 'var(--surface-bg)',
                color: targetFilter === key ? '#fff' : 'var(--text-muted)',
                borderColor: targetFilter === key ? 'var(--gpu-accent)' : 'var(--color-border)',
              }}
            >
              {label} {n}
            </button>
          ))}
        </div>
        {filtered.length > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', marginLeft: 4 }}>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} style={{ width: 15, height: 15, accentColor: 'var(--gpu-accent)' }} />
            전체 선택
          </label>
        )}
        <div style={{ flex: 1 }} />
        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>선택 {selected.size}건</span>
            <button onClick={() => setSelected(new Set())} className="gpu-btn" style={{ fontSize: 12 }} disabled={bulkConfirming || deleting}>선택 해제</button>
            <button onClick={handleBulkConfirm} disabled={bulkConfirming || deleting} className="gpu-btn gpu-btn-primary" data-testid="bulk-confirm-btn" style={{ fontSize: 12, gap: 5 }}>
              <CheckCircle2 size={13} /> {bulkConfirming ? `확정 중… ${bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : ''}` : '일괄 확정'}
            </button>
            <button onClick={handleBulkDelete} disabled={deleting || bulkConfirming} className="gpu-btn gpu-btn-danger" data-testid="bulk-delete-btn" style={{ fontSize: 12, gap: 5 }}>
              <X size={13} /> {deleting ? '삭제 중…' : '일괄 삭제'}
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
          검토 대기 항목이 없습니다
        </div>
      ) : (
        filtered.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            onDone={handleDone}
            allSuppliers={allSuppliers}
            selected={selected.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            krwPerUsd={krwPerUsd}
          />
        ))
      )}
    </div>
  )
}
