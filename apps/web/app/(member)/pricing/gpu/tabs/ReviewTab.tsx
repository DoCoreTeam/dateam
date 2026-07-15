'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { AlertTriangle, CheckCircle2, RotateCcw, ChevronDown, ChevronUp, Search, Plus, Building2, X } from 'lucide-react'
import { PriceBreakdownPanel, BillingPanel, RecheckResultPanel, EvidenceLink, type RecheckResult } from '@/components/pricing/gpu/review/ReviewPanels'
import NbModal from '@/components/ui/nb/NbModal'
import { fmtUSD, fmtKRW } from '@/lib/gpu/format-price'

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

// USD 가격 필드 표시 SSOT — 검토 카드의 가격은 fmtUSD(ceil 3자리) 경유(raw 7.40740740… 노출 차단).
//  추출 직후 검토 화면이 실제 렌더경로 — 정적검증/다른 7개 사이트와 별개로 여기도 SSOT 강제.
//  krwPerUsd 주어지면 KRW 환산 병기(검토자가 익숙한 원화로 확인). ⚠️원본 통화(original_currency)는
//  추출 단계가 보존 안 해 여기선 USD→KRW 환산만 — 원본 보존은 USAI 추출 개선이 근본해결(별도).
const USD_PRICE_KEYS = new Set(['unit_price_usd', 'price_usd', 'per_gpu_usd'])
function fmtField(key: string, val: unknown, krwPerUsd?: number | null): string {
  if (val == null || String(val).trim() === '') return ''
  if (USD_PRICE_KEYS.has(key)) {
    const n = typeof val === 'number' ? val : parseFloat(String(val))
    if (Number.isFinite(n)) {
      const usd = fmtUSD(n)
      return krwPerUsd && krwPerUsd > 0 ? `${usd}  (${fmtKRW(n * krwPerUsd)})` : usd
    }
  }
  return String(val)
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

// 모델 미해소(카탈로그에 없음) 해소 모달 — ①기존 모델 매핑(1순위·중복 생성 0) ②새 모델 등록(스펙관리 prefill).
function ModelResolveModal({ modelName, message, busy, onPick, onClose }: {
  modelName: string; message: string; busy: boolean; onPick: (productId: string) => void; onClose: () => void
}) {
  const { data } = useSWR<{ products: Array<{ id: string; model_name: string; memory: string | null; gpu_count: number | null }> }>('/api/pricing/gpu/products', fetcher)
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const products = data?.products ?? []
    const k = q.trim().toLowerCase()
    const base = k ? products.filter((p) => `${p.model_name} ${p.memory ?? ''}`.toLowerCase().includes(k)) : products
    return base.slice(0, 60)
  }, [data, q])
  return (
    <NbModal
      title="모델 해소 — 기존 카탈로그에 매핑"
      onClose={onClose}
      maxWidth={520}
      footer={
        <button className="gpu-btn" onClick={() => { window.location.href = `/pricing/gpu?tab=specs&newModel=${encodeURIComponent(modelName)}` }}>
          <Plus size={14} /> 정말 새 모델이면 — 스펙 관리에서 등록
        </button>
      }
    >
      <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 6px' }}>{message}</p>
      <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '0 0 10px' }}>
        같은 GPU가 이미 카탈로그에 있으면 <b>아래에서 골라 매핑</b>하면 바로 확정됩니다(중복 모델 생성 안 함).
      </p>
      <div className="gpu-search" style={{ marginBottom: 8 }}>
        <Search size={15} />
        <input className="input-field" placeholder="모델 검색 (H100 SXM, A100 …)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      </div>
      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {filtered.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-faint)', padding: '14px 0', textAlign: 'center' }}>일치하는 모델이 없습니다 — 새 모델이면 아래 등록 버튼을 쓰세요</div>
        ) : filtered.map((p) => (
          <button key={p.id} type="button" className="gpu-btn" disabled={busy}
            onClick={() => onPick(p.id)}
            style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'left', width: '100%' }}>
            <span style={{ fontWeight: 600 }}>{p.model_name}{p.gpu_count && p.gpu_count > 1 ? ` ×${p.gpu_count}` : ''}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.memory ?? '—'}</span>
          </button>
        ))}
      </div>
    </NbModal>
  )
}

