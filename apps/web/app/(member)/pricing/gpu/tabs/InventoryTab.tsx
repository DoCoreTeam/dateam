'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { ChevronDown, ChevronUp, Package } from 'lucide-react'

interface SupplierAvail {
  supplier_id: string | null
  supplier: { id: string; name: string; color: string; location: string | null } | null
  status: string
  resp_qty: number | null
  freshness: string
  received_at: string
  expires_at: string | null
}

interface InventoryItem {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  pricing_mode: string
  fresh_available_qty: number
  oos_supplier_count: number
  stale_count: number
  pending_review_count: number
  latest_response_at: string | null
  pool_qty: number | null
  pool_set_at: string | null
  pool_note: string | null
  supplier_availability: SupplierAvail[]
  has_active_quote?: boolean
  lowest_unit_price_usd?: number | null
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  available_full: { label: '전량 가용', color: 'var(--gpu-green)' },
  available_partial: { label: '일부 가용', color: 'var(--gpu-amber)' },
  out_of_stock: { label: '품절', color: 'var(--gpu-red)' },
  declined: { label: '거절', color: 'var(--gpu-faint)' },
  pending: { label: '확인 중', color: 'var(--gpu-muted)' },
}

const FRESHNESS_CONFIG: Record<string, { label: string; color: string }> = {
  fresh: { label: '최신', color: 'var(--gpu-green)' },
  stale: { label: '만료', color: 'var(--gpu-red)' },
  pending_review: { label: '검토 중', color: 'var(--gpu-amber)' },
  unknown: { label: '불명', color: 'var(--gpu-faint)' },
}

const TIER_LABELS = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' }
const TIER_BADGES = { 1: 'gpu-badge-t1', 2: 'gpu-badge-t2', 3: 'gpu-badge-t3' }

function HealthBar({ qty, max }: { qty: number; max: number }) {
  const pct = max > 0 ? Math.min((qty / max) * 100, 100) : 0
  const color = pct >= 70 ? 'var(--gpu-green)' : pct >= 30 ? 'var(--gpu-amber)' : 'var(--gpu-red)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#e5e7eb', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color, minWidth: 32 }}>{qty}</span>
    </div>
  )
}

