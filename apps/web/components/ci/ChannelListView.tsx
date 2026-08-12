'use client'

// components/ci/ChannelListView.tsx — 채널 목록 공용 뷰
// 모니터링(관심 채널)과 내 채널이 같은 데이터·같은 표를 쓴다.
// 화면 두 개가 각자 표를 만들면 표시 규칙이 갈라진다.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ApiResponse, CiChannelListItem } from '@/lib/ci/contracts'
import { CI_PLATFORM_LABEL } from '@/lib/ci/types'
import { EmptyState, ErrorState } from './states'
import { isEnterKey } from '@/lib/ui/ime'

interface ChannelListViewProps {
  workspaceId: string
  items: CiChannelListItem[]
  /** 'tracked' = 관심 채널(모니터링), 'owned' = 내 채널 */
  mode: 'tracked' | 'owned'
}

export default function ChannelListView({ workspaceId, items, mode }: ChannelListViewProps) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function add() {
    if (!input.trim()) return
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ input: input.trim(), monitor: mode === 'tracked' }),
      }).then((r) => r.json() as Promise<ApiResponse<CiChannelListItem>>)

      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }

      if (mode === 'owned') {
        await fetch(`/api/ci/channels/${res.data.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
          body: JSON.stringify({ ownership: 'owned' }),
        })
      }
      setInput('')
      router.refresh()
    } catch {
      setError({ code: 'INTERNAL', message: '채널을 추가하지 못했습니다' })
    } finally {
      setBusy(false)
    }
  }

  async function toggleMonitor(ch: CiChannelListItem) {
    await fetch(`/api/ci/channels/${ch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
      body: JSON.stringify({ isMonitored: !ch.isMonitored }),
    })
    router.refresh()
  }

  const monitored = items.filter((c) => c.isMonitored).length

  return (
    <>
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <label className="label" htmlFor="ci-ch-add" style={{ position: 'absolute', left: '-9999px' }}>
          채널 주소
        </label>
        <input className="input-field" id="ci-ch-add"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); add() } }}
          placeholder="채널 페이지 주소를 붙여넣으세요 (예: https://www.youtube.com/@채널)"
          disabled={busy}
          style={{ flex: 1 }}
        />
        <button type="button" className="btn-primary" onClick={add} disabled={busy || !input.trim()}>
          {busy ? '추가 중…' : '추가'}
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <ErrorState code={error.code} message={error.message} />
        </div>
      )}

      {mode === 'tracked' && items.length > 0 && (
        <p className="ci-basis" style={{ marginBottom: 'var(--space-2)' }}>
          지켜보는 중 {monitored}곳 / 등록 {items.length}곳
        </p>
      )}

      {items.length === 0 ? (
        <EmptyState
          title={mode === 'tracked' ? '아직 등록한 관심 채널이 없습니다' : '연결한 내 채널이 없습니다'}
          description={mode === 'tracked'
            ? '지켜볼 채널을 3곳 이상 등록하면 평소 대비 배수와 시장 비교가 의미를 갖습니다.'
            : '내 채널을 등록하면 게시물 성과를 추적하고 시장과 비교할 수 있습니다.'}
        />
      ) : (
        <table className="table-base table-card">
          <thead>
            <tr>
              <th>채널</th>
              <th>플랫폼</th>
              <th>구독자</th>
              <th>주제</th>
              {mode === 'tracked' && <th>모니터링</th>}
              <th>작업</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ch) => (
              <tr key={ch.id}>
                <td className="card-header">
                  <Link href={`/ci/channels/${ch.id}`} style={{ fontWeight: 600, color: 'var(--text)' }}>
                    {ch.displayName}
                  </Link>
                </td>
                <td data-label="플랫폼">{CI_PLATFORM_LABEL[ch.platform]}</td>
                <td data-label="구독자">
                  {ch.subscriberCount != null
                    ? <span className="ci-num">{ch.subscriberCount.toLocaleString('ko-KR')}</span>
                    : <span className="ci-basis" title="아직 확보하지 못했습니다">—</span>}
                </td>
                <td data-label="주제">{ch.topic?.name ?? '미지정'}</td>
                {mode === 'tracked' && (
                  <td data-label="모니터링">
                    <span className={ch.isMonitored ? 'ci-status ci-status-ok' : 'ci-status ci-status-neutral'}>
                      {ch.isMonitored ? '지켜보는 중' : '중지'}
                    </span>
                  </td>
                )}
                <td className="card-actions">
                  {mode === 'tracked' && (
                    <button type="button" className="btn-ghost" onClick={() => toggleMonitor(ch)}>
                      {ch.isMonitored ? '중지' : '지켜보기'}
                    </button>
                  )}
                  <Link href={`/ci/channels/${ch.id}`} className="btn-ghost">상세</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
