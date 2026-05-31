'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'

interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  pricing_mode: 'quote' | 'direct'
  lowest_unit_price_usd: number | null
  sell_price_krw: number | null
  sell_price_usd: number | null
}

interface ProductsResponse {
  products: GpuProduct[]
  margin_pct: number
  usd_krw: number
}

type SortKey = 'model' | 'tier' | 'price'
type SortDir = 'asc' | 'desc'

const TIER_INFO = {
  1: { label: 'Tier 1', desc: '전용 고성능·보장형', color: '#13151c' },
  2: { label: 'Tier 2', desc: '점유형(예약 단독)·보장형', color: '#1e40af' },
  3: { label: 'Tier 3', desc: '간헐 공급(중단/재개)·최저가', color: '#b45309' },
}

const GPU_ICONS: Record<string, string> = {
  H: '#1a1a2e', A: '#0d1b2a', B: '#1a0a2e', R: '#1a1a1a',
}

function GpuChip({ model, memory }: { model: string; memory: string }) {
  const bg = GPU_ICONS[model[0]?.toUpperCase() ?? ''] ?? '#1a1a1a'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 36, height: 36, borderRadius: 8, background: bg,
      color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
      fontFamily: 'monospace', lineHeight: 1,
    }}>
      <span style={{ fontSize: 9 }}>{memory.replace('GB', '')}</span>
      <span style={{ fontSize: 7, opacity: 0.7 }}>GB</span>
    </span>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" style={{ marginLeft: 2, opacity: active ? 1 : 0.3, flexShrink: 0 }}>
      {(!active || dir === 'asc')
        ? <path d="M5 2L8 7H2L5 2Z" fill={active ? 'var(--gpu-accent)' : 'currentColor'} />
        : <path d="M5 8L2 3H8L5 8Z" fill="var(--gpu-accent)" />
      }
    </svg>
  )
}

const HR_720 = 24 * 30
const HR_4320 = 24 * 180
const HR_8760 = 24 * 365