// 확정 보류(held) 인카드 조치 컨텍스트 SSOT — 단건 실패(카드 내부 setHeldInfo)·일괄 실패(부모→initialHeldInfo)
//  양쪽이 동일 구조를 공유해 같은 후보버튼/딥링크 렌더 경로(아래 heldInfo 렌더)를 재사용한다.
interface HeldInfo {
  code: string
  message: string
  candidates?: { id: string; memory: string | null; gpuCount: number }[]
  modelName: string
  gpuCount?: number
}

function ReviewCard({ item, onDone, allSuppliers, selected, onToggleSelect, krwPerUsd, isAdmin, initialHeldInfo }: { item: ReviewItem; onDone: () => void; allSuppliers: Supplier[]; selected: boolean; onToggleSelect: () => void; krwPerUsd: number | null; isAdmin: boolean; initialHeldInfo?: HeldInfo }) {
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
  const [resolveMsg, setResolveMsg] = useState<string | null>(null)
  // 확정 보류(held) 인카드 조치 — ambiguous_variant(메모리 변형 선택) / no_model·no_variant(스펙 등록 딥링크)
  const [heldInfo, setHeldInfo] = useState<HeldInfo | null>(initialHeldInfo ?? null)
  // 일괄 확정 실패 → 부모가 넘긴 조치 컨텍스트를 카드에 반영(단건과 동일한 후보버튼/딥링크 렌더).
  //  initialHeldInfo 객체 identity는 부모가 일괄 확정 1회당 한 번만 생성 → 재검증/리렌더에도 재-seed 없음.
  useEffect(() => {
    if (initialHeldInfo) setHeldInfo(initialHeldInfo)
  }, [initialHeldInfo])
  // 필드 수동 보정 — AI recheck 없이 추출값(모델명·메모리·가격·요금제) 직접 교정 → 확정 시 override_extracted로 반영
  const [editingFields, setEditingFields] = useState(false)
  const [fieldEdits, setFieldEdits] = useState<Record<string, string>>({})

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

  const handleConfirm = useCallback(async (opts?: { productId?: string; overrideMemory?: string }) => {
    const productId = opts?.productId
    setConfirming(true)
    try {
      const body: Record<string, unknown> = {
        action: 'confirm',
        confirmed_items: Array.from(checking),
      }
      if (productId) body.product_id = productId   // 해소 모달에서 기존 모델로 매핑
      const override: Record<string, unknown> = {}
      if (!selectedSupplier && manualSupplierName) override.supplier = manualSupplierName
      if (opts?.overrideMemory) override.memory = opts.overrideMemory  // 인카드 메모리 변형 선택 → 변형 특정
      // 필드 수동 보정값 병합(빈값 무시). price_usd는 숫자 변환·양수만.
      for (const [k, v] of Object.entries(fieldEdits)) {
        const t = v.trim()
        if (!t) continue
        if (k === 'price_usd') { const n = Number(t); if (Number.isFinite(n) && n > 0) override.price_usd = n }
        else override[k] = t
      }
      if (selectedSupplier) body.supplier_id = selectedSupplier.id
      if (Object.keys(override).length > 0) body.override_extracted = override
      const res = await fetch(`/api/pricing/gpu/review/${item.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        // 막다른 alert 대신 사유별 인카드 조치로 전환
        if (j.code === 'ambiguous_variant') {
          setHeldInfo({ code: j.code, message: j.error ?? '메모리 변형을 선택해 확정하세요', candidates: Array.isArray(j.candidates) ? j.candidates : [], modelName: j.modelName ?? '' })
          return
        }
        if (j.code === 'no_model' || j.code === 'no_variant') {
          setHeldInfo({ code: j.code, message: j.error ?? '카탈로그에 모델/구성이 없습니다', modelName: j.modelName ?? '', gpuCount: typeof j.gpuCount === 'number' ? j.gpuCount : undefined })
          return
        }
        // 모델 미해소(product 매핑 불일치 등) → 기존 해소 모달(기존 모델 매핑 / 신규 등록)
        if (j.code === 'model_unresolved' && !productId) { setResolveMsg(j.error ?? '모델을 카탈로그에서 찾을 수 없습니다') ; return }
        alert(j.error ?? '확정 실패')
        return
      }
      setHeldInfo(null)
      // M5: 재고 연계 결과 — 부분커밋(가격 확정·재고 실패) 시 사용자에게 알림
      if (j.stock && j.stock.ok === false) {
        alert(`확정됨. 다만 ${j.stock.msg}`)
      }
      setResolveMsg(null)
      onDone()
    } catch {
      alert('확정 실패 — 서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.')
    } finally {
      setConfirming(false)
    }
  }, [item.id, checking, onDone, selectedSupplier, manualSupplierName, fieldEdits])

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

      {/* 경쟁사 카탈로그 항목 — 업체/모델/가격 컴팩트 표시 + 필드 수동 보정 */}
      {isCompetitor && (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }} data-testid="competitor-review-fields">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="gpu-badge gpu-badge-t2" style={{ fontSize: 10 }}>경쟁사 카탈로그</span>
            {isAdmin && (
              <button type="button" className="gpu-btn" style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => { setEditingFields((v) => !v); if (editingFields) setFieldEdits({}) }}>
                {editingFields ? '편집 취소' : '✏️ 값 수정'}
              </button>
            )}
          </div>
          {([['업체', 'competitor_name'], ['모델', 'model_name'], ['메모리', 'memory'], ['가격(USD/hr)', 'price_usd'], ['요금제', 'pricing_model']] as Array<[string, string]>).map(([label, key]) => {
            const editable = editingFields && key !== 'competitor_name'  // 업체명은 보정 대상 아님(공급사 힌트)
            const rawVal = extracted[key]
            const editVal = fieldEdits[key] ?? (rawVal == null ? '' : String(rawVal))
            return (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 8, background: 'var(--surface-bg)', border: 'var(--hairline) solid var(--color-border)' }}>
                <span style={{ minWidth: 96, fontSize: 12, color: 'var(--gpu-muted)' }}>{label}</span>
                {editable ? (
                  <input className="input-field" style={{ flex: 1, fontSize: 13, padding: '4px 8px' }}
                    type={key === 'price_usd' ? 'number' : 'text'}
                    value={editVal}
                    placeholder={key === 'pricing_model' ? 'on_demand' : ''}
                    onChange={(e) => setFieldEdits((p) => ({ ...p, [key]: e.target.value }))} />
                ) : (
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    {fmtField(key, extracted[key], krwPerUsd) !== '' ? fmtField(key, extracted[key], krwPerUsd) : <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>—</span>}
                  </span>
                )}
              </div>
            )
          })}
          {editingFields && <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>값을 고친 뒤 아래 ✓ 확정을 누르면 보정값으로 반영됩니다.</div>}
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
                    : fmtField(f, val, krwPerUsd) !== '' ? fmtField(f, val, krwPerUsd) : <span style={{ color: 'var(--gpu-faint)', fontWeight: 400 }}>미인식</span>
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

      {/* 낮은 신뢰도 안내 (확정 관련 — admin만) */}
      {isAdmin && lowConfFields.length > 0 && !allLowChecked && (
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

      {/* AI 재분석 섹션 (공급사 항목 전용 — 경쟁사 카탈로그는 미적용). 액션이므로 admin만. */}
      {isAdmin && !isCompetitor && (
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

      {/* 확정 보류 인카드 조치 — 막다른 알럿 대신 그 자리서 해결 */}
      {isAdmin && heldInfo && (
        <div role="alert" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 8, background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)' }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--warning)', marginBottom: 8 }}>{heldInfo.message}</div>
          {heldInfo.code === 'ambiguous_variant' && (heldInfo.candidates ?? []).length > 0 ? (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginBottom: 6 }}>아래에서 카탈로그 변형을 선택하면 그 변형으로 바로 확정됩니다.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {/* 동일 (메모리·장수) 중복 변형은 1개로 합쳐 표시(카탈로그 중복행 대비) — 첫 변형 id로 결합 */}
                {Array.from(new Map((heldInfo.candidates ?? []).map((c) => [`${c.memory ?? ''}|${c.gpuCount}`, c])).values()).map((c) => (
                  <button key={c.id} type="button" className="gpu-btn gpu-btn-primary" disabled={confirming}
                    onClick={() => handleConfirm({ productId: c.id })}
                    style={{ fontSize: 12 }}>
                    {heldInfo.modelName} {c.memory ?? '(메모리 미지정)'}{c.gpuCount > 1 ? ` ×${c.gpuCount}` : ''}(으)로 확정
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>변형 메모리가 비어 있다면 스펙 관리에서 해당 모델의 메모리를 채워 두면 다음부터 자동 매칭됩니다.</div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                {heldInfo.code === 'no_variant'
                  ? `'${heldInfo.modelName}'은 있으나 ${heldInfo.gpuCount ?? 1}장 구성이 없습니다. 그 구성을 추가한 뒤 다시 확정하세요.`
                  : `'${heldInfo.modelName}'이 카탈로그에 없습니다. 모델을 등록한 뒤 다시 확정하세요.`}
              </span>
              <button type="button" className="gpu-btn gpu-btn-primary" style={{ fontSize: 12 }}
                onClick={() => {
                  const q = heldInfo.code === 'no_variant' && heldInfo.gpuCount ? `&count=${heldInfo.gpuCount}` : ''
                  window.location.href = `/pricing/gpu?tab=specs&newModel=${encodeURIComponent(heldInfo.modelName)}${q}`
                }}>
                <Plus size={13} /> {heldInfo.code === 'no_variant' ? '스펙 관리에서 구성 추가' : '스펙 관리에서 모델 등록'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* 액션 버튼 (확정·반려) — admin 전용. member는 조회+선택(삭제)만. */}
      {isAdmin && (
      <div className="gpu-rev-actions" style={{ marginTop: 14 }}>
        <button
          className="gpu-btn gpu-btn-primary"
          onClick={() => handleConfirm()}
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
      )}

      {resolveMsg && (
        <ModelResolveModal
          modelName={String(extracted.model_name ?? item.product_hint ?? '')}
          message={resolveMsg}
          busy={confirming}
          onPick={(pid) => handleConfirm({ productId: pid })}
          onClose={() => setResolveMsg(null)}
        />
      )}
    </div>
  )
}

export default function ReviewTab({ isAdmin = false }: { isAdmin?: boolean }) {
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
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkModal, setBulkModal] = useState<null | { type: 'confirm' | 'delete'; targets: ReviewItem[]; lowConf: ReviewItem[] }>(null)
  const [bulkResult, setBulkResult] = useState<null | { title: string; lines: string[]; failed: Array<{ hint: string; error: string }> }>(null)
  // 일괄 확정 실패 항목의 인카드 조치 컨텍스트(id→HeldInfo) — 각 실패 카드에 후보버튼/딥링크를 그대로 띄운다.
  const [bulkHeld, setBulkHeld] = useState<Record<string, HeldInfo>>({})

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

  // 저신뢰(90% 미만) 필드 — 일괄 확정 시 자동수용 대상(감사 기록용)
  const lowConfFieldsOf = useCallback((it: ReviewItem): string[] => {
    if (it.target === 'competitor') return []
    const conf = it.current_confidence ?? {}
    return CONF_FIELDS.filter((f) => conf[f] != null && (conf[f] as number) < 90)
  }, [])

  // 일괄 확정/삭제 — 표준 모달(NbModal)로 동의받고 서버 bulk 라우트 1회 호출.
  const openBulkConfirm = useCallback(() => {
    const targets = filtered.filter((it) => selected.has(it.id))
    if (targets.length === 0) return
    setBulkModal({ type: 'confirm', targets, lowConf: targets.filter((it) => lowConfFieldsOf(it).length > 0) })
  }, [filtered, selected, lowConfFieldsOf])

  const openBulkDelete = useCallback(() => {
    const targets = filtered.filter((it) => selected.has(it.id))
    if (targets.length === 0) return
    setBulkModal({ type: 'delete', targets, lowConf: [] })
  }, [filtered, selected])

  // AI 확신(신뢰도 높음) 대기 항목만 서버가 골라 한 번에 확정. 관리자 전용·감사기록·되돌리기 그대로.
  const runAutoConfirm = useCallback(async () => {
    setBulkBusy(true)
    try {
      const res = await fetch('/api/pricing/gpu/review/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'auto_confirm' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setBulkResult({ title: '자동 확정 실패', lines: [j.error ?? '서버 오류로 확정하지 못했어요.'], failed: [] }); return }
      const failedArr = (Array.isArray(j.failed) ? j.failed : []) as Array<{ hint: string | null; error: string }>
      setBulkResult({
        title: 'AI 확신 항목 자동 확정',
        lines: [
          j.confirmed > 0 ? `신뢰도 높은 ${j.confirmed}건을 가격표에 확정했어요.` : (j.message ?? 'AI가 확신하는 대기 항목이 없어요.'),
          failedArr.length > 0 ? `${failedArr.length}건은 확인이 필요해 남겨뒀어요.` : '',
        ].filter(Boolean),
        failed: failedArr.map((f) => ({ hint: f.hint ?? '', error: f.error })),
      })
      await mutate('/api/pricing/gpu/products')
      await mutate('/api/pricing/gpu/review?status=pending')
    } catch {
      setBulkResult({ title: '자동 확정 실패', lines: ['서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.'], failed: [] })
    } finally { setBulkBusy(false) }
  }, [mutate])

  const runBulkConfirm = useCallback(async () => {
    if (!bulkModal) return
    const targets = bulkModal.targets
    const ids = targets.map((it) => it.id)
    // 항목별 자동수용 저신뢰 필드(감사 정직성) — confirmed_items는 비우고 bulk로만 기록
    const autoAccepted: Record<string, string[]> = {}
    targets.forEach((it) => { autoAccepted[it.id] = lowConfFieldsOf(it) })
    setBulkBusy(true)
    try {
      const res = await fetch('/api/pricing/gpu/review/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'confirm', auto_accepted_low_conf: autoAccepted }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setBulkModal(null)
        setBulkResult({ title: '일괄 확정 실패', lines: [j.error ?? '서버 오류로 확정하지 못했습니다.'], failed: [] })
        return
      }
      const failedArr = (Array.isArray(j.failed) ? j.failed : []) as Array<{
        id: string; hint: string | null; error: string; code?: string | null
        candidates?: HeldInfo['candidates']; modelName?: string; gpuCount?: number
      }>
      const failedIds = new Set(failedArr.map((f) => f.id))
      // 실패 항목만 선택 유지 — 사용자가 바로 개별 처리
      setSelected((prev) => { const n = new Set<string>(); prev.forEach((id) => { if (failedIds.has(id)) n.add(id) }); return n })
      // 실패 항목의 인카드 조치 컨텍스트 구성 → 각 카드가 단건 확정과 동일한 후보버튼/딥링크를 즉시 표시.
      const heldMap: Record<string, HeldInfo> = {}
      failedArr.forEach((f) => {
        if (!f.code) return
        heldMap[f.id] = {
          code: f.code,
          message: f.error,
          candidates: Array.isArray(f.candidates) ? f.candidates : undefined,
          modelName: f.modelName ?? f.hint ?? '',
          gpuCount: typeof f.gpuCount === 'number' ? f.gpuCount : undefined,
        }
      })
      setBulkHeld(heldMap)
      await revalidate()
      await mutate('/api/pricing/gpu/products')
      setBulkModal(null)
      // 보류 사유별 조치 안내 — 실패 카드에 이미 뜬 조치 버튼과 대칭(창을 닫으면 각 카드에서 바로 처리).
      const ACTION_BY_CODE: Record<string, string> = {
        ambiguous_variant: '메모리 변형 선택',
        no_model: '스펙 관리에서 모델 등록',
        no_variant: '스펙 관리에서 구성 추가',
        model_unresolved: '기존 모델 매핑',
      }
      const codeCounts = new Map<string, number>()
      failedArr.forEach((f) => { if (f.code && ACTION_BY_CODE[f.code]) codeCounts.set(f.code, (codeCounts.get(f.code) ?? 0) + 1) })
      const actionLines = Array.from(codeCounts.entries()).map(([c, n]) => `· ${ACTION_BY_CODE[c]} 필요 ${n}건 — 이 창을 닫고 해당 카드의 버튼으로 확정하세요`)
      setBulkResult({
        title: '일괄 확정 완료',
        lines: [`${j.confirmed ?? 0}건을 가격표에 반영했습니다.`,
          ...(failedArr.length ? [`${failedArr.length}건은 확정하지 못했습니다 — 선택에 남겨뒀습니다. 아래 실패 카드에서 메모리 변형 선택·모델 등록 등으로 확정하세요.`] : []),
          ...actionLines],
        failed: failedArr.map((f) => ({ hint: f.hint ?? f.id, error: f.error })),
      })
    } catch {
      setBulkModal(null)
      setBulkResult({ title: '일괄 확정 실패', lines: ['서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.'], failed: [] })
    } finally {
      setBulkBusy(false)
    }
  }, [bulkModal, lowConfFieldsOf, revalidate, mutate])

  const runBulkDelete = useCallback(async () => {
    if (!bulkModal) return
    const ids = bulkModal.targets.map((it) => it.id)
    setBulkBusy(true)
    try {
      const res = await fetch('/api/pricing/gpu/review/bulk', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action: 'delete' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setBulkModal(null); setBulkResult({ title: '일괄 삭제 실패', lines: [j.error ?? '서버 오류'], failed: [] }); return }
      setSelected(new Set())
      await revalidate()
      setBulkModal(null)
      setBulkResult({ title: '일괄 삭제 완료', lines: [`${j.deleted ?? ids.length}건을 검토 대기에서 삭제했습니다.`], failed: [] })
    } catch {
      setBulkModal(null); setBulkResult({ title: '일괄 삭제 실패', lines: ['서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.'], failed: [] })
    } finally {
      setBulkBusy(false)
    }
  }, [bulkModal, revalidate])

  const FILTERS: Array<['all' | 'supplier' | 'competitor', string, number]> = [
    ['all', '전체', counts.all], ['supplier', '공급사', counts.supplier], ['competitor', '경쟁사', counts.competitor],
  ]

  return (
    // flex 칼럼 — 배너·필터/액션바는 고정, 리스트만 내부 스크롤(스크롤 시 일괄 작업바·탭 항상 보이게)
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      <div className="gpu-banner gpu-banner-warning" style={{ flexShrink: 0 }}>
        <div className="gpu-banner-dot">
          <AlertTriangle size={16} color="var(--warning)" />
        </div>
        <div>
          {isAdmin
            ? <>제출된 견적은 확정 전까지 가격표에 반영되지 않습니다. 신뢰도 90% 미만 항목은 직접 확인 체크 후 확정할 수 있습니다.</>
            : <>관리자가 승인하면 확정 반영됩니다.</>}
        </div>
      </div>

      {/* 필터 + 일괄 작업 바 (고정) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14, flexShrink: 0 }}>
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
        {isAdmin && selected.size === 0 && (
          <button
            onClick={runAutoConfirm}
            disabled={bulkBusy}
            className="gpu-btn gpu-btn-primary"
            data-testid="auto-confirm-btn"
            title="AI가 확신하는(신뢰도 높은) 대기 항목만 골라 한 번에 확정해요. 틀리면 되돌리기로 복구할 수 있어요."
            style={{ fontSize: 12, gap: 5 }}
          >
            <CheckCircle2 size={13} /> AI 확신 항목 한 번에 확정
          </button>
        )}
        {selected.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>선택 {selected.size}건</span>
            <button onClick={() => setSelected(new Set())} className="gpu-btn" style={{ fontSize: 12 }} disabled={bulkBusy}>선택 해제</button>
            {isAdmin && (
            <button onClick={openBulkConfirm} disabled={bulkBusy} className="gpu-btn gpu-btn-primary" data-testid="bulk-confirm-btn" style={{ fontSize: 12, gap: 5 }}>
              <CheckCircle2 size={13} /> 일괄 확정
            </button>
            )}
            <button onClick={openBulkDelete} disabled={bulkBusy} className="gpu-btn gpu-btn-danger" data-testid="bulk-delete-btn" style={{ fontSize: 12, gap: 5 }}>
              <X size={13} /> 일괄 삭제
            </button>
          </div>
        )}
      </div>

      {/* 항목 리스트 — 이 영역만 스크롤 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: 2 }} data-testid="review-list-scroll">
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
              isAdmin={isAdmin}
              initialHeldInfo={bulkHeld[item.id]}
            />
          ))
        )}
      </div>

      {/* 일괄 확정/삭제 동의 모달 (표준 NbModal) */}
      {bulkModal && (
        <NbModal
          title={bulkModal.type === 'confirm' ? '일괄 확정' : '일괄 삭제'}
          onClose={() => { if (!bulkBusy) setBulkModal(null) }}
          disableClose={bulkBusy}
          maxWidth={520}
          footer={
            <>
              <button className="gpu-btn" onClick={() => setBulkModal(null)} disabled={bulkBusy} style={{ fontSize: 13 }}>취소</button>
              {bulkModal.type === 'confirm' ? (
                <button className="gpu-btn gpu-btn-primary" onClick={runBulkConfirm} disabled={bulkBusy} data-testid="bulk-confirm-go" style={{ fontSize: 13, gap: 5 }}>
                  <CheckCircle2 size={14} /> {bulkBusy ? '확정 중…' : `${bulkModal.targets.length}건 확정`}
                </button>
              ) : (
                <button className="gpu-btn gpu-btn-danger" onClick={runBulkDelete} disabled={bulkBusy} data-testid="bulk-delete-go" style={{ fontSize: 13, gap: 5 }}>
                  <X size={14} /> {bulkBusy ? '삭제 중…' : `${bulkModal.targets.length}건 삭제`}
                </button>
              )}
            </>
          }
        >
          {bulkModal.type === 'confirm' ? (
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
              선택한 <strong>{bulkModal.targets.length}건</strong>을 가격표에 일괄 확정합니다.
              {bulkModal.lowConf.length > 0 && (
                <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)' }}>
                  <div style={{ fontWeight: 700, color: 'var(--warning)', marginBottom: 6 }}>
                    아래 {bulkModal.lowConf.length}건은 신뢰도 90% 미만(직접 확인 권장)이지만 일괄 확정에 포함됩니다:
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-muted)' }}>
                    {bulkModal.lowConf.slice(0, 8).map((it) => <li key={it.id}>{it.product_hint ?? it.id}</li>)}
                    {bulkModal.lowConf.length > 8 && <li>…외 {bulkModal.lowConf.length - 8}건</li>}
                  </ul>
                </div>
              )}
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                공급사·모델을 특정할 수 없는 항목은 확정되지 않고 선택에 남습니다.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
              선택한 <strong>{bulkModal.targets.length}건</strong>을 검토 대기에서 영구 삭제합니다.<br />
              <span style={{ color: 'var(--danger)' }}>되돌릴 수 없습니다.</span> 가격표·시세에는 영향이 없습니다.
            </div>
          )}
        </NbModal>
      )}

      {/* 일괄 처리 결과 모달 */}
      {bulkResult && (
        <NbModal title={bulkResult.title} onClose={() => setBulkResult(null)} maxWidth={520}
          footer={<button className="gpu-btn gpu-btn-primary" onClick={() => setBulkResult(null)} style={{ fontSize: 13 }}>확인</button>}>
          <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>
            {bulkResult.lines.map((l, i) => <div key={i}>{l}</div>)}
            {bulkResult.failed.length > 0 && (
              <div style={{ marginTop: 10, padding: '10px 12px', borderRadius: 'var(--radius)', background: 'var(--surface-muted)', border: 'var(--hairline) solid var(--color-border)', maxHeight: 220, overflowY: 'auto' }}>
                {bulkResult.failed.map((f, i) => (
                  <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 600 }}>{f.hint}</span>
                    <span style={{ color: 'var(--gpu-muted)' }}> — {f.error}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </NbModal>
      )}
    </div>
  )
}
