'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import dynamic from 'next/dynamic'
import { Download, Plus } from 'lucide-react'
import Link from 'next/link'

const PriceTableTab = dynamic(() => import('./tabs/PriceTableTab'), { ssr: false })
const ReviewTab = dynamic(() => import('./tabs/ReviewTab'), { ssr: false })
const SuppliersTab = dynamic(() => import('./tabs/SuppliersTab'), { ssr: false })
const HistoryTab = dynamic(() => import('./tabs/HistoryTab'), { ssr: false })
const InventoryTab = dynamic(() => import('./tabs/InventoryTab'), { ssr: false })
const DbChatTab = dynamic(() => import('./tabs/DbChatTab'), { ssr: false })
const MarketTab = dynamic(() => import('./tabs/MarketTab'), { ssr: false })
const SalePriceCatalogPage = dynamic(() => import('../catalog/page'), { ssr: false })

type MainTabId = 'board' | 'market' | 'inventory' | 'catalog'
type SecondaryTabId = 'review' | 'suppliers' | 'log'
type TabId = MainTabId | SecondaryTabId

interface SettingsData {
  usd_krw: number | null
  fx_date: string | null
  margin_pct: number
}

interface ReviewPendingData {
  items: unknown[]
}

const MAIN_TABS: { id: MainTabId; label: string; icon: React.ReactNode }[] = [
  {
    id: 'board',
    label: '가격표',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/></svg>,
  },
  {
    id: 'market',
    label: '시장 비교',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 5-5"/><path d="M14 10h5v5"/></svg>,
  },
  {
    id: 'inventory',
    label: '재고수량',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  },
  {
    id: 'catalog',
    label: '고객 판매가격표',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  },
]

interface InitialSettings {
  margin_pct: number | null
  usd_krw: number | null
  fx_date: string | null
}

