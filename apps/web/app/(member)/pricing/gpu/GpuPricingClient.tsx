'use client'

import { useState, useEffect, useRef } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import dynamic from 'next/dynamic'
import { Download } from 'lucide-react'

const PriceTableTab = dynamic(() => import('./tabs/PriceTableTab'), { ssr: false })
const QuoteRegisterTab = dynamic(() => import('./tabs/QuoteRegisterTab'), { ssr: false })
const ReviewTab = dynamic(() => import('./tabs/ReviewTab'), { ssr: false })
const SuppliersTab = dynamic(() => import('./tabs/SuppliersTab'), { ssr: false })
const HistoryTab = dynamic(() => import('./tabs/HistoryTab'), { ssr: false })
const InventoryTab = dynamic(() => import('./tabs/InventoryTab'), { ssr: false })
const DbChatTab = dynamic(() => import('./tabs/DbChatTab'), { ssr: false })

type TabId = 'board' | 'intake' | 'review' | 'inventory' | 'suppliers' | 'log' | 'chat'

interface SettingsData {
  usd_krw: number | null
  fx_date: string | null
  margin_pct: number
}

interface ReviewPendingData {
  items: unknown[]
}

export default function GpuPricingClient() {
  const [activeTab, setActiveTab] = useState<TabId>('board')
  const { data: settings, mutate: mutateSettings } = useSWR<SettingsData>('/api/pricing/gpu/settings', fetcher, {
    refreshInterval: 300000,
  })
  const { data: reviewData } = useSWR<ReviewPendingData>(
    '/api/pricing/gpu/review?status=pending',
    fetcher,
    { refreshInterval: 30000 }
  )

  const pendingCount = reviewData?.items?.length ?? 0
  const usdKrw = settings?.usd_krw
  const fxDate = settings?.fx_date

  // 오늘 환율 데이터가 없으면 자동 갱신 (마운트 1회 — useRef로 중복 방지)
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

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'board',
      label: '가격표',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/></svg>,
    },
    {
      id: 'intake',
      label: '통합 입력',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
    },
    {
      id: 'review',
      label: '검토 대기',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
      badge: pendingCount,
    },
    {
      id: 'inventory',
      label: '재고/문의',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    },
    {
      id: 'suppliers',
      label: '공급사',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21h18M5 21V7l8-4v18M19 21V11l-6-4"/></svg>,
    },
    {
      id: 'log',
      label: '변동 이력',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    },
    {
      id: 'chat',
      label: 'DB 질문',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>,
    },
  ]

  return (
    <div className="page-inner gpu-pricing-root">
      {/* 상단 헤더 */}
      <div className="gpu-topbar">
        <div>
          <div className="gpu-crumb">가격정책</div>
          <h2 className="gpu-page-title">GPU 가격관리</h2>
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
        </div>
      </div>

      {/* 탭 */}
      <div className="gpu-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={`gpu-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && (
              <span className="gpu-tab-cnt">{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="gpu-tab-content">
        {activeTab === 'board' && (
          <PriceTableTab onGoToIntake={() => setActiveTab('intake')} />
        )}
        {activeTab === 'intake' && <QuoteRegisterTab />}
        {activeTab === 'review' && <ReviewTab />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'suppliers' && <SuppliersTab />}
        {activeTab === 'log' && <HistoryTab />}
        {activeTab === 'chat' && <DbChatTab />}
      </div>
    </div>
  )
}
