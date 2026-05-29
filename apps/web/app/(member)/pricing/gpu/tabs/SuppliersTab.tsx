'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { Plus } from 'lucide-react'

interface SupplierStats {
  id: string
  name: string
  location: string | null
  color: string
  contact: string | null
  active_quotes: number
  lowest_count: number
  last_received: string | null
}

export default function SuppliersTab() {
  const { data } = useSWR<{ suppliers: SupplierStats[] }>('/api/pricing/gpu/suppliers', fetcher)
  const suppliers = data?.suppliers ?? []
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? suppliers.filter((s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.location ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : suppliers

  return (
    <div>
      <div className="gpu-toolbar">
        <div className="gpu-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
          <input
            placeholder="공급사 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button className="gpu-btn">
          <Plus size={15} /> 공급사 추가
        </button>
      </div>

      <div className="gpu-sup-grid">
        {filtered.map((s) => (
          <div key={s.id} className="gpu-sup-card">
            <div className="gpu-sup-head">
              <div className="gpu-sup-logo" style={{ background: s.color }}>
                {s.name.charAt(0)}
              </div>
              <div>
                <div className="gpu-sup-nm">{s.name}</div>
                {s.location && (
                  <div className="gpu-sup-loc">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {s.location}
                  </div>
                )}
              </div>
            </div>

            <div className="gpu-sup-stats">
              <div className="gpu-sup-s">
                <div className="gpu-sup-s-n gpu-mono">{s.active_quotes}</div>
                <div className="gpu-sup-s-l">활성 견적</div>
              </div>
              <div className="gpu-sup-s">
                <div className="gpu-sup-s-n gpu-mono">{s.lowest_count}</div>
                <div className="gpu-sup-s-l">최저가 보유</div>
              </div>
              <div className="gpu-sup-s">
                <div className="gpu-sup-s-n gpu-mono" style={{ fontSize: 13 }}>
                  {s.last_received ? new Date(s.last_received).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '—'}
                </div>
                <div className="gpu-sup-s-l">최근 수신</div>
              </div>
            </div>

            <div className="gpu-sup-foot">
              {s.contact && <span>{s.contact}</span>}
              <button className="gpu-btn" style={{ padding: '5px 10px', fontSize: '12px' }}>
                견적 등록
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 24px', color: 'var(--gpu-faint)', fontSize: '13px' }}>
            {suppliers.length === 0 ? '등록된 공급사가 없습니다' : '검색 결과가 없습니다'}
          </div>
        )}
      </div>
    </div>
  )
}
