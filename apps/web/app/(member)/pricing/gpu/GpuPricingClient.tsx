'use client'

import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import dynamic from 'next/dynamic'
import { Download, Plus } from 'lucide-react'
import { isGpuFlagOn } from '@/lib/gpu/feature-flags'

const QuoteRegisterTab = dynamic(() => import('./tabs/QuoteRegisterTab'), { ssr: false })
const PriceTableTab = dynamic(() => import('./tabs/PriceTableTab'), { ssr: false })
const PriceCockpitTab = dynamic(() => import('./tabs/PriceCockpitTab'), { ssr: false })
const ReviewTab = dynamic(() => import('./tabs/ReviewTab'), { ssr: false })
const SuppliersTab = dynamic(() => import('./tabs/SuppliersTab'), { ssr: false })
const CompetitorsTab = dynamic(() => import('./tabs/CompetitorsTab'), { ssr: false })
const HistoryTab = dynamic(() => import('./tabs/HistoryTab'), { ssr: false })
const InventoryTab = dynamic(() => import('./tabs/InventoryTab'), { ssr: false })
const DbChatTab = dynamic(() => import('./tabs/DbChatTab'), { ssr: false })
const MarketTab = dynamic(() => import('./tabs/MarketTab'), { ssr: false })
const SpecsTab = dynamic(() => import('./tabs/SpecsTab'), { ssr: false })
const SalePriceCatalogPage = dynamic(() => import('../catalog/page'), { ssr: false })
// 통합 표(리팩토링) — feature flag 'unified' ON 시 가격표 영역 대체. 기본 OFF(병존·무중단)
const UnifiedTableConnected = dynamic(() => import('@/components/pricing/gpu/unified/UnifiedTableConnected'), { ssr: false })

