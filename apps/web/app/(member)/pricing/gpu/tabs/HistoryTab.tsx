'use client'

import { useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher } from '@/lib/swr-config'
import { mutateGpu } from '@/lib/gpu/swr-keys'

interface AuditLog {
  id: string
  ts: string
  actor: string | null
  action_type: string
  detail: Record<string, unknown> | null
  evidence_ref: string | null
  gpu_products: { model_name: string; memory: string; tier: number } | null
}

const FILTER_ACTION_TYPES: Record<string, string[]> = {
  '최저가 변경': ['lowest_changed'],
  '등록/수정': [
    'quote_registered', 'quote_confirmed', 'direct_set', 'margin_changed',
    'pool_stock_changed', 'availability_registered', 'review_created',
    'review_finalized', 'review_rejected', 'review_recheck_completed',
    'rejected', 'inquiry_sent',
  ],
  '만료': ['expired'],
}

const ACTION_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  quote_registered:         { label: '견적 등록',      color: '#2563eb', bg: '#f3effe' },
  quote_confirmed:          { label: '견적 확정',      color: '#15a35a', bg: '#e6f7ee' },
  lowest_changed:           { label: '최저가 변경',    color: '#5b5ef0', bg: '#eef0fe' },
  expired:                  { label: '만료',           color: '#e0405a', bg: '#fdebee' },
  direct_set:               { label: '판매가 직접설정', color: '#d97706', bg: '#fef3e2' },
  margin_changed:           { label: '마진 변경',      color: '#7c3aed', bg: '#f1ebfe' },
  rejected:                 { label: '반려',           color: '#6b7280', bg: '#f0f1f4' },
  review_created:           { label: 'AI 분석 등록',   color: 'var(--brand-dark)', bg: '#f3effe' },
  review_finalized:         { label: '검토 확정',      color: '#15a35a', bg: '#e6f7ee' },
  review_rejected:          { label: '검토 반려',      color: '#dc2626', bg: '#fee2e2' },
  review_recheck_completed: { label: 'AI 재분석',      color: '#0891b2', bg: '#e0f7fa' },
  pool_stock_changed:       { label: 'T3 재고 변경',   color: '#b45309', bg: '#fef3e2' },
  availability_registered:  { label: '가용량 등록',    color: '#0d9488', bg: '#f0fdfa' },
  inquiry_sent:             { label: '문의 발송',      color: '#0ea5e9', bg: '#f0f9ff' },
}

const AVAILABILITY_STATUS: Record<string, string> = {
  available_full:    '전량 가용',
  available_partial: '일부 가용',
  out_of_stock:      '재고 없음',
  declined:          '공급 거절',
  pending:           '확인 중',
}

function renderDetail(type: string, detail: Record<string, unknown>): string | null {
  const d = detail
  switch (type) {
    case 'quote_registered':
      return d.unit_price_usd != null ? `단가 $${d.unit_price_usd}/hr` : null
    case 'quote_confirmed':
      return d.unit_price_usd != null ? `$${d.unit_price_usd}/hr 확정` : '확정 완료'
    case 'lowest_changed': {
      const prev = d.prev_usd != null ? `$${d.prev_usd}` : null
      const next = d.new_usd != null ? `$${d.new_usd}` : null
      if (prev && next) return `${prev} → ${next}/hr`
      if (next) return `최저가 ${next}/hr`
      return null
    }
    case 'direct_set':
      return d.sell_price_krw != null
        ? `판매가 ₩${Number(d.sell_price_krw).toLocaleString()}/hr`
        : null
    case 'margin_changed':
      return d.margin_pct != null ? `마진 → ${d.margin_pct}%` : null
    case 'expired':
      return '견적 유효기간 만료'
    case 'review_created': {
      const parts: string[] = []
      if (d.product_hint) parts.push(String(d.product_hint))
      if (d.supplier_hint) parts.push(String(d.supplier_hint))
      if (d.overall_confidence != null) parts.push(`신뢰도 ${d.overall_confidence}%`)
      return parts.length ? parts.join(' · ') : null
    }
    case 'review_finalized': {
      const parts: string[] = []
      if (d.supplier_hint) parts.push(String(d.supplier_hint))
      if (d.unit_price_usd != null) parts.push(`$${d.unit_price_usd}/hr`)
      if (d.overall_confidence != null) parts.push(`신뢰도 ${d.overall_confidence}%`)
      return parts.length ? parts.join(' · ') : null
    }
    case 'review_rejected':
      return String(d.reason ?? '사유 없음')
    case 'review_recheck_completed':
      return d.iteration_no != null
        ? `${d.iteration_no}차 재분석 · 신뢰도 ${d.overall_confidence}%`
        : null
    case 'pool_stock_changed':
      return d.pool_qty != null ? `T3 풀 재고 → ${d.pool_qty}대` : null
    case 'availability_registered': {
      const statusLabel = AVAILABILITY_STATUS[String(d.status)] ?? String(d.status)
      const qty = d.resp_qty != null ? ` · ${d.resp_qty}대` : ''
      return `${statusLabel}${qty}`
    }
    case 'inquiry_sent':
      return d.supplier_name ? `${d.supplier_name}에 문의 발송` : '공급사 문의 발송'
    default:
      return null
  }
}