function InventoryCard({ item }: { item: InventoryItem }) {
  const [expanded, setExpanded] = useState(false)
  const maxQty = item.supplier_availability.reduce((a, s) => Math.max(a, s.resp_qty ?? 0), item.fresh_available_qty || 10)

  const hasData = item.supplier_availability.length > 0 || item.pool_qty != null

  return (
    <div className="gpu-rev-card" style={{ padding: '14px 16px' }}>
      {/* 헤더 */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: hasData ? 'pointer' : 'default' }}
        onClick={() => hasData && setExpanded((v) => !v)}
      >
        <div className="gpu-chip" style={{ width: 38, height: 38, flexShrink: 0 }}>
          {item.model_name.charAt(0)}
          <span style={{ fontSize: 8 }}>{item.memory}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: '#111827' }}>
              {item.model_name} {item.memory}
            </span>
            <span className={`gpu-badge ${TIER_BADGES[item.tier]}`} style={{ fontSize: 10 }}>
              {TIER_LABELS[item.tier]}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginTop: 2 }}>
            ×{item.gpu_count} GPU
            {item.latest_response_at && (
              <> · 최근 응답: {new Date(item.latest_response_at).toLocaleDateString('ko-KR')}</>
            )}
          </div>
        </div>

        {/* 요약 수치 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          {item.tier === 3 && item.pool_qty != null ? (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: item.pool_qty > 0 ? 'var(--gpu-green)' : 'var(--gpu-red)', fontFamily: 'var(--font-mono, monospace)' }}>
                {item.pool_qty}
              </div>
              <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>풀 재고 (GPU)</div>
            </div>
          ) : (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 800, color: item.fresh_available_qty > 0 ? 'var(--gpu-green)' : 'var(--gpu-faint)', fontFamily: 'var(--font-mono, monospace)' }}>
                {item.fresh_available_qty}
              </div>
              <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>가용 (신선)</div>
            </div>
          )}

          {hasData && (
            <span style={{ color: 'var(--gpu-muted)', padding: 4, lineHeight: 0 }}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          )}
        </div>
      </div>

      {/* 헬스바 */}
      {item.tier !== 3 && item.supplier_availability.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <HealthBar qty={item.fresh_available_qty} max={Math.max(maxQty, 1)} />
        </div>
      )}

      {/* 상태 요약 칩 */}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {item.oos_supplier_count > 0 && (
          <span className="gpu-badge" style={{ background: '#fee2e2', color: '#dc2626', fontSize: 10 }}>
            품절 {item.oos_supplier_count}개 공급사
          </span>
        )}
        {item.stale_count > 0 && (
          <span className="gpu-badge" style={{ background: '#f3f4f6', color: 'var(--gpu-muted)', fontSize: 10 }}>
            만료 {item.stale_count}개
          </span>
        )}
        {item.pending_review_count > 0 && (
          <span className="gpu-badge gpu-badge-amber" style={{ fontSize: 10 }}>
            검토 중 {item.pending_review_count}개
          </span>
        )}
        {item.supplier_availability.length === 0 && item.pool_qty == null && item.has_active_quote && (
          <span className="gpu-badge" style={{ background: '#ecfdf5', color: '#059669', fontSize: 10 }}>견적 보유 · 공급 가능</span>
        )}
        {item.supplier_availability.length === 0 && item.pool_qty == null && !item.has_active_quote && (
          <span className="gpu-badge gpu-badge-gray" style={{ fontSize: 10 }}>가용량 정보 없음</span>
        )}
      </div>

      {/* 공급사별 상세 (펼침) */}
      {expanded && (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {item.tier === 3 && item.pool_qty != null && (
            <div style={{ padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#15803d' }}>
                  <Package size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                  풀 재고 (직접 관리)
                </div>
                {item.pool_note && (
                  <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginTop: 2 }}>{item.pool_note}</div>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color: item.pool_qty > 0 ? '#15803d' : 'var(--gpu-red)', fontFamily: 'var(--font-mono, monospace)' }}>
                {item.pool_qty} GPU
              </div>
            </div>
          )}

          {item.supplier_availability.map((sa, i) => {
            const status = STATUS_CONFIG[sa.status] ?? { label: sa.status, color: 'var(--gpu-faint)' }
            const freshness = FRESHNESS_CONFIG[sa.freshness] ?? FRESHNESS_CONFIG.unknown
            const sup = sa.supplier
            return (
              <div key={i} style={{ padding: '8px 12px', borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="gpu-sdot" style={{ background: sup?.color ?? '#e5e7eb', flexShrink: 0 }} />
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{sup?.name ?? '알 수 없음'}</span>
                <span style={{ fontSize: 11, color: status.color, fontWeight: 600 }}>{status.label}</span>
                {sa.resp_qty != null && (
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)', minWidth: 40, textAlign: 'right' }}>
                    {sa.resp_qty} GPU
                  </span>
                )}
                <span style={{ fontSize: 10, color: freshness.color, minWidth: 32 }}>{freshness.label}</span>
                <span style={{ fontSize: 10, color: 'var(--gpu-faint)' }}>
                  {new Date(sa.received_at).toLocaleDateString('ko-KR')}
                </span>
              </div>
            )
          })}

          {item.supplier_availability.length === 0 && item.tier !== 3 && (
            <div style={{ textAlign: 'center', padding: '16px', color: 'var(--gpu-faint)', fontSize: 12 }}>
              공급사 가용량 응답 없음 — 문의 후 등록해 주세요
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function InventoryTab() {
  const { data } = useSWR<{ inventory: InventoryItem[] }>('/api/pricing/gpu/inventory', fetcher, {
    refreshInterval: 60000,
  })
  const inventory = data?.inventory ?? []

  const [tierFilter, setTierFilter] = useState(0)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<'tier' | 'model' | 'qty_desc' | 'qty_asc'>('tier')

  const availQty = (p: InventoryItem) =>
    p.tier === 3 && p.pool_qty != null ? p.pool_qty : p.fresh_available_qty

  const filtered = inventory.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (p.model_name ?? '').toLowerCase().includes(q) || (p.memory ?? '').toLowerCase().includes(q)
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === 'model') return (a.model_name ?? '').localeCompare(b.model_name ?? '', 'ko')
    if (sortKey === 'qty_desc') return availQty(b) - availQty(a)
    if (sortKey === 'qty_asc') return availQty(a) - availQty(b)
    // tier
    return a.tier - b.tier || (a.model_name ?? '').localeCompare(b.model_name ?? '', 'ko')
  })

  const totalFresh = inventory.reduce((a, p) => a + p.fresh_available_qty, 0)
  const oosCount = inventory.filter((p) => p.oos_supplier_count > 0).length
  const tier3WithPool = inventory.filter((p) => p.tier === 3 && p.pool_qty != null && p.pool_qty > 0).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ── 고정 헤더 ── */}
      <div style={{ flexShrink: 0 }}>
      {/* 요약 통계 */}
      <div className="gpu-stats">
        <div className="gpu-stat">
          <div className="gpu-stat-lbl">신선 가용 GPU (합계)</div>
          <div className="gpu-stat-val">{totalFresh}<span className="gpu-stat-unit">대</span></div>
          <div className="gpu-stat-sub">72h 이내 확인</div>
        </div>
        <div className="gpu-stat">
          <div className="gpu-stat-lbl">품절 발생 모델</div>
          <div className="gpu-stat-val" style={{ color: oosCount > 0 ? 'var(--gpu-red)' : undefined }}>
            {oosCount}<span className="gpu-stat-unit">개</span>
          </div>
          <div className="gpu-stat-sub">1개 이상 공급사 품절</div>
        </div>
        <div className="gpu-stat">
          <div className="gpu-stat-lbl">T3 풀 재고 보유</div>
          <div className="gpu-stat-val">{tier3WithPool}<span className="gpu-stat-unit">모델</span></div>
          <div className="gpu-stat-sub">직접 입력 재고</div>
        </div>
        <div className="gpu-stat">
          <div className="gpu-stat-lbl">전체 관리 모델</div>
          <div className="gpu-stat-val">{inventory.length}<span className="gpu-stat-unit">개</span></div>
          <div className="gpu-stat-sub">T1 · T2 · T3 합산</div>
        </div>
      </div>

      {/* 툴바 */}
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input
            placeholder="모델명 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="gpu-seg">
          {([0, 1, 2, 3] as const).map((t) => (
            <button
              key={t}
              className={tierFilter === t ? 'on' : ''}
              onClick={() => setTierFilter(t)}
            >
              {t === 0 ? `전체 ${inventory.length}` : `T${t} · ${inventory.filter((p) => p.tier === t).length}`}
            </button>
          ))}
        </div>
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
          aria-label="정렬 기준"
          style={{
            marginLeft: 'auto', height: 34, borderRadius: 8,
            border: '1.5px solid var(--gpu-border)', background: '#fff',
            padding: '0 10px', fontSize: 12.5, fontWeight: 600,
            color: 'var(--gpu-ink)', cursor: 'pointer',
          }}
        >
          <option value="tier">정렬: Tier 순</option>
          <option value="model">정렬: 모델명</option>
          <option value="qty_desc">정렬: 가용량 많은순</option>
          <option value="qty_asc">정렬: 가용량 적은순</option>
        </select>
      </div>

      </div>{/* end 고정 헤더 */}

      {/* ── 스크롤 영역 ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
      {/* 리스트 */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: 13 }}>
          가용량 정보가 없습니다
        </div>
      ) : (
        sorted.map((item) => <InventoryCard key={item.id} item={item} />)
      )}
      </div>{/* end 스크롤 영역 */}
    </div>
  )
}