type MainTabId = 'intake' | 'board' | 'cockpit' | 'market' | 'inventory' | 'catalog'
type SecondaryTabId = 'review' | 'suppliers' | 'competitors' | 'specs' | 'log'
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
    id: 'intake',
    label: '통합 입력',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>,
  },
  {
    id: 'board',
    label: '가격표',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/></svg>,
  },
  {
    id: 'cockpit',
    label: '가격 결정',
    icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>,
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

export default function GpuPricingClient({ initialSettings, isAdmin = false }: { initialSettings?: InitialSettings; isAdmin?: boolean }) {
  const searchParams = useSearchParams()
  // FAB '등록' 액션(?create=1&tab=X) → 해당 탭의 생성 모달 자동 오픈. 어느 탭에 신호를 줄지 보관.
  const [autoCreateTab, setAutoCreateTab] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>('board')
  const [showAiPanel, setShowAiPanel] = useState(false)
  // 통합 표 flag — 클라이언트에서만 평가(localStorage 오버라이드). 하이드레이션 불일치 방지 위해 mount 후 설정.
  const [unifiedOn, setUnifiedOn] = useState(false)
  useEffect(() => { setUnifiedOn(isGpuFlagOn('unified')) }, [])
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

  // ── 뷰 상태 영속 (URL 파라미터 + sessionStorage) ──
  // 탭 이동·다른 메뉴 갔다 와도 마지막 보던 화면(탭/검색/펼친 가격)을 복원.
  const viewRestored = useRef(false)
  const VALID_TABS = ['intake', 'board', 'cockpit', 'market', 'inventory', 'catalog', 'review', 'suppliers', 'competitors', 'specs', 'log']

  // 최초 진입: URL(우선) → sessionStorage 순으로 탭 복원
  useEffect(() => {
    if (viewRestored.current) return
    viewRestored.current = true
    const p = new URLSearchParams(window.location.search)
    let t = p.get('tab')
    if (!t) { try { t = (JSON.parse(sessionStorage.getItem('gpu:view') || '{}').tab as string) || null } catch { t = null } }
    if (t && VALID_TABS.includes(t)) setActiveTab(t as TabId)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 사이드바 메뉴 등으로 URL ?tab= 가 바뀌면(이미 이 페이지에 있어도) 해당 탭으로 전환.
  // 탭 클릭은 replaceState라 searchParams를 안 건드림 → 루프 없음. Link 네비게이션만 반응.
  useEffect(() => {
    const t = searchParams.get('tab')
    if (t && VALID_TABS.includes(t) && t !== activeTab) setActiveTab(t as TabId)
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // FAB '등록' 액션: ?create=1 이 들어오면 해당 ?tab= 의 생성 모달을 1회 오픈하도록 신호 저장 후 즉시 URL에서 제거.
  // (제거하므로 새로고침/탭 재전환 시 재오픈 안 함. 매 FAB 클릭마다 create=1 가 새로 와서 재발화.)
  useEffect(() => {
    if (searchParams.get('create') !== '1') return
    const t = searchParams.get('tab')
    setAutoCreateTab(t)
    const p = new URLSearchParams(window.location.search)
    p.delete('create')
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
  }, [searchParams])

  // 탭 변경 → URL·sessionStorage 반영 (navigation 없이 replaceState)
  // Next 14.1+는 replaceState를 router에 동기화 → useSearchParams() 재생성됨.
  // URL의 tab이 이미 activeTab과 같으면 replaceState를 호출하지 않아(중복쓰기 차단)
  // searchParams 재발화→activeTab effect 재발화의 무한 루프를 끊는다. sessionStorage는 항상 갱신.
  useEffect(() => {
    if (!viewRestored.current) return
    const p = new URLSearchParams(window.location.search)
    if (p.get('tab') !== activeTab) {
      p.set('tab', activeTab)
      window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
    }
    try { sessionStorage.setItem('gpu:view', JSON.stringify({ tab: activeTab, q: p.get('q') || '', expand: p.get('expand') || '' })) } catch { /* noop */ }
  }, [activeTab])

  // 가격표 탭 진입 시: URL의 검색·펼침을 재주입(복원)
  useEffect(() => {
    if (activeTab !== 'board') return
    const p = new URLSearchParams(window.location.search)
    const q = p.get('q'); const ex = p.get('expand')
    if (q) setBoardSearch(q)
    if (ex) setBoardFocusProductId(ex)
  }, [activeTab])

  // 가격표 내부 상태(검색·펼친 상품) 변경 → URL·sessionStorage 반영
  const persistBoard = (patch: { q?: string; expand?: string | null }) => {
    const p = new URLSearchParams(window.location.search)
    if (patch.q !== undefined) { patch.q ? p.set('q', patch.q) : p.delete('q') }
    if (patch.expand !== undefined) { patch.expand ? p.set('expand', patch.expand) : p.delete('expand') }
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`)
    try { sessionStorage.setItem('gpu:view', JSON.stringify({ tab: activeTab, q: p.get('q') || '', expand: p.get('expand') || '' })) } catch { /* noop */ }
  }

  // GPU fullpane 모드: mount 시 <main class="page-inner">에 gpu-fullpane-main 부착.
  // 이 클래스가 main의 overflow/padding을 억제해 GPU root가 자체 높이 체인을 점유.
  // unmount 시 제거 → 다른 페이지 회귀 없음.
  useEffect(() => {
    const main = document.querySelector('main.page-inner')
    if (!main) return
    main.classList.add('gpu-fullpane-main')
    return () => { main.classList.remove('gpu-fullpane-main') }
  }, [])

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

  // P4-3 가드: 비-admin이 URL/복원으로 마스터 관리(admin 전용) 탭에 진입하면 기본 탭으로 복귀.
  useEffect(() => {
    if (!isAdmin && (['suppliers', 'competitors', 'specs'] as TabId[]).includes(activeTab)) {
      setActiveTab('board')
    }
  }, [isAdmin, activeTab])

  const isMainTab = (tab: TabId): tab is MainTabId =>
    ['intake', 'board', 'cockpit', 'market', 'inventory', 'catalog'].includes(tab)

  return (
    <div className="gpu-pricing-root">
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
          <button
            className="gpu-btn gpu-btn-primary"
            title="공급가·경쟁사 통합 입력"
            onClick={() => setActiveTab('intake')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Plus size={15} /> 통합 입력
          </button>
        </div>
      </div>

      {/* 메인 탭 + 더보기 인라인 */}
      <div className="gpu-tabs" style={{ display: 'flex', alignItems: 'center', borderBottom: 'var(--hairline) solid var(--gpu-border)', paddingBottom: 0 }}>
        {/* 통합 표 ON: 메인 5탭(가격표·가격결정·시장·재고·고객가)은 통합 표의 보기 세그먼트가 대체 → 'intake'·'board'만 유지 */}
        {(unifiedOn ? MAIN_TABS.filter((t) => t.id === 'intake' || t.id === 'board') : MAIN_TABS).map((tab) => (
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
            id: 'competitors' as SecondaryTabId,
            label: '경쟁사',
            badge: 0,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="3"/><circle cx="17" cy="7" r="3"/><path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2M15 15h2a4 4 0 014 4v2"/></svg>,
          },
          {
            id: 'specs' as SecondaryTabId,
            label: '스펙 관리',
            badge: 0,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 13h6M9 17h3"/></svg>,
          },
          {
            id: 'log' as SecondaryTabId,
            label: '변동 이력',
            badge: 0,
            icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
          },
        ]
          // P4-3 메뉴 분리(RBAC): 마스터 관리 탭은 admin 전용. member는 통합 표 상세 패널에서 마스터를 읽음.
          .filter((item) => isAdmin || !(['suppliers', 'competitors', 'specs'] as SecondaryTabId[]).includes(item.id))
          .map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: '3px 8px',
              borderRadius: 5,
              border: 'var(--hairline) solid',
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
                background: 'var(--danger)',
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

      {/* 탭 컨텐츠 — gpu-tab-content: flex:1 min-height:0 overflow:hidden display:flex flex-direction:column
           자식은 gpu-tab-panel(overflow:hidden) 또는 gpu-tab-panel--scroll(overflowY:auto) 사용 */}
      <div className="gpu-tab-content">
        {activeTab === 'intake' && (
          <div className="gpu-tab-panel gpu-tab-panel--scroll">
            <QuoteRegisterTab />
          </div>
        )}
        {activeTab === 'board' && unifiedOn && (
          <div className="gpu-tab-panel">
            <UnifiedTableConnected
              marginPct={settings?.margin_pct ?? undefined}
              isAdmin={isAdmin}
              onMarginSaved={() => mutateSettings()}
              onRegisterQuote={() => setActiveTab('intake')}
              onManageMapping={() => setActiveTab('market')}
            />
          </div>
        )}
        {activeTab === 'board' && !unifiedOn && (
          <div className="gpu-tab-panel" style={{ display: 'flex', flexDirection: 'row', gap: 0, minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <PriceTableTab
                onGoToIntake={() => setActiveTab('intake')}
                onGoToReview={() => setActiveTab('review')}
                initialSearch={boardSearch}
                onSearchConsumed={() => setBoardSearch('')}
                initialProductId={boardFocusProductId}
                onProductFocusConsumed={() => setBoardFocusProductId(null)}
                initialMargin={settings?.margin_pct ?? null}
                initialUsdKrw={settings?.usd_krw ?? null}
                isAdmin={isAdmin}
                onSearchChange={(q) => persistBoard({ q })}
                onExpandChange={(id) => persistBoard({ expand: id })}
              />
            </div>
            <div className={`gpu-ai-sidebar${showAiPanel ? ' gpu-ai-sidebar--open' : ''}`}>
              <div className="gpu-ai-sidebar-inner">
                <div style={{
                  padding: '8px 12px',
                  borderBottom: 'var(--hairline) solid var(--gpu-border)',
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
        {activeTab === 'cockpit' && (
          <div className="gpu-tab-panel">
            <PriceCockpitTab
              isAdmin={isAdmin}
              onGoToTab={(tab) => setActiveTab(tab as TabId)}
            />
          </div>
        )}
        {activeTab === 'market' && (
          <div className="gpu-tab-panel">
            <MarketTab
              isAdmin={isAdmin}
              autoCreate={autoCreateTab === 'market'}
              onAutoCreateConsumed={() => setAutoCreateTab(null)}
              onGoToPriceTable={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board') }}
              onOpenAI={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board'); setShowAiPanel(true) }}
            />
          </div>
        )}
        {activeTab === 'inventory' && (
          <div className="gpu-tab-panel">
            <InventoryTab />
          </div>
        )}
        {activeTab === 'catalog' && (
          <div className="gpu-tab-panel--scroll">
            <SalePriceCatalogPage />
          </div>
        )}
        {activeTab === 'review' && <div className="gpu-tab-panel--scroll"><ReviewTab /></div>}
        {activeTab === 'suppliers' && <div className="gpu-tab-panel--scroll"><SuppliersTab autoCreate={autoCreateTab === 'suppliers'} onAutoCreateConsumed={() => setAutoCreateTab(null)} onGoToPriceTable={(modelName, productId) => { setBoardSearch(modelName); setBoardFocusProductId(productId); setActiveTab('board') }} /></div>}
        {activeTab === 'competitors' && <div className="gpu-tab-panel--scroll"><div className="page-inner"><CompetitorsTab autoCreate={autoCreateTab === 'competitors'} onAutoCreateConsumed={() => setAutoCreateTab(null)} /></div></div>}
        {activeTab === 'specs' && <div className="gpu-tab-panel--scroll"><div className="page-inner"><SpecsTab /></div></div>}
        {activeTab === 'log' && <div className="gpu-tab-panel--scroll"><HistoryTab /></div>}
      </div>
    </div>
  )
}