export default function SalePriceCatalogPage() {
  const { data, isLoading } = useSWR<ProductsResponse>('/api/pricing/gpu/products', fetcher, {
    refreshInterval: 60000,
  })
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0)
  const [currencyMode, setCurrencyMode] = useState<'KRW' | 'USD'>('KRW')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('tier')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [hoursInput, setHoursInput] = useState('')

  const products = data?.products ?? []
  const usdKrw = data?.usd_krw ?? 1400
  const marginPct = data?.margin_pct ?? 18
  const customHours = parseInt(hoursInput) > 0 ? parseInt(hoursInput) : null

  const getSellPrice = (p: GpuProduct) => {
    if (p.pricing_mode === 'direct') {
      if (!p.sell_price_krw) return null
      return { krw: p.sell_price_krw, usd: p.sell_price_krw / usdKrw }
    }
    if (!p.lowest_unit_price_usd) return null
    const usd = p.lowest_unit_price_usd * (1 + marginPct / 100)
    return { krw: Math.round(usd * usdKrw), usd }
  }

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const pricedProducts = products.filter((p) =>
    p.lowest_unit_price_usd != null || (p.pricing_mode === 'direct' && p.sell_price_krw != null)
  )

  const filtered = pricedProducts.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return p.model_name.toLowerCase().includes(q) || p.memory.toLowerCase().includes(q)
    }
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortKey === 'model') cmp = a.model_name.localeCompare(b.model_name)
    else if (sortKey === 'tier') cmp = a.tier - b.tier || a.model_name.localeCompare(b.model_name)
    else if (sortKey === 'price') {
      const pa = getSellPrice(a)?.usd ?? Infinity
      const pb = getSellPrice(b)?.usd ?? Infinity
      cmp = pa - pb
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const fmtKrw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`
  const fmtUsd = (v: number, dec = 0) => `$${v.toFixed(dec)}`
  const fmtHours = (h: number) => h >= 10000 ? `${(h / 10000).toFixed(1)}만h` : h >= 1000 ? `${(h / 1000).toFixed(1)}천h` : `${h}h`

  // 커스텀 시간이 있으면 6개월 대신 커스텀 컬럼 표시
  const COL = customHours
    ? '1fr 60px 108px 118px 118px 118px'
    : '1fr 60px 108px 118px 118px 118px'

  const thBase: React.CSSProperties = {
    fontSize: 11, fontWeight: 600, color: 'var(--gpu-muted)',
    textTransform: 'uppercase', letterSpacing: '0.05em',
  }

  return (
    <div className="page-inner">
      {/* 헤더 */}
      <div className="gpu-topbar">
        <div>
          <div className="gpu-crumb">가격정책</div>
          <h2 className="gpu-page-title">GPU 판매 가격표</h2>
        </div>
        <div className="gpu-topbar-right" style={{ gap: 8 }}>
          <div className="gpu-fx-pill" title="현재 적용 환율">
            <span className="gpu-fx-dot" />
            1 USD = <span className="gpu-mono">{Math.round(usdKrw).toLocaleString('ko-KR')}원</span>
          </div>
          <div className="gpu-fx-pill" style={{ color: 'var(--gpu-muted)', fontSize: 11 }}>
            마진 {marginPct}% 적용
          </div>
        </div>
      </div>

      {/* 필터 바 */}
      <div className="gpu-toolbar" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            type="text"
            placeholder="모델 검색 (H100, B200, 4090 ...)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {/* 시간 계산기 */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          border: '1px solid var(--gpu-border)', borderRadius: 7,
          padding: '0 10px', background: customHours ? 'rgba(99,102,241,0.06)' : 'transparent',
          borderColor: customHours ? 'var(--gpu-accent)' : 'var(--gpu-border)',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={customHours ? 'var(--gpu-accent)' : 'var(--gpu-muted)'} strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>
          </svg>
          <input
            type="number"
            min="1"
            max="99999"
            placeholder="시간 입력"
            value={hoursInput}
            onChange={(e) => setHoursInput(e.target.value)}
            style={{
              width: 72, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 12, color: customHours ? 'var(--gpu-accent)' : '#374151', fontWeight: customHours ? 600 : 400,
            }}
          />
          <span style={{ fontSize: 11, color: customHours ? 'var(--gpu-accent)' : 'var(--gpu-muted)', whiteSpace: 'nowrap' }}>시간 비용</span>
          {customHours && (
            <button onClick={() => setHoursInput('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gpu-muted)', fontSize: 12, padding: '0 2px' }}>✕</button>
          )}
        </div>
        <div className="gpu-seg">
          {([0, 1, 2, 3] as const).map((t) => (
            <button key={t} className={tierFilter === t ? 'on' : ''} onClick={() => setTierFilter(t)}>
              {t === 0 ? '전체' : `Tier ${t}`}
            </button>
          ))}
        </div>
        <div className="gpu-seg" style={{ marginLeft: 'auto' }}>
          <button className={currencyMode === 'KRW' ? 'on' : ''} onClick={() => setCurrencyMode('KRW')}>₩ 원</button>
          <button className={currencyMode === 'USD' ? 'on' : ''} onClick={() => setCurrencyMode('USD')}>$ 달러</button>
        </div>
      </div>

      {/* Tier 설명 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {([1, 2, 3] as const).map((t) => (
          <div key={t} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6,
            background: 'var(--gpu-surface)', border: `1px solid var(--gpu-border)`,
            borderLeft: `3px solid ${TIER_INFO[t].color}`, fontSize: 11, color: 'var(--gpu-muted)',
          }}>
            <span style={{ fontWeight: 700, color: '#374151' }}>Tier {t}</span>
            <span>{TIER_INFO[t].desc}</span>
          </div>
        ))}
      </div>

      {/* 가격표 */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gpu-muted)' }}>로딩 중...</div>
      ) : (
        <div style={{ background: 'var(--gpu-surface)', borderRadius: 12, border: '1px solid var(--gpu-border)', overflow: 'hidden' }}>
          {/* 헤더 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 8, padding: '10px 20px', background: 'var(--gpu-bg)', borderBottom: '1px solid var(--gpu-border)' }}>
            <div
              style={{ ...thBase, display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', color: sortKey === 'model' ? 'var(--gpu-accent)' : 'var(--gpu-muted)' }}
              onClick={() => handleSort('model')}
            >
              GPU 모델 <SortIcon active={sortKey === 'model'} dir={sortDir} />
            </div>
            <div
              style={{ ...thBase, textAlign: 'center', cursor: 'pointer', color: sortKey === 'tier' ? 'var(--gpu-accent)' : 'var(--gpu-muted)' }}
              onClick={() => handleSort('tier')}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                구분 <SortIcon active={sortKey === 'tier'} dir={sortDir} />
              </span>
            </div>
            <div
              style={{ ...thBase, textAlign: 'right', cursor: 'pointer', color: sortKey === 'price' ? 'var(--gpu-accent)' : customHours ? 'var(--gpu-accent)' : 'var(--gpu-muted)' }}
              onClick={() => handleSort('price')}
            >
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
                {customHours ? <>/ {customHours.toLocaleString()}<span style={{ fontWeight: 400, opacity: 0.8 }}>시간</span></> : '/ 1시간'}
                <SortIcon active={sortKey === 'price'} dir={sortDir} />
              </span>
            </div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 월 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_720)})</span></div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 6개월 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_4320)})</span></div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 연간 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_8760)})</span></div>
          </div>

          {/* 데이터 행 */}
          {sorted.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gpu-muted)', fontSize: 13 }}>
              {search ? `"${search}"에 해당하는 모델이 없습니다` : '등록된 가격이 없습니다'}
            </div>
          ) : (
            sorted.map((p) => {
              const price = getSellPrice(p)
              const tierConf = TIER_INFO[p.tier]
              const gpuCount = p.gpu_count ?? 1

              const calcKrw = (h: number) => price ? Math.round(price.krw * h) : null
              const calcUsd = (h: number) => price ? price.usd * h : null

              const fmt = (h: number, dec = 0) => currencyMode === 'KRW'
                ? (calcKrw(h) != null ? fmtKrw(calcKrw(h)!) : null)
                : (calcUsd(h) != null ? fmtUsd(calcUsd(h)!, dec) : null)

              return (
                <div
                  key={p.id}
                  style={{ display: 'grid', gridTemplateColumns: COL, gap: 8, padding: '12px 20px', alignItems: 'center', borderBottom: '1px solid var(--gpu-border)', transition: 'background 0.15s' }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--gpu-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                >
                  {/* 모델 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <GpuChip model={p.model_name} memory={p.memory} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#111827' }}>
                        {p.model_name}
                        {gpuCount > 1 && <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 400, marginLeft: 5 }}>×{gpuCount}GPU</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginTop: 1 }}>{p.memory} VRAM</div>
                    </div>
                  </div>

                  {/* Tier */}
                  <div style={{ textAlign: 'center' }}>
                    <span className="gpu-badge" style={{ background: tierConf.color, color: '#fff', fontSize: 10, padding: '2px 7px' }}>
                      {tierConf.label}
                    </span>
                  </div>

                  {/* /1시간 or /N시간 */}
                  <div style={{ textAlign: 'right' }}>
                    {price ? (
                      customHours ? (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gpu-accent)', fontFamily: 'monospace' }}>
                            {fmt(customHours, 0)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>
                            {currencyMode === 'KRW' ? fmtUsd(price.usd * customHours, 0) : fmtKrw(price.krw * customHours)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--gpu-accent)', fontFamily: 'monospace' }}>
                            {currencyMode === 'KRW' ? fmtKrw(price.krw) : fmtUsd(price.usd, 2)}
                          </div>
                          <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>
                            {currencyMode === 'KRW' ? fmtUsd(price.usd, 2) + '/hr' : fmtKrw(price.krw) + '/hr'}
                          </div>
                        </>
                      )
                    ) : <span style={{ fontSize: 12, color: 'var(--gpu-muted)' }}>준비 중</span>}
                  </div>

                  {/* /월 — 항상 표시 */}
                  <PriceCell value={fmt(HR_720)} sub="30일 · 720h" />

                  {/* /6개월 — 항상 표시 */}
                  <PriceCell value={fmt(HR_4320)} sub="180일 · 4,320h" />

                  {/* /연간 */}
                  <PriceCell value={fmt(HR_8760)} sub="365일 · 8,760h" green />
                </div>
              )
            })
          )}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gpu-muted)', textAlign: 'right' }}>
        * 부가세 별도 · 가격은 시장 상황에 따라 변동될 수 있습니다
      </div>
    </div>
  )
}

function PriceCell({ value, sub, green }: { value: string | null; sub: string; green?: boolean }) {
  if (!value) return <span style={{ color: 'var(--gpu-muted)', fontSize: 12 }}>—</span>
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: green ? '#059669' : '#374151', fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>{sub}</div>
    </div>
  )
}