export default function GpuPricingClient({ initialSettings }: { initialSettings?: InitialSettings }) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<TabId>('board')
  const [showAiPanel, setShowAiPanel] = useState(false)
  const [boardSearch, setBoardSearch] = useState('')
  const [boardFocusProductId, setBoardFocusProductId] = useState<string | null>(null)
  // 서버 프리페치 설정값을 SWR 초기값으로 주입 → 첫 페인트부터 실제값(하드코딩 깜빡임 제거)
  const { data: settings, mutate: mutateSettings } = useSWR<SettingsData>('/api/pricing/gpu/settings', fetcher, {
    refreshInterval: 300000,
    fallbackData: initialSettings && initialSettings.margin_pct != null
      ? { margin_pct: initialSettings.margin_pct, usd_krw: initialSettings.usd_krw, fx_date: initialSettings.fx_date }
      : undefined,
  })
  const { data: reviewData } = useSWR<ReviewPendingData>(
    '/api/pricing/gpu/review?status=pending',
    fetcher,
    { refreshInterval: 30000 }
  )

  const pendingCount = reviewData?.items?.length ?? 0
  const usdKrw = settings?.usd_krw
  const fxDate = settings?.fx_date

  const fxFetched = useRef(false)
  useEffect(() => {
    if (fxFetched.current) return
    const today = new Date().toLocaleDateString('sv', { timeZone: 'Asia/Seoul' })
    if (fxDate === today) return
    fxFetched.current = true
    fetch('/api/pricing/gpu/fx', { method: 'POST' })
      .then((res) => { if (res.ok) mutateSettings() })
      .catch(() => {})
  }, [fxDate, mutateSettings])

  const isMainTab = (tab: TabId): tab is MainTabId =>
    ['board', 'market', 'inventory', 'catalog'].includes(tab)

  return (
    <div className="page-inner gpu-pricing-root">
      {/* 상단 헤더 */}
      <div className="gpu-topbar">
        <div>
          <div className="gpu-crumb">가격정책</div>
          <h2 className="gpu-page-title">GPU 관리</h2>
        </div>
        <div className="gpu-topbar-right">
          {usdKrw != null && (
            <div className="gpu-fx-pill" title="매 영업일 한국수출입은행 매매기준율을 자동으로 받아옵니다">
              <span className="gpu-fx-dot" />
              오늘 매매기준율
              <span className="gpu-mono">1 USD = {Math.round(usdKrw).toLocaleString('ko-KR')}원</span>
              {fxDate && <span style={{ fontSize: 10, color: 'var(--gpu-muted)' }}>{fxDate}</span>}
              <span className="gpu-badge gpu-badge-green" style={{ fontSize: '9px', padding: '1px 6px' }}>자동</span>
            </div>
          )}
          <button className="gpu-btn">
            <Download size={15} /> Export
          </button>
          <Link
            href="/intake"
            className="gpu-btn gpu-btn-primary"
            title="공급가·경쟁사 통합 입력"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Plus size={15} /> 통합 입력
          </Link>
        </div>
      </div>

      {/* 메인 탭 + 더보기 인라인 */}
      <div className="gpu-tabs" style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--gpu-border)', paddingBottom: 0 }}>
        {MAIN_TABS.map((tab) => (
          <button
            key={tab.id}
            className={`gpu-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
        <div style={{ width: 1, height: 16, background: 'var(--gpu-border)', margin: '0 6px', flexShrink: 0 }} />
        {[
          {
            id: 'review' as SecondaryTabId,
            label: '검토 대기',
            badge: pendingCount,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
          },
          {
            id: 'suppliers' as SecondaryTabId,
            label: '공급사',
            badge: 0,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>,
          },
          {
            id: 'log' as SecondaryTabId,
            label: '변동 이력',
            badge: 0,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
          },
        ].map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '3px 8px',
              borderRadius: 5,
              border: '1px solid',
              borderColor: activeTab === item.id ? 'var(--gpu-accent)' : 'var(--gpu-border)',
              background: activeTab === item.id ? 'rgba(var(--gpu-accent-rgb, 59,130,246),0.08)' : 'transparent',
              color: activeTab === item.id ? 'var(--gpu-accent)' : 'var(--gpu-muted)',
              fontSize: 11,
              fontWeight: activeTab === item.id ? 600 : 400,
              cursor: 'pointer',
              transition: 'all 0.15s',
              marginRight: 3,
            }}
          >
            {item.icon}
            {item.label}
            {item.badge > 0 && (
              <span style={{
                background: '#ef4444',
                color: '#fff',
                borderRadius: 9,
                fontSize: 9,
                padding: '0 5px',
                fontWeight: 700,
                lineHeight: '16px',
              }}>{item.badge}</span>
            )}
          </button>
        ))}
        {activeTab === 'board' && (
          <div style={{ marginLeft: 'auto', paddingRight: 4, flexShrink: 0 }}>
            <button
              data-testid="ai-panel-toggle"
              className={`gpu-ai-toggle${showAiPanel ? ' gpu-ai-toggle--on' : ''}`}
              onClick={() => setShowAiPanel((v) => !v)}
              title="AI 조회 패널 토글"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"/></svg>
              AI 조회
            </button>
          </div>
        )}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="gpu-tab-content">
        {activeTab === 'board' && (
          <div style={{ display: 'flex', gap: 0, height: '100%', minHeight: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
              <PriceTableTab
                onGoToIntake={() => router.push('/intake')}
                onGoToReview={() => setActiveTab('review')}
                initialSearch={boardSearch}
                onSearchConsumed={() => setBoardSearch('')}
                initialProductId={boardFocusProductId}
                onProductFocusConsumed={() => setBoardFocusProductId(null)}
                initialMargin={settings?.margin_pct ?? null}
                initialUsdKrw={settings?.usd_krw ?? null}
              />
            </div>
            <div className={`gpu-ai-sidebar${showAiPanel ? ' gpu-ai-sidebar--open' : ''}`}>
              <div className="gpu-ai-sidebar-inner">
                <div style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid var(--gpu-border)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--gpu-muted)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexShrink: 0,
                }}>
                  AI 조회
                  <button
                    className="gpu-btn"
                    style={{ padding: '2px 6px', fontSize: 11 }}
                    onClick={() => setShowAiPanel(false)}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ flex: 1, overflow: 'hidden' }}>
                  <DbChatTab />
                </div>
              </div>
            </div>
          </div>
        )}
        {activeTab === 'market' && (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <MarketTab
              onGoToPriceTable={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board') }}
              onOpenAI={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board'); setShowAiPanel(true) }}
            />
          </div>
        )}
        {activeTab === 'inventory' && (
          <div style={{ height: '100%', overflow: 'hidden' }}>
            <InventoryTab />
          </div>
        )}
        {activeTab === 'catalog' && (
          <div style={{ overflow: 'auto', height: '100%' }}>
            <SalePriceCatalogPage />
          </div>
        )}
        {activeTab === 'review' && <div style={{ height: '100%', overflowY: 'auto' }}><ReviewTab /></div>}
        {activeTab === 'suppliers' && <div style={{ height: '100%', overflowY: 'auto' }}><SuppliersTab onGoToPriceTable={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board') }} /></div>}
        {activeTab === 'log' && <div style={{ height: '100%', overflowY: 'auto' }}><HistoryTab /></div>}
      </div>
    </div>
  )
}
