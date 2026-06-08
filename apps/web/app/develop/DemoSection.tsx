'use client'

import { useState, useCallback, useEffect } from 'react'

function useOrigin(fallback = '') {
  const [origin, setOrigin] = useState(fallback)
  useEffect(() => { setOrigin(window.location.origin) }, [])
  return origin
}

// ─── 타입 ────────────────────────────────────────────────────────────────────

interface Product {
  id: string
  model_name: string
  tier?: number
  memory?: string
  gpu_count?: number
  pricing_mode?: string
  price_per_unit_usd?: number
  price_per_unit_krw?: number
  supplier?: string
  available?: boolean
}

interface QuoteItem {
  model_name?: string
  quantity?: number
  unit_price_usd?: number
  unit_price_krw?: number
  total_usd?: number
  total_krw?: number
  margin_pct?: number
  available?: boolean
}

interface QuoteSummary {
  subtotal_usd?: number
  subtotal_krw?: number
  currency?: string
  total?: number
  fx_usd_krw?: number
  quoted_at?: string
}

interface InventoryItem {
  product_id?: string
  model_name?: string
  tier?: number
  memory?: string
  available_qty?: number
  in_stock?: boolean
  updated_at?: string
}

interface FxRate {
  rate_date?: string
  usd_krw?: number
  source?: string
}

interface Supplier {
  id?: string
  name?: string
  location?: string
  contact?: string
  active_quotes?: number
  last_received?: string
}

// ─── 결과 렌더러 ──────────────────────────────────────────────────────────────

