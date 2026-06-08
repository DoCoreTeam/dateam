'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { formatSpec } from '@/lib/gpu/format-spec'
import { buildTierModelGroups, tierKey, modelKey } from '@/lib/gpu/group'
import { TierHeader, ModelHeader } from '@/components/gpu/CategoryGroup'
import { useCollapsibleGroups } from '@/hooks/useCollapsibleGroups'

interface GpuProduct {
  id: string
  model_name: string
  memory: string
  tier: 1 | 2 | 3
  gpu_count: number
  vcpu?: number | null
  ram_gb?: number | null
  storage_gb?: number | null
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

const TIER_INFO = {
  1: { label: 'Tier 1', desc: '전용 고성능·보장형', color: 'var(--text)' },
  2: { label: 'Tier 2', desc: '점유형(예약 단독)·보장형', color: 'var(--info)' },
  3: { label: 'Tier 3', desc: '간헐 공급(중단/재개)·최저가', color: 'var(--warning)' },
}

const GPU_ICONS: Record<string, string> = {
  H: 'var(--text)', A: 'var(--text)', B: 'var(--text)', R: 'var(--text)',
}

function GpuChip({ model, memory }: { model: string; memory: string }) {
  const bg = GPU_ICONS[(model ?? '')[0]?.toUpperCase() ?? ''] ?? 'var(--text)'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 36, height: 36, borderRadius: 8, background: bg,
      color: '#fff', fontSize: 11, fontWeight: 700, flexShrink: 0,
      fontFamily: 'monospace', lineHeight: 1,
    }}>
      <span style={{ fontSize: 9 }}>{(memory ?? '').replace('GB', '')}</span>
      <span style={{ fontSize: 7, opacity: 0.7 }}>GB</span>
    </span>
  )
}

const HR_720 = 24 * 30
const HR_4320 = 24 * 180
const HR_8760 = 24 * 365