export default function HistoryTab() {
  const { data, mutate } = useSWR<{ logs: AuditLog[] }>('/api/pricing/gpu/audit', fetcher)
  const { mutate: globalMutate } = useSWRConfig()
  const logs = data?.logs ?? []
  const [filter, setFilter] = useState('전체')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [withData, setWithData] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })

  const batchDelete = async () => {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`로그 ${ids.length}건${withData ? ' + 연결된 견적 데이터' : ''}을 삭제할까요?`)) return
    setDeleting(true)
    try {
      const res = await fetch('/api/pricing/gpu/audit', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, delete_data: withData }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { alert(j.error ?? '삭제 실패'); return }
      alert(`삭제 완료: 로그 ${j.logs_deleted}건${j.data_deleted ? ` · 견적 ${j.data_deleted}건` : ''}`)
      setSelected(new Set()); mutate(); mutateGpu(globalMutate)
    } finally { setDeleting(false) }
  }

  const filtered = logs.filter((log) => {
    if (filter !== '전체') {
      const allowed = FILTER_ACTION_TYPES[filter] ?? []
      if (!allowed.includes(log.action_type)) return false
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      const cfg = ACTION_CONFIG[log.action_type]
      const model = log.gpu_products?.model_name?.toLowerCase() ?? ''
      const actor = log.actor?.toLowerCase() ?? ''
      const label = cfg?.label?.toLowerCase() ?? log.action_type.toLowerCase()
      const detail = log.detail ?? {}
      const supplier = (
        String(detail.supplier_hint ?? detail.supplier_name ?? detail.supplier ?? '')
      ).toLowerCase()
      if (!model.includes(q) && !actor.includes(q) && !label.includes(q) && !supplier.includes(q)) return false
    }
    return true
  })

  const tabs = ['전체', '최저가 변경', '등록/수정', '만료']

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input
            placeholder="이력 검색 (모델·공급사·작업)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="gpu-seg">
          {tabs.map((t) => (
            <button key={t} className={filter === t ? 'on' : ''} onClick={() => setFilter(t)}>{t}</button>
          ))}
        </div>
      </div>

      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', marginBottom: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, fontSize: 12.5 }}>
          <strong>{selected.size}건 선택</strong>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
            <input type="checkbox" checked={withData} onChange={(e) => setWithData(e.target.checked)} />
            연결된 견적 데이터도 삭제
          </label>
          <button onClick={batchDelete} disabled={deleting} className="gpu-btn" style={{ marginLeft: 'auto', color: '#fff', background: 'var(--gpu-red)', borderColor: 'var(--gpu-red)', gap: 4 }}>
            🗑 {deleting ? '삭제 중…' : '선택 삭제'}
          </button>
          <button onClick={() => setSelected(new Set())} className="gpu-btn">선택 해제</button>
        </div>
      )}

      <div className="gpu-panel gpu-card-pad">
        {filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
            {logs.length === 0 ? '변동 이력이 없습니다' : '검색 결과가 없습니다'}
          </div>
        ) : (
          filtered.map((log) => {
            const cfg = ACTION_CONFIG[log.action_type] ?? { label: log.action_type, color: '#6b7280', bg: '#f0f1f4' }
            const product = log.gpu_products
            const ts = new Date(log.ts)
            const desc = log.detail ? renderDetail(log.action_type, log.detail) : null

            return (
              <div key={log.id} className="gpu-log-item" style={selected.has(log.id) ? { background: '#fef2f2' } : undefined}>
                <input type="checkbox" checked={selected.has(log.id)} onChange={() => toggle(log.id)} aria-label="로그 선택"
                  style={{ alignSelf: 'center', marginRight: 4, cursor: 'pointer' }} />
                <div className="gpu-log-time">
                  <div>{ts.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })}</div>
                  <div>{ts.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
                <div className="gpu-log-ico" style={{ background: cfg.bg }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={cfg.color} strokeWidth="2.2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                </div>
                <div className="gpu-log-body">
                  <div className="gpu-log-ttl">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: cfg.bg, color: cfg.color, fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6 }}>
                      {cfg.label}
                    </span>
                    {product && (
                      <span className="gpu-mono" style={{ color: 'var(--gpu-accent-ink)', marginLeft: 8 }}>
                        {product.model_name} {product.memory}
                      </span>
                    )}
                  </div>
                  {desc && <div className="gpu-log-dsc">{desc}</div>}
                  <div className="gpu-log-actor">
                    {log.actor && (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                        {log.actor}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
