'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'
import { RefreshCw, ExternalLink, Save, Link2 } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'

interface SourceRow {
  id: string
  kind: 'competitor_page' | 'model_url'
  target: string
  url: string
  active: boolean
  competitorId: string
}
interface LastRun {
  run_date: string
  status: string
  finished_at: string | null
  urls_checked: number | null
  prices_updated: number | null
}

const KIND_LABEL: Record<SourceRow['kind'], string> = {
  competitor_page: '경쟁사 가격 페이지',
  model_url: '모델별 링크',
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url.slice(0, 40) }
}

export default function SourcesTab() {
  const { data, isLoading, mutate } = useSWR<{ sources: SourceRow[]; lastRun: LastRun | null }>(
    '/api/pricing/gpu/sources', fetcher,
  )
  const [refreshing, setRefreshing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [filterFail, setFilterFail] = useState(false)
  const [editing, setEditing] = useState<{ competitorId: string; url: string } | null>(null)
  const [saving, setSaving] = useState(false)

  const sources = data?.sources ?? []
  const lastRun = data?.lastRun ?? null

  async function refreshNow() {
    setRefreshing(true); setMsg(null)
    try {
      const res = await fetch('/api/pricing/gpu/market/refresh', { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { setMsg(j.error ?? '수집에 실패했어요. 잠시 후 다시 시도해 주세요.'); return }
      setMsg(`수집 완료 — 링크 ${j.urls_checked ?? 0}개 확인, 가격 ${j.prices_updated ?? 0}건 갱신`)
      await mutate()
    } catch {
      setMsg('수집 중 오류가 발생했어요.')
    } finally {
      setRefreshing(false)
    }
  }

  async function saveUrl() {
    if (!editing) return
    setSaving(true)
    try {
      const res = await fetch(`/api/pricing/gpu/competitors/${editing.competitorId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pricing_url: editing.url }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? '저장에 실패했어요'); return }
      setEditing(null)
      await mutate()
    } finally { setSaving(false) }
  }

  return (
    <div className="page-inner">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)', margin: 0 }}>수집 소스</h1>
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            경쟁사 가격을 자동으로 가져올 링크를 모아 보고·수정·관리하는 곳이에요. 매일 아침 첫 접속 때 자동으로 확인합니다.
          </p>
        </div>
        <button className="gpu-btn" onClick={refreshNow} disabled={refreshing}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'var(--border-w-2) solid var(--brand)', background: 'var(--brand)', color: '#fff', fontWeight: 600, fontSize: 'var(--fs-sm)', cursor: refreshing ? 'wait' : 'pointer' }}>
          <RefreshCw size={15} style={{ animation: refreshing ? 'spin 1s linear infinite' : undefined }} /> 지금 전체 다시 가져오기
        </button>
      </div>

      {lastRun && (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>
          마지막 자동 수집: {lastRun.run_date} · {lastRun.status === 'done' ? `완료(링크 ${lastRun.urls_checked ?? 0}개)` : lastRun.status}
        </div>
      )}
      {msg && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', background: 'var(--info-bg)', border: 'var(--hairline) solid var(--info-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 10 }}>{msg}</div>}

      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 10, cursor: 'pointer' }}>
        <input type="checkbox" checked={filterFail} onChange={(e) => setFilterFail(e.target.checked)} /> 문제 있는 링크만 보기
      </label>

      {isLoading ? (
        <div style={{ padding: '24px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>불러오는 중…</div>
      ) : sources.length === 0 ? (
        <EmptyState
          icon={<Link2 size={28} />}
          title="아직 등록된 수집 링크가 없어요"
          description={'경쟁사 화면에서 각 경쟁사에 "가격 페이지 주소"를 넣으면 여기에 나타나고, 매일 아침 자동으로 가격을 확인합니다.'}
        />
      ) : (
        <table className="table-base table-card gpu-mgmt-table">
          <thead>
            <tr>
              <th>종류</th><th>대상</th><th>주소(링크)</th><th className="r">상태</th>
            </tr>
          </thead>
          <tbody>
            {sources.filter((s) => !filterFail || !s.active).map((s) => (
              <tr key={s.id}>
                <td className="card-header"><span>{KIND_LABEL[s.kind]}</span></td>
                <td data-label="대상">{s.target}</td>
                <td data-label="주소">
                  {editing && editing.competitorId === s.competitorId && s.kind === 'competitor_page' ? (
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <input className="input-field" style={{ height: 30, fontSize: 12, minWidth: 220 }}
                        value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })}
                        placeholder="https://경쟁사-가격페이지-주소" />
                      <button className="gpu-btn" onClick={saveUrl} disabled={saving} style={{ padding: '4px 8px', display: 'inline-flex', gap: 4, alignItems: 'center' }}><Save size={13} /> 저장</button>
                      <button className="gpu-btn" onClick={() => setEditing(null)} style={{ padding: '4px 8px' }}>취소</button>
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--brand)', display: 'inline-flex', gap: 3, alignItems: 'center', fontSize: 'var(--fs-sm)' }}>
                        {domainOf(s.url)} <ExternalLink size={12} />
                      </a>
                      {s.kind === 'competitor_page' && (
                        <button className="gpu-btn" onClick={() => setEditing({ competitorId: s.competitorId, url: s.url })} style={{ padding: '2px 8px', fontSize: 11 }}>수정</button>
                      )}
                    </span>
                  )}
                </td>
                <td data-label="상태" className="r">
                  <span style={{ fontSize: 'var(--fs-sm)', color: s.active ? 'var(--success)' : 'var(--text-faint)' }}>
                    {s.active ? '자동 수집 켜짐' : '꺼짐'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