function ProductsResult({ data }: { data: { data?: Product[]; meta?: { total?: number; fx_usd_krw?: number } } }) {
  const items = data?.data ?? []
  const meta = data?.meta
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>GPU 제품 목록</span>
        <div style={{ display: 'flex', gap: 12 }}>
          {meta?.total && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>총 {meta.total}개</span>}
          {meta?.fx_usd_krw && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>환율 {meta.fx_usd_krw.toLocaleString()}원/USD</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.slice(0, 10).map((p, i) => (
          <div key={p.id ?? i} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 120px 120px 70px', gap: 12, alignItems: 'center', padding: '12px 16px', background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 8, fontSize: 13 }}>
            <div>
              <span style={{ fontWeight: 600, color: 'var(--color-border)' }}>{p.model_name ?? '—'}</span>
              {p.memory && <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', background: '#1e293b', borderRadius: 4, color: 'var(--text-muted)' }}>{p.memory}</span>}
              {p.tier && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--brand)' }}>Tier {p.tier}</span>}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>{p.gpu_count ? `×${p.gpu_count}` : '—'}</div>
            <div style={{ color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>
              {p.price_per_unit_usd != null ? `$${p.price_per_unit_usd.toLocaleString()}` : '—'}
            </div>
            <div style={{ color: 'var(--text-faint)', fontFamily: 'monospace', fontSize: 12 }}>
              {p.price_per_unit_krw != null ? `₩${p.price_per_unit_krw.toLocaleString()}` : '—'}
            </div>
            <div>
              <span style={{ padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: p.available ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: p.available ? '#10b981' : '#ef4444' }}>
                {p.available ? '가용' : '품절'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {items.length > 10 && (
        <div style={{ textAlign: 'center', padding: '12px 0', color: '#475569', fontSize: 13 }}>
          + {items.length - 10}개 더 있습니다
        </div>
      )}
    </div>
  )
}

function QuoteResult({ data }: { data: { data?: { items?: QuoteItem[]; summary?: QuoteSummary } } }) {
  const items = data?.data?.items ?? []
  const summary = data?.data?.summary
  const currency = summary?.currency ?? 'USD'
  const isKRW = currency === 'KRW'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>견적서</span>
        {summary?.quoted_at && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {new Date(summary.quoted_at).toLocaleString('ko-KR')} 기준
          </span>
        )}
      </div>

      <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>제품</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>수량</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>단가</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>마진</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>소계</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>가용</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderTop: '1px solid #1e293b' }}>
                <td style={{ padding: '12px 16px', color: 'var(--color-border)', fontWeight: 500 }}>{item.model_name ?? '—'}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-faint)' }}>{item.quantity ?? 0}</td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-faint)', fontFamily: 'monospace' }}>
                  {isKRW && item.unit_price_krw != null ? `₩${item.unit_price_krw.toLocaleString()}` :
                   item.unit_price_usd != null ? `$${item.unit_price_usd.toLocaleString()}` : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#f59e0b' }}>
                  {item.margin_pct != null ? `${item.margin_pct}%` : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'right', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>
                  {isKRW && item.total_krw != null ? `₩${item.total_krw.toLocaleString()}` :
                   item.total_usd != null ? `$${item.total_usd.toLocaleString()}` : '—'}
                </td>
                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 100, background: item.available ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: item.available ? '#10b981' : '#ef4444' }}>
                    {item.available ? '가용' : '품절'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 10, padding: '16px 24px', minWidth: 260 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>
              <span>환율 적용</span>
              <span style={{ fontFamily: 'monospace' }}>1 USD = ₩{summary.fx_usd_krw?.toLocaleString() ?? '—'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: '1px solid #1e293b' }}>
              <span style={{ fontWeight: 700, color: 'var(--color-border)' }}>최종 합계</span>
              <span style={{ fontWeight: 700, color: '#10b981', fontSize: 18, fontFamily: 'monospace' }}>
                {isKRW ? `₩${(summary.total ?? 0).toLocaleString()}` : `$${(summary.subtotal_usd ?? 0).toLocaleString()}`}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function InventoryResult({ data }: { data: { data?: InventoryItem[]; meta?: { as_of?: string } } }) {
  const items = data?.data ?? []
  const maxQty = Math.max(...items.map(i => i.available_qty ?? 0), 1)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>재고 현황</span>
        {data?.meta?.as_of && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            기준: {new Date(data.meta.as_of).toLocaleString('ko-KR')}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((item, i) => {
          const pct = Math.round(((item.available_qty ?? 0) / maxQty) * 100)
          return (
            <div key={item.product_id ?? i} style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <span style={{ fontWeight: 600, color: 'var(--color-border)', fontSize: 13 }}>{item.model_name ?? '—'}</span>
                  {item.memory && <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', background: '#1e293b', borderRadius: 4, color: 'var(--text-muted)' }}>{item.memory}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-faint)' }}>{(item.available_qty ?? 0).toLocaleString()}개</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, fontWeight: 600, background: item.in_stock ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: item.in_stock ? '#10b981' : '#ef4444' }}>
                    {item.in_stock ? '가용' : '품절'}
                  </span>
                </div>
              </div>
              <div style={{ height: 6, background: '#1e293b', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: item.in_stock ? '#10b981' : '#ef4444', borderRadius: 100, transition: 'width .5s' }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function FxResult({ data }: { data: { data?: FxRate[]; meta?: { total?: number } } }) {
  const items = data?.data ?? []
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>USD/KRW 환율 이력</span>
      </div>
      <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>날짜</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>1 USD = KRW</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>변동</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: 12 }}>출처</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => {
              const prev = items[i + 1]
              const diff = prev?.usd_krw != null && r.usd_krw != null ? r.usd_krw - prev.usd_krw : null
              return (
                <tr key={r.rate_date ?? i} style={{ borderTop: '1px solid #1e293b' }}>
                  <td style={{ padding: '12px 16px', color: 'var(--color-border)', fontFamily: 'monospace' }}>{r.rate_date ?? '—'}</td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>
                    {r.usd_krw != null ? r.usd_krw.toLocaleString('ko-KR', { minimumFractionDigits: 1 }) : '—'}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 12 }}>
                    {diff != null ? (
                      <span style={{ color: diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : 'var(--text-muted)' }}>
                        {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                      </span>
                    ) : <span style={{ color: '#475569' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{r.source ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SuppliersResult({ data }: { data: { data?: Supplier[] } }) {
  const items = data?.data ?? []
  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>공급사 목록</span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>총 {items.length}개</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
        {items.map((s, i) => (
          <div key={s.id ?? i} style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 10, padding: '16px 18px' }}>
            <div style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 14, marginBottom: 4 }}>{s.name ?? '—'}</div>
            {s.location && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>📍 {s.location}</div>}
            {s.contact && <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 8 }}>✉️ {s.contact}</div>}
            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              {s.active_quotes != null && (
                <span style={{ padding: '2px 8px', background: 'rgba(124,58,237,0.1)', color: '#c4b5fd', borderRadius: 100 }}>
                  활성 견적 {s.active_quotes}건
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function GenericTableResult({ data, title }: { data: { data?: Record<string, unknown>[] }; title: string }) {
  const items = Array.isArray(data?.data) ? data.data : []
  if (!items.length) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>데이터 없음</div>
  const keys = Object.keys(items[0]).slice(0, 7)
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: 'var(--color-border)', fontSize: 15 }}>{title}</span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>총 {(data as { total?: number }).total ?? items.length}건</span>
      </div>
      <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#1e293b' }}>
              {keys.map(k => <th key={k} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 8).map((row, i) => (
              <tr key={i} style={{ borderTop: '1px solid #1e293b' }}>
                {keys.map(k => (
                  <td key={k} style={{ padding: '8px 12px', color: 'var(--text-faint)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(row[k] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function renderDemoResult(activeDemo: string, parsed: Record<string, unknown>) {
  if (!parsed.success) {
    return (
      <div style={{ padding: '16px 20px', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10 }}>
        <div style={{ color: '#ef4444', fontWeight: 600, marginBottom: 4 }}>오류</div>
        <div style={{ color: 'var(--text-faint)', fontSize: 13 }}>{String(parsed.error ?? 'Unknown error')}</div>
      </div>
    )
  }

  if (activeDemo.includes('제품')) return <ProductsResult data={parsed as Parameters<typeof ProductsResult>[0]['data']} />
  if (activeDemo.includes('견적')) return <QuoteResult data={parsed as Parameters<typeof QuoteResult>[0]['data']} />
  if (activeDemo.includes('재고')) return <InventoryResult data={parsed as Parameters<typeof InventoryResult>[0]['data']} />
  if (activeDemo.includes('환율')) return <FxResult data={parsed as Parameters<typeof FxResult>[0]['data']} />
  if (activeDemo.includes('공급사')) return <SuppliersResult data={parsed as Parameters<typeof SuppliersResult>[0]['data']} />
  if (activeDemo.includes('거래처')) return <GenericTableResult data={parsed as Parameters<typeof GenericTableResult>[0]['data']} title="거래처 목록" />
  if (activeDemo.includes('담당자')) return <GenericTableResult data={parsed as Parameters<typeof GenericTableResult>[0]['data']} title="담당자 목록" />
  if (activeDemo.includes('영업기회')) return <GenericTableResult data={parsed as Parameters<typeof GenericTableResult>[0]['data']} title="영업기회 목록" />

  return (
    <pre style={{ margin: 0, fontSize: 12, color: 'var(--color-border)', overflowX: 'auto' }}>
      {JSON.stringify(parsed, null, 2)}
    </pre>
  )
}

// ─── 메인 데모 섹션 ───────────────────────────────────────────────────────────

interface Demo {
  label: string
  emoji: string
  desc: string
  method: string
  endpoint: string
  fn: () => Promise<Response>
}

export default function DemoSection() {
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeDemo, setActiveDemo] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const origin = useOrigin('')

  const run = useCallback(async (label: string, fn: () => Promise<Response>) => {
    if (!apiKey.trim()) { setResult({ success: false, error: 'API 키를 입력해주세요' }); setActiveDemo(label); return }
    setLoading(true); setActiveDemo(label); setResult(null); setShowRaw(false)
    try {
      const res = await fn()
      const json = await res.json()
      setResult(json)
    } catch (e) {
      setResult({ success: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setLoading(false)
    }
  }, [apiKey, origin])

  const demos: Demo[] = [
    {
      label: '제품 목록 조회',
      emoji: '📦',
      desc: '전체 GPU 카탈로그 + 실시간 가격',
      method: 'GET',
      endpoint: '/products',
      fn: () => fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '재고 현황',
      emoji: '🏭',
      desc: '가용 재고 수량 실시간 조회',
      method: 'GET',
      endpoint: '/inventory',
      fn: () => fetch(`${origin}/api/public/v1/inventory`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '견적 계산 (A100 × 4)',
      emoji: '🧮',
      desc: 'A100 40GB 4장 기본 마진 견적',
      method: 'POST',
      endpoint: '/quote',
      fn: async () => {
        const pr = await fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } })
        const pd = await pr.json()
        const a100 = (pd.data ?? []).find((p: Product) => p.model_name?.includes('A100'))
        if (!a100) return new Response(JSON.stringify({ success: false, error: 'A100 제품을 찾을 수 없습니다' }))
        return fetch(`${origin}/api/public/v1/quote`, {
          method: 'POST',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: [{ product_id: a100.id, quantity: 4 }], currency: 'KRW' }),
        })
      },
    },
    {
      label: '마진 20% 견적',
      emoji: '💰',
      desc: '커스텀 마진 20% 적용 USD 견적',
      method: 'POST',
      endpoint: '/quote',
      fn: async () => {
        const pr = await fetch(`${origin}/api/public/v1/products`, { headers: { 'X-API-Key': apiKey } })
        const pd = await pr.json()
        const available = (pd.data ?? []).filter((p: Product) => p.available).slice(0, 2)
        if (!available.length) return new Response(JSON.stringify({ success: false, error: '가용 제품 없음' }))
        return fetch(`${origin}/api/public/v1/quote`, {
          method: 'POST',
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: available.map((p: Product) => ({ product_id: p.id, quantity: 2, custom_margin_pct: 20 })), currency: 'USD' }),
        })
      },
    },
    {
      label: '환율 이력',
      emoji: '💱',
      desc: '최근 7일 USD/KRW 환율',
      method: 'GET',
      endpoint: '/fx',
      fn: () => fetch(`${origin}/api/public/v1/fx`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '공급사 목록',
      emoji: '🏢',
      desc: '등록된 GPU 공급사 조회',
      method: 'GET',
      endpoint: '/suppliers',
      fn: () => fetch(`${origin}/api/public/v1/suppliers`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '거래처 목록',
      emoji: '🏦',
      desc: 'CRM 거래처 데이터',
      method: 'GET',
      endpoint: '/accounts',
      fn: () => fetch(`${origin}/api/public/v1/accounts`, { headers: { 'X-API-Key': apiKey } }),
    },
    {
      label: '영업기회 목록',
      emoji: '📊',
      desc: '진행 중인 영업기회 조회',
      method: 'GET',
      endpoint: '/deals',
      fn: () => fetch(`${origin}/api/public/v1/deals`, { headers: { 'X-API-Key': apiKey } }),
    },
  ]

  const methodColors: Record<string, string> = { GET: '#10b981', POST: 'var(--brand)' }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: 13, color: 'var(--brand)', fontWeight: 600, marginBottom: 8 }}>🧪 인터랙티브 데모</div>
        <h1 style={{ fontSize: 32, fontWeight: 800, color: 'var(--surface-muted)', marginBottom: 12, letterSpacing: '-0.02em' }}>라이브 API 테스트</h1>
        <p style={{ color: 'var(--text-faint)', lineHeight: 1.7, fontSize: 15, marginBottom: 0 }}>
          실제 API 키를 입력하고 버튼을 누르면 라이브 데이터가 아래에 구조화된 UI로 표시됩니다.
          JSON 원문을 보려면 결과 우측 상단의 <strong style={{ color: 'var(--color-border)' }}>JSON 보기</strong>를 클릭하세요.
        </p>
      </div>

      {/* API Key 입력 */}
      <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 12, padding: '20px 24px', marginBottom: 28 }}>
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 8 }}>
          API Key <span style={{ color: '#ef4444' }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="password"
            placeholder="ax_live_..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{ flex: 1, padding: '10px 14px', borderRadius: 8, border: '1px solid #334155', background: '#1e293b', color: 'var(--color-border)', fontSize: 14, outline: 'none', fontFamily: 'monospace' }}
          />
          <a href="/api-keys" style={{ padding: '10px 16px', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#c4b5fd', fontSize: 13, fontWeight: 500, textDecoration: 'none', border: '1px solid rgba(124,58,237,0.2)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
            키 발급 →
          </a>
        </div>
        <p style={{ fontSize: 12, color: '#475569', margin: '8px 0 0' }}>
          입력한 키는 이 브라우저에서만 사용됩니다. 서버에 저장되지 않습니다.
        </p>
      </div>

      {/* 데모 버튼 그리드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
        {demos.map(({ label, emoji, desc, method, endpoint }) => {
          const isActive = activeDemo === label
          return (
            <button
              key={label}
              onClick={() => run(label, demos.find(d => d.label === label)!.fn)}
              disabled={loading && isActive}
              style={{
                padding: '14px 16px', borderRadius: 10, border: `1px solid ${isActive ? 'var(--brand)' : '#1e293b'}`,
                background: isActive ? 'rgba(124,58,237,0.08)' : 'var(--text)',
                color: 'var(--color-border)', cursor: loading && isActive ? 'wait' : 'pointer',
                textAlign: 'left', transition: 'all .15s',
              }}
            >
              <div style={{ fontSize: 20, marginBottom: 6 }}>{loading && isActive ? '⏳' : emoji}</div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 8 }}>{desc}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: (methodColors[method] ?? 'var(--text-muted)') + '22', color: methodColors[method] ?? 'var(--text-muted)', fontWeight: 700, fontFamily: 'monospace' }}>{method}</span>
                <code style={{ fontSize: 10, color: '#475569' }}>{endpoint}</code>
              </div>
            </button>
          )
        })}
      </div>

      {/* 결과 */}
      {result !== null && (
        <div style={{ background: 'var(--text)', border: '1px solid #1e293b', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 20px', background: '#1e293b', borderBottom: '1px solid var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: result.success ? '#10b981' : '#ef4444', display: 'inline-block' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-faint)' }}>{activeDemo}</span>
              {result.success === true && <span style={{ fontSize: 11, color: '#10b981', background: 'rgba(16,185,129,0.1)', padding: '2px 7px', borderRadius: 100 }}>200 OK</span>}
              {!result.success && <span style={{ fontSize: 11, color: '#ef4444', background: 'rgba(239,68,68,0.1)', padding: '2px 7px', borderRadius: 100 }}>오류</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowRaw(v => !v)} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #334155', background: showRaw ? '#334155' : 'var(--text)', color: 'var(--text-faint)', fontSize: 12, cursor: 'pointer' }}>
                {showRaw ? 'UI 보기' : 'JSON 보기'}
              </button>
              <button onClick={() => { try { navigator.clipboard.writeText(JSON.stringify(result, null, 2)) } catch {} }} style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid #334155', background: 'var(--text)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>
                복사
              </button>
            </div>
          </div>
          <div style={{ padding: '20px 24px', maxHeight: 560, overflowY: 'auto' }}>
            {showRaw ? (
              <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--color-border)', overflowX: 'auto' }}>
                {JSON.stringify(result, null, 2)}
              </pre>
            ) : (
              activeDemo && renderDemoResult(activeDemo, result)
            )}
          </div>
        </div>
      )}
    </div>
  )
}
