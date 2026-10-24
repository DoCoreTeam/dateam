'use client'

import { useState, useCallback, useEffect } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import NbBadge from '@/components/ui/nb/NbBadge'
import type { StatusKey } from '@/lib/tokens/status-colors'
import {
  API_GROUPS, DEMO_ENDPOINTS, REQUIRES_LABEL,
  type ApiDemo, type ApiEndpoint,
} from '@/lib/api-docs/registry'
import {
  COPY_FEEDBACK_MS, DEMO, blockedDemoOutcome, demoStatusBadge, describeDemoFailure, interpretDemoResponse,
  type DemoOutcome,
} from '@/lib/terms/dev-demo'

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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>GPU 제품 목록</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          {meta?.total != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>총 {meta.total}개</span>}
          {meta?.fx_usd_krw != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>환율 {meta.fx_usd_krw.toLocaleString()}원/USD</span>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.slice(0, 10).map((p, i) => (
          <div key={p.id ?? i} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 12px', alignItems: 'center', padding: '12px 16px', background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 8, fontSize: 13 }}>
            <div style={{ flex: '1 1 160px', ...TEXT_WRAP }}>
              <span style={{ fontWeight: 600, color: 'var(--text)' }}>{p.model_name ?? DEMO.empty}</span>
              {p.memory && <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', background: 'var(--surface-muted)', borderRadius: 4, color: 'var(--text-muted)' }}>{p.memory}</span>}
              {p.tier != null && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--brand)' }}>Tier {p.tier}</span>}
            </div>
            {p.gpu_count != null && p.gpu_count > 0 && <div style={{ color: 'var(--text-muted)' }}>{`×${p.gpu_count}`}</div>}
            <div style={{ color: 'var(--success)', fontFamily: 'monospace', fontWeight: 600, ...TEXT_WRAP }}>
              {p.price_per_unit_usd != null ? `$${p.price_per_unit_usd.toLocaleString()}` : DEMO.empty}
            </div>
            <div style={{ color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: 12, ...TEXT_WRAP }}>
              {p.price_per_unit_krw != null ? `₩${p.price_per_unit_krw.toLocaleString()}` : DEMO.empty}
            </div>
            <div>
              <span style={{ padding: '3px 8px', borderRadius: 100, fontSize: 11, fontWeight: 600, background: p.available ? 'var(--success-bg)' : 'var(--danger-bg)', color: p.available ? 'var(--success)' : 'var(--danger)' }}>
                {p.available ? '가용' : '품절'}
              </span>
            </div>
          </div>
        ))}
      </div>
      {items.length > 10 && (
        <div style={{ textAlign: 'center', padding: '12px 0', color: 'var(--text-muted)', fontSize: 13 }}>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>견적서</span>
        {summary?.quoted_at && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {new Date(summary.quoted_at).toLocaleString('ko-KR')} 기준
          </span>
        )}
      </div>

      <div style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
        <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>제품</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>수량</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>단가</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>마진</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>소계</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>가용</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderTop: 'var(--hairline) solid var(--border-light)' }}>
                <td className="card-header" style={{ padding: '12px 16px', color: 'var(--text)', fontWeight: 500, ...TEXT_WRAP }}>{item.model_name ?? DEMO.empty}</td>
                <td data-label="수량" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>{item.quantity ?? 0}</td>
                <td data-label="단가" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {isKRW && item.unit_price_krw != null ? `₩${item.unit_price_krw.toLocaleString()}` :
                   item.unit_price_usd != null ? `$${item.unit_price_usd.toLocaleString()}` : DEMO.empty}
                </td>
                <td data-label="마진" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--warning)' }}>
                  {item.margin_pct != null ? `${item.margin_pct}%` : DEMO.empty}
                </td>
                <td data-label="소계" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--success)', fontFamily: 'monospace', fontWeight: 600 }}>
                  {isKRW && item.total_krw != null ? `₩${item.total_krw.toLocaleString()}` :
                   item.total_usd != null ? `$${item.total_usd.toLocaleString()}` : DEMO.empty}
                </td>
                <td data-label="가용" style={{ padding: '12px 16px', textAlign: 'center' }}>
                  <span style={{ fontSize: 'var(--fs-2xs)', padding: '2px 7px', borderRadius: 100, background: item.available ? 'var(--success-bg)' : 'var(--danger-bg)', color: item.available ? 'var(--success)' : 'var(--danger)' }}>
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
          <div style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 10, padding: '16px 24px', width: 'min(260px, 100%)', maxWidth: '100%', boxSizing: 'border-box' }}>
            {summary.fx_usd_krw != null && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                <span>환율 적용</span>
                <span style={{ fontFamily: 'monospace', ...TEXT_WRAP }}>1 USD = ₩{summary.fx_usd_krw.toLocaleString()}</span>
              </div>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', paddingTop: 10, borderTop: 'var(--hairline) solid var(--border-light)' }}>
              <span style={{ fontWeight: 700, color: 'var(--text)' }}>최종 합계</span>
              <span style={{ fontWeight: 700, color: 'var(--success)', fontSize: 18, fontFamily: 'monospace', ...TEXT_WRAP }}>
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
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>재고 현황</span>
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
            <div key={item.product_id ?? i} style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 8, padding: '12px 16px' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={TEXT_WRAP}>
                  <span style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{item.model_name ?? DEMO.empty}</span>
                  {item.memory && <span style={{ marginLeft: 8, fontSize: 11, padding: '1px 6px', background: 'var(--surface-muted)', borderRadius: 4, color: 'var(--text-muted)' }}>{item.memory}</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{(item.available_qty ?? 0).toLocaleString()}개</span>
                  <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, fontWeight: 600, background: item.in_stock ? 'var(--success-bg)' : 'var(--danger-bg)', color: item.in_stock ? 'var(--success)' : 'var(--danger)' }}>
                    {item.in_stock ? '가용' : '품절'}
                  </span>
                </div>
              </div>
              <div style={{ height: 6, background: 'var(--surface-muted)', borderRadius: 100, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: item.in_stock ? 'var(--success)' : 'var(--danger)', borderRadius: 100, transition: 'width .5s' }} />
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
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>USD/KRW 환율 이력</span>
      </div>
      <div style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 10, overflow: 'hidden' }}>
        <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sm)' }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)' }}>
              <th style={{ padding: '10px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>날짜</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>1 USD = KRW</th>
              <th style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>변동</th>
              <th style={{ padding: '10px 16px', textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: 'var(--fs-xs)' }}>출처</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => {
              const prev = items[i + 1]
              const diff = prev?.usd_krw != null && r.usd_krw != null ? r.usd_krw - prev.usd_krw : null
              return (
                <tr key={r.rate_date ?? i} style={{ borderTop: 'var(--hairline) solid var(--border-light)' }}>
                  <td className="card-header" style={{ padding: '12px 16px', color: 'var(--text)', fontFamily: 'monospace' }}>{r.rate_date ?? DEMO.empty}</td>
                  <td data-label="1 USD = KRW" style={{ padding: '12px 16px', textAlign: 'right', color: 'var(--success)', fontFamily: 'monospace', fontWeight: 600 }}>
                    {r.usd_krw != null ? r.usd_krw.toLocaleString('ko-KR', { minimumFractionDigits: 1 }) : DEMO.empty}
                  </td>
                  <td data-label="변동" style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 'var(--fs-xs)' }}>
                    {diff != null ? (
                      <span style={{ color: diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                        {diff > 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)}
                      </span>
                    ) : <span style={{ color: 'var(--text-muted)' }}>{DEMO.empty}</span>}
                  </td>
                  <td data-label="출처" style={{ padding: '12px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', ...TEXT_WRAP }}>{r.source ?? DEMO.empty}</td>
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
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>공급사 목록</span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>총 {items.length}개</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))', gap: 10 }}>
        {items.map((s, i) => (
          <div key={s.id ?? i} style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 10, padding: '16px 18px', ...TEXT_WRAP }}>
            <div style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14, marginBottom: 4 }}>{s.name ?? DEMO.empty}</div>
            {s.location && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{s.location}</div>}
            {s.contact && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>{s.contact}</div>}
            <div style={{ display: 'flex', gap: 10, fontSize: 12 }}>
              {s.active_quotes != null && (
                <span style={{ padding: '2px 8px', background: 'var(--brand-soft)', color: 'var(--brand)', borderRadius: 100 }}>
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
  if (!items.length) return <EmptyState title={DEMO.emptyResult} description={DEMO.emptyResultHint} />
  const keys = Object.keys(items[0]).slice(0, 7)
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>{title}</span>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>총 {(data as { meta?: { total?: number }; total?: number }).meta?.total
            ?? (data as { total?: number }).total ?? items.length}건</span>
      </div>
      <div style={{ background: 'var(--color-surface)', border: 'var(--hairline) solid var(--border-light)', borderRadius: 10, overflow: 'hidden' }}>
        <table className="table-base table-card" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-xs)' }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)' }}>
              {keys.map(k => <th key={k} style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.slice(0, 8).map((row, i) => (
              <tr key={i} style={{ borderTop: 'var(--hairline) solid var(--border-light)' }}>
                {keys.map((k, ki) => (
                  // 첫 칸이 카드 제목, 나머지는 모바일에서 키를 레이블로 단다(가로 스크롤 대체)
                  <td key={k} className={ki === 0 ? 'card-header' : undefined} data-label={ki === 0 ? undefined : k}
                    style={{ padding: '8px 12px', color: 'var(--text-muted)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(row[k] ?? DEMO.empty)}
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

/**
 * 결과 렌더러, **분기는 엔드포인트 id 로 한다.**
 *
 * 예전엔 화면에 뜬 한글 라벨의 부분문자열로 골랐다. 라벨을 한 글자만 다듬어도
 * 조용히 raw JSON 으로 떨어지는데 화면은 아무 말도 하지 않는다.
 * id 는 registry 의 안정 식별자라 문구를 바꿔도 안 깨진다.
 */
function renderDemoResult(e: ApiEndpoint, outcome: DemoOutcome) {
  const parsed = outcome.body
  if (outcome.failure || !parsed || parsed.success !== true) {
    const message = outcome.failure?.message
      ?? (typeof parsed?.error === 'string' && parsed.error ? parsed.error : DEMO.failedDefault)
    return <ErrorState message={message} helpHref="/api-keys" helpLabel={DEMO.keyHelp} />
  }

  switch (e.id) {
    case 'gpu.products.list':
      return <ProductsResult data={parsed as Parameters<typeof ProductsResult>[0]['data']} />
    case 'gpu.quote.create':
      return <QuoteResult data={parsed as Parameters<typeof QuoteResult>[0]['data']} />
    case 'gpu.inventory.list':
      return <InventoryResult data={parsed as Parameters<typeof InventoryResult>[0]['data']} />
    case 'gpu.fx.list':
      return <FxResult data={parsed as Parameters<typeof FxResult>[0]['data']} />
    case 'gpu.suppliers.list':
      return <SuppliersResult data={parsed as Parameters<typeof SuppliersResult>[0]['data']} />
    default:
      // 목록은 전부 같은 봉투를 쓴다, 표 하나로 그리고 제목은 registry 에서 온다
      return <GenericTableResult data={parsed as Parameters<typeof GenericTableResult>[0]['data']} title={e.title} />
  }
}

// ─── 메인 데모 섹션 ───────────────────────────────────────────────────────

/** HTTP 메서드 → 뱃지 의미색. 색맵을 화면에서 만들지 않는다(NbBadge SSOT) */
const METHOD_STATUS: Record<string, StatusKey> = { GET: 'done', POST: 'planned', PATCH: 'note', PUT: 'note', DELETE: 'blocker' }

/**
 * 앞선 응답에서 값을 꺼내 와야 하는 요청, registry 가 **이름으로** 가리킨 것을 여기서 푼다.
 * 표는 순수 데이터라야 한다(서버의 openapi 라우트도 그 파일을 읽는다). 함수는 화면 몫이다.
 */
async function resolveNeeds(
  need: NonNullable<ApiDemo['needs']>,
  base: string,
  apiKey: string,
): Promise<{ extra: Record<string, unknown> } | { outcome: DemoOutcome }> {
  if (need === 'gpu-product-id') {
    const res = await fetch(`${base}/products`, { headers: { 'X-API-Key': apiKey } })
    // 앞 단계가 실패하면 본문을 뒤지기 전에 그 상태를 그대로 보인다 (틀린 키가 「GPU 구성 없음」으로 둔갑하지 않게)
    const first = await readOutcome(res)
    if (first.failure) return { outcome: first }
    const rows = Array.isArray(first.body?.data) ? (first.body.data as { id?: string; available?: boolean }[]) : []
    const pick = rows.find((r) => r.available) ?? rows[0]
    if (!pick?.id) return { outcome: blockedDemoOutcome(DEMO.noProduct) }
    return { extra: { product_id: pick.id } }
  }
  return { extra: {} }
}

/** 응답을 글로 읽고 판정한다. JSON 이 아니어도 던지지 않는다 */
async function readOutcome(res: Response): Promise<DemoOutcome> {
  const text = await res.text().catch(() => '')
  return interpretDemoResponse(res.status, text, res.headers.get('Retry-After'))
}

/** 좁은 화면에서 긴 값이 카드를 밀어내지 않게 */
const TEXT_WRAP = { overflowWrap: 'anywhere', minWidth: 0 } as const

type CopyState = 'idle' | 'copied' | 'failed'

/**
 * 헤더에 실을 수 있는 키인가, **부르기 전에 본다.**
 *
 * 실측 v0.7.622: 한글이 섞인 키를 넣고 누르면 브라우저가
 * 「Failed to read the 'headers' property from 'RequestInit': String contains
 * non ISO-8859-1 code point」를 던지고, 그 원문이 그대로 화면에 나갔다.
 * 사용자가 고칠 수 있는 말이 아니다, 무엇이 잘못됐는지 우리가 말해야 한다.
 */
function keyProblem(key: string): string | null {
  if (!/^[\x21-\x7E]+$/.test(key)) return '키에 쓸 수 없는 문자가 있습니다. 발급받은 키를 그대로 붙여넣어 주세요.'
  if (!key.startsWith('ax_live_')) return '키 형식이 다릅니다. ax_live_ 로 시작하는 키를 붙여넣어 주세요.'
  return null
}

/** 고정 본문의 items 에 앞 단계에서 얻은 값을 채워 넣는다 */
function fillBody(body: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
  if (!Object.keys(extra).length) return body
  const items = Array.isArray(body.items) ? body.items : null
  if (!items) return { ...body, ...extra }
  return { ...body, items: items.map((it) => ({ ...(it as Record<string, unknown>), ...extra })) }
}

export default function DemoSection() {
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<DemoOutcome | null>(null)
  const [copyState, setCopyState] = useState<CopyState>('idle')
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const origin = useOrigin('')

  const active = DEMO_ENDPOINTS.find((e) => e.id === activeId) ?? null

  useEffect(() => {
    if (copyState !== 'copied') return
    const t = setTimeout(() => setCopyState('idle'), COPY_FEEDBACK_MS)
    return () => clearTimeout(t)
  }, [copyState])

  const rawText = result
    ? (result.body ? JSON.stringify(result.body, null, 2) : result.text || (result.failure?.message ?? ''))
    : ''

  const copyResult = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(rawText)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [rawText])

  const run = useCallback(async (e: ApiEndpoint) => {
    const demo = e.demo
    if (!demo) return
    if (!apiKey.trim()) {
      setActiveId(e.id)
      setResult(blockedDemoOutcome(DEMO.keyMissing)); setCopyState('idle')
      return
    }
    const problem = keyProblem(apiKey.trim())
    if (problem) {
      setActiveId(e.id)
      setResult(blockedDemoOutcome(problem)); setCopyState('idle')
      return
    }
    setLoading(true); setActiveId(e.id); setResult(null); setShowRaw(false); setCopyState('idle')
    const base = `${origin}/api/public/v1`
    try {
      const needed = demo.needs ? await resolveNeeds(demo.needs, base, apiKey) : { extra: {} }
      if ('outcome' in needed) { setResult(needed.outcome); return }
      const { extra } = needed
      const qs = demo.query ? `?${new URLSearchParams(demo.query).toString()}` : ''
      const res = await fetch(`${base}${e.path}${qs}`, {
        method: e.method,
        headers: {
          'X-API-Key': apiKey,
          ...(demo.body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: demo.body ? JSON.stringify(fillBody(demo.body, extra)) : undefined,
      })
      setResult(await readOutcome(res))
    } catch {
      // fetch 자체가 실패: 서버에 닿지 않았다. 브라우저 원문은 사용자가 고칠 수 있는 말이 아니다
      const failure = describeDemoFailure(0, false)
      setResult({ status: null, body: null, text: '', failure })
    } finally {
      setLoading(false)
    }
  }, [apiKey, origin])

  /** 버튼은 registry 에서 나온다, 화면이 목록을 따로 들지 않는다 */
  const groups = API_GROUPS.filter((g) => DEMO_ENDPOINTS.some((e) => e.group === g.key))

  return (
    <div>
      <PageHeader
        title="직접 실행"
        description="발급받은 키를 넣고 버튼을 누르면 실제 응답이 아래에 표시됩니다. 원문 JSON은 결과 오른쪽 위 「JSON 보기」로 볼 수 있습니다."
      />

      {/* API Key 입력 */}
      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: 'var(--space-6)' }}>
        <label htmlFor="ax-demo-key" className="label">
          API Key <span style={{ color: 'var(--danger)' }}>*</span>
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
          <input className="input-field"
            id="ax-demo-key"
            type="password"
            placeholder="ax_live_..."
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            style={{ flex: 1, minWidth: 0, fontFamily: 'monospace' }}
          />
          <a href="/api-keys" className="btn-ghost" style={{ whiteSpace: 'nowrap' }}>키 발급</a>
        </div>
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
          입력한 키는 이 브라우저에서만 쓰입니다. 서버에 저장하지 않습니다.
        </p>
      </div>

      {/* 데모 버튼, 묶음은 registry 의 API_GROUPS 를 그대로 따른다 */}
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>
            {g.label}
          </div>
          {/* 고정 4열 금지(반응형 정책), 공용 그리드 클래스가 모바일에서 2열로 접는다 */}
          <div className="responsive-grid-cols-4">
            {DEMO_ENDPOINTS.filter((e) => e.group === g.key).map((e) => {
              const isActive = activeId === e.id
              return (
                <button
                  key={e.id}
                  type="button"
                  className="card"
                  onClick={() => run(e)}
                  disabled={loading && isActive}
                  title={e.requires ? REQUIRES_LABEL[e.requires] : undefined}
                  style={{
                    padding: 'var(--space-4)',
                    background: isActive ? 'var(--brand-soft)' : undefined,
                    color: 'var(--text)', cursor: loading && isActive ? 'wait' : 'pointer',
                    textAlign: 'left', minWidth: 0, maxWidth: '100%', overflowWrap: 'anywhere',
                  }}
                >
                  {loading && isActive && (
                    <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand)', marginBottom: 'var(--space-1)' }}>{DEMO.running}</div>
                  )}
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)', marginBottom: 'var(--space-1)' }}>{e.title}</div>
                  <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)' }}>{e.desc}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-1)', minWidth: 0 }}>
                    <NbBadge status={METHOD_STATUS[e.method]}>{e.method}</NbBadge>
                    <code style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', ...TEXT_WRAP }}>{e.path}</code>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* 결과 */}
      {result !== null && (() => {
        const isOk = !result.failure && result.body?.success === true
        const badge = result.failure?.badge ?? (result.status != null ? demoStatusBadge(result.status) : DEMO.notSent)
        return (
          <div className="card card-flush" data-demo-result="" style={{ overflow: 'hidden', minWidth: 0, maxWidth: '100%' }}>
            <div style={{ padding: '12px 20px', background: 'var(--surface-muted)', borderBottom: 'var(--hairline) solid var(--border-light)', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOk ? 'var(--success)' : 'var(--danger)', display: 'inline-block', flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', ...TEXT_WRAP }}>{active?.title ?? ''}</span>
                <span data-testid="demo-status" style={{ fontSize: 11, color: isOk ? 'var(--success)' : 'var(--danger)', background: isOk ? 'var(--success-bg)' : 'var(--danger-bg)', padding: '2px 7px', borderRadius: 100 }}>{badge}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <button type="button" className="btn-ghost" onClick={() => setShowRaw(v => !v)}>
                  {showRaw ? DEMO.showUi : DEMO.showRaw}
                </button>
                <button type="button" className="btn-ghost" onClick={copyResult} disabled={!rawText}>
                  {copyState === 'copied' ? DEMO.copied : DEMO.copy}
                </button>
              </div>
              {copyState === 'failed' && (
                <p role="alert" style={{ flexBasis: '100%', margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>{DEMO.copyFailed}</p>
              )}
            </div>
            <div style={{ padding: '20px 24px', maxHeight: 560, overflowY: 'auto', minWidth: 0 }}>
              {showRaw ? (
                <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--text)', overflowX: 'auto', maxWidth: '100%' }}>
                  {rawText || DEMO.empty}
                </pre>
              ) : (
                active && renderDemoResult(active, result)
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