export default function SalePriceCatalogPage() {
  const { data, isLoading, mutate } = useSWR<ProductsResponse>('/api/pricing/gpu/products', fetcher, {
    refreshInterval: 60000,
  })
  // 직접 판매가 설정/해제 (CRUD) — 행 복사 UX와 충돌 없도록 stopPropagation
  const setDirectPrice = async (e: React.MouseEvent, p: GpuProduct) => {
    e.stopPropagation()
    const cur = p.pricing_mode === 'direct' && p.sell_price_krw ? String(p.sell_price_krw) : ''
    const input = window.prompt(`${p.model_name} ×${p.gpu_count ?? 1} 직접 판매가(원/시간). 비우면 해제:`, cur)
    if (input === null) return
    try {
      if (input.trim() === '') {
        const res = await fetch(`/api/pricing/gpu/direct-prices?product_id=${p.id}`, { method: 'DELETE' })
        if (!res.ok) { alert('해제 실패'); return }
      } else {
        const v = Number(input.replace(/[^0-9.]/g, ''))
        if (!v || v <= 0) { alert('유효한 금액을 입력하세요'); return }
        const res = await fetch('/api/pricing/gpu/direct-prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: p.id, sell_price_krw: v }) })
        if (!res.ok) { alert('설정 실패'); return }
      }
      mutate()
    } catch { alert('처리 실패') }
  }
  const [tierFilter, setTierFilter] = useState<0 | 1 | 2 | 3>(0)
  const [currencyMode, setCurrencyMode] = useState<'KRW' | 'USD'>('KRW')
  const [search, setSearch] = useState('')
  const [hoursInput, setHoursInput] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

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

  const handleRowClick = (p: GpuProduct) => {
    const price = getSellPrice(p)
    if (!price) return
    const lines = [
      `[GPU 판매가격표]`,
      `${p.model_name} ${p.memory} (Tier ${p.tier})`,
      `시간당: ${fmtKrw(price.krw)} / ${fmtUsd(price.usd, 2)}`,
      `월 (720h): ${fmtKrw(price.krw * HR_720)}`,
      `6개월 (4,320h): ${fmtKrw(price.krw * HR_4320)}`,
      `연간 (8,760h): ${fmtKrw(price.krw * HR_8760)}`,
    ]
    const text = lines.join('\n')
    setCopiedId(p.id)
    setTimeout(() => setCopiedId(null), 2000)
    navigator.clipboard?.writeText(text).catch(() => {
      // fallback for non-secure context
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch (_) {}
    })
  }

  // 판매가(sell_price_krw)가 있는 모든 상품 — 원가 견적(cost), 직접입력(direct),
  // gcube 공시가 패스스루(list) 모두 포함
  const pricedProducts = products.filter((p) => p.sell_price_krw != null)

  const filtered = pricedProducts.filter((p) => {
    if (tierFilter !== 0 && p.tier !== tierFilter) return false
    if (search) {
      const q = search.toLowerCase()
      return (p.model_name ?? '').toLowerCase().includes(q) || (p.memory ?? '').toLowerCase().includes(q)
    }
    return true
  })

  // Tier→모델 2단계 그룹 (4개 메뉴 공용 구조)
  const tierGroups = buildTierModelGroups(filtered)
  const allKeys = pricedProducts.flatMap((p) => [tierKey(p.tier), modelKey(p.tier, p.model_name)])
  const { isCollapsed, toggle } = useCollapsibleGroups(allKeys, true, [tierKey(1)])
  const searching = search.trim().length > 0
  const collapsedOf = (key: string) => (searching ? false : isCollapsed(key))

  const fmtKrw = (v: number) => `₩${Math.round(v).toLocaleString('ko-KR')}`
  const fmtUsd = (v: number, dec = 0) => `$${v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
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
        <label style={{
          display: 'flex', alignItems: 'center', gap: 0,
          border: `1.5px solid ${customHours ? 'var(--gpu-accent)' : 'var(--border-subtle)'}`,
          borderRadius: 8,
          background: '#fff',
          height: 34,
          boxShadow: customHours ? '0 0 0 3px rgba(124,58,237,0.12)' : '0 1px 2px rgba(0,0,0,0.05)',
          cursor: 'text',
          overflow: 'hidden',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}>
          <span style={{
            padding: '0 8px 0 10px',
            fontSize: 11, fontWeight: 700,
            color: customHours ? 'var(--gpu-accent)' : 'var(--text-muted)',
            whiteSpace: 'nowrap',
            userSelect: 'none',
            letterSpacing: '0.02em',
          }}>
            시간 계산
          </span>
          <div style={{ width: 1, height: 16, background: customHours ? 'rgba(124,58,237,0.3)' : 'var(--color-border)' }} />
          <input
            type="number"
            min="1"
            max="99999"
            placeholder="0"
            value={hoursInput}
            onChange={(e) => setHoursInput(e.target.value)}
            style={{
              width: 64, border: 'none', outline: 'none', background: 'transparent',
              fontSize: 13, padding: '0 6px',
              color: customHours ? 'var(--gpu-accent)' : 'var(--text)',
              fontWeight: customHours ? 700 : 500,
              fontFamily: 'monospace',
            }}
          />
          {customHours ? (
            <>
              <span style={{ fontSize: 11, color: 'var(--gpu-accent)', fontWeight: 600, paddingRight: 4 }}>h</span>
              <button
                onClick={() => setHoursInput('')}
                style={{ border: 'none', background: 'rgba(124,58,237,0.1)', cursor: 'pointer', color: 'var(--gpu-accent)', fontSize: 11, padding: '0 8px', height: '100%', fontWeight: 700 }}
              >✕</button>
            </>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-faint)', paddingRight: 10 }}>h</span>
          )}
        </label>
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
            background: 'var(--gpu-surface)', border: `var(--hairline) solid var(--gpu-border)`,
            borderLeft: `var(--border-w) solid ${TIER_INFO[t].color}`, fontSize: 11, color: 'var(--gpu-muted)',
          }}>
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>Tier {t}</span>
          </div>
        ))}
      </div>

      {/* 가격표 */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--gpu-muted)' }}>로딩 중...</div>
      ) : (
        <div style={{ background: 'var(--gpu-surface)', borderRadius: 12, border: 'var(--hairline) solid var(--gpu-border)', overflow: 'hidden' }}>
          {/* 헤더 행 */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, gap: 8, padding: '10px 20px', background: 'var(--gpu-bg)', borderBottom: 'var(--hairline) solid var(--gpu-border)' }}>
            <div style={{ ...thBase }}>GPU 모델</div>
            <div style={{ ...thBase, textAlign: 'center' }}>구분</div>
            <div style={{ ...thBase, textAlign: 'right', color: customHours ? 'var(--gpu-accent)' : 'var(--gpu-muted)' }}>
              {customHours ? <>/ {customHours.toLocaleString()}<span style={{ fontWeight: 400, opacity: 0.8 }}>시간</span></> : '/ 1시간'}
            </div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 월 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_720)})</span></div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 6개월 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_4320)})</span></div>
            <div style={{ ...thBase, textAlign: 'right' }}>/ 연간 <span style={{ fontWeight: 400, opacity: 0.7 }}>({fmtHours(HR_8760)})</span></div>
          </div>

          {/* 데이터 행 — Tier → 모델 2단계 그룹 (4개 메뉴 공용) */}
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--gpu-muted)', fontSize: 13 }}>
              {search ? `"${search}"에 해당하는 모델이 없습니다` : '등록된 가격이 없습니다'}
            </div>
          ) : (
            tierGroups.flatMap((tg) => {
              const tC = collapsedOf(tierKey(tg.tier))
              const tierHeaderEl = (
                <div key={`t${tg.tier}`} style={{ padding: '6px 14px', borderBottom: 'var(--hairline) solid var(--gpu-border)' }}>
                  <TierHeader tier={tg.tier} modelCount={tg.count} itemCount={tg.itemCount} collapsed={tC} onToggle={() => toggle(tierKey(tg.tier))} />
                </div>
              )
              if (tC) return [tierHeaderEl]
              const modelEls = tg.models.flatMap((mg) => {
                const mC = collapsedOf(modelKey(tg.tier, mg.model))
                const modelHeaderEl = (
                  <div key={`m${tg.tier}-${mg.model}`} style={{ padding: '4px 14px 4px 22px', borderBottom: 'var(--hairline) solid var(--gpu-border)' }}>
                    <ModelHeader tier={tg.tier} model={mg.model} itemCount={mg.items.length} collapsed={mC} onToggle={() => toggle(modelKey(tg.tier, mg.model))} />
                  </div>
                )
                if (mC) return [modelHeaderEl]
                return [modelHeaderEl, ...mg.items.map((p) => renderRow(p))]
              })
              return [tierHeaderEl, ...modelEls]
            })
          )}
        </div>
      )}

      <div style={{ marginTop: 12, fontSize: 11, color: 'var(--gpu-muted)', textAlign: 'right' }}>
        * 부가세 별도 · 가격은 시장 상황에 따라 변동될 수 있습니다
      </div>
    </div>
  )

  function renderRow(p: GpuProduct) {
              const price = getSellPrice(p)
              const tierConf = TIER_INFO[p.tier]
              const gpuCount = p.gpu_count ?? 1

              const calcKrw = (h: number) => price ? Math.round(price.krw * h) : null
              const calcUsd = (h: number) => price ? price.usd * h : null

              const fmt = (h: number, dec = 0) => currencyMode === 'KRW'
                ? (calcKrw(h) != null ? fmtKrw(calcKrw(h)!) : null)
                : (calcUsd(h) != null ? fmtUsd(calcUsd(h)!, dec) : null)

              const isCopied = copiedId === p.id
              return (
                <div
                  key={p.id}
                  style={{ display: 'grid', gridTemplateColumns: COL, gap: 8, padding: '12px 20px', alignItems: 'center', borderBottom: 'var(--hairline) solid var(--gpu-border)', transition: 'background 0.15s', cursor: price ? 'pointer' : 'default', position: 'relative' }}
                  title={price ? '클릭하면 가격 복사' : undefined}
                  onClick={() => handleRowClick(p)}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--gpu-hover)' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isCopied ? 'var(--success-bg)' : '' }}
                >
                  {isCopied && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                      background: 'rgba(240,253,244,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      borderRadius: 0, fontSize: 13, fontWeight: 700, color: 'var(--success)', pointerEvents: 'none', zIndex: 2,
                    }}>
                      ✓ 클립보드에 복사됨
                    </div>
                  )}
                  {/* 모델 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <GpuChip model={p.model_name} memory={p.memory} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        {p.model_name}
                        <span style={{ fontSize: 11, color: 'var(--gpu-muted)', fontWeight: 400 }}>×{gpuCount}GPU</span>
                        {p.pricing_mode === 'direct' && <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--gpu-amber)', background: 'var(--warning-bg)', border: 'var(--hairline) solid var(--warning-border)', borderRadius: 4, padding: '0 5px' }}>직접가</span>}
                        <button onClick={(e) => setDirectPrice(e, p)} title="직접 판매가 설정/해제" aria-label="직접 판매가 설정"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--gpu-faint)', fontSize: 11, padding: '0 2px' }}>✎</button>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--gpu-muted)', marginTop: 1 }}>{formatSpec(p)}</div>
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
  }
}

function PriceCell({ value, sub, green }: { value: string | null; sub: string; green?: boolean }) {
  if (!value) return <span style={{ color: 'var(--gpu-muted)', fontSize: 12 }}>—</span>
  return (
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: green ? 'var(--success)' : 'var(--text)', fontFamily: 'monospace' }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>{sub}</div>
    </div>
  )
}
