'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import dynamic from 'next/dynamic'
import { Download } from 'lucide-react'

const PriceTableTab = dynamic(() => import('./tabs/PriceTableTab'), { ssr: false })
const QuoteRegisterTab = dynamic(() => import('./tabs/QuoteRegisterTab'), { ssr: false })
const ReviewTab = dynamic(() => import('./tabs/ReviewTab'), { ssr: false })
const SuppliersTab = dynamic(() => import('./tabs/SuppliersTab'), { ssr: false })
const HistoryTab = dynamic(() => import('./tabs/HistoryTab'), { ssr: false })

type TabId = 'board' | 'intake' | 'review' | 'suppliers' | 'log'

interface SettingsData {
  usd_krw: number | null
  fx_date: string | null
  margin_pct: number
}

interface PendingData {
  quotes: unknown[]
}

export default function GpuPricingClient() {
  const [activeTab, setActiveTab] = useState<TabId>('board')
  const { data: settings } = useSWR<SettingsData>('/api/pricing/gpu/settings', fetcher, {
    refreshInterval: 300000,
  })
  const { data: pendingData } = useSWR<PendingData>('/api/pricing/gpu/quotes/pending', fetcher, {
    refreshInterval: 30000,
  })

  const pendingCount = pendingData?.quotes?.length ?? 0
  const usdKrw = settings?.usd_krw
  const fxDate = settings?.fx_date

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: number }[] = [
    {
      id: 'board',
      label: '가격표',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="12" y="6" width="3" height="12"/><rect x="17" y="13" width="3" height="5"/></svg>,
    },
    {
      id: 'intake',
      label: '공급견적 등록',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>,
    },
    {
      id: 'review',
      label: '검토 대기',
      icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>,
      badge: pendingCount,
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
              <span className="gpu-mono">1 USD = {usdKrw.toLocaleString('ko-KR')}원</span>
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
        {activeTab === 'suppliers' && <SuppliersTab />}
        {activeTab === 'log' && <HistoryTab />}
      </div>
    </div>
  )
}
