'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApiResponse, CiChannelListItem } from '@/lib/ci/contracts'
import { CI_PLATFORMS, CI_PLATFORM_LABEL, type CiPlatform } from '@/lib/ci/types'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'

interface PubRow {
  id: string
  platform: CiPlatform
  route: 'manual' | 'api'
  status: string
  scheduled_at: string | null
  published_at: string | null
  published_url: string | null
  error_code: string | null
  error_message: string | null
}

const STATUS_LABEL: Record<string, string> = {
  draft: '작성 중', scheduled: '예약됨', exported: '내보냄', published: '게시됨', failed: '실패',
}

export default function PublishView({
  workspaceId, items, ownedChannels,
}: { workspaceId: string; items: PubRow[]; ownedChannels: CiChannelListItem[] }) {
  const router = useRouter()
  const [platform, setPlatform] = useState<CiPlatform>('youtube')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('18:00')
  const [urlById, setUrlById] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | null>(null)

  async function addItem() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/ci/publications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({
          platform,
          channelId: ownedChannels.find((c) => c.platform === platform)?.id ?? null,
          ...(date ? { scheduledDate: date, scheduledTime: time } : {}),
        }),
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setDate('')
      router.refresh()
    } finally { setBusy(false) }
  }

  async function recordUrl(id: string) {
    const url = (urlById[id] ?? '').trim()
    if (!url) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/ci/publications/${id}/url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ url }),
      }).then((r) => r.json() as Promise<ApiResponse<{ message: string }>>)
      if (!res.success) { setError({ code: res.error.code, message: res.error.message }); return }
      setUrlById((m) => ({ ...m, [id]: '' }))
      router.refresh()
    } finally { setBusy(false) }
  }

  return (
    <>
      <section style={{
        display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'flex-end',
        padding: 'var(--space-4)', border: 'var(--border-w-2) solid var(--border-color)',
        borderRadius: 'var(--radius)', background: 'var(--color-surface)', marginBottom: 'var(--space-6)',
      }}>
        <div>
          <label className="label" htmlFor="ci-pub-platform">플랫폼</label>
          <select className="input-field" id="ci-pub-platform" value={platform}
            onChange={(e) => setPlatform(e.target.value as CiPlatform)}>
            {CI_PLATFORMS.map((p) => <option key={p} value={p}>{CI_PLATFORM_LABEL[p]}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="ci-pub-date">예약일 (선택)</label>
          <input className="input-field" id="ci-pub-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="ci-pub-time">시각</label>
          <input className="input-field" id="ci-pub-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <button type="button" className="btn-primary" onClick={addItem} disabled={busy}>
          게시 준비 추가
        </button>
      </section>

      {error && <div style={{ marginBottom: 'var(--space-4)' }}><ErrorState code={error.code} message={error.message} helpHref="/ci/settings" /></div>}

      <p className="ci-basis" style={{ marginBottom: 'var(--space-3)' }}>
        지금은 수동 게시가 기본입니다. 플랫폼에 직접 올린 뒤 주소를 여기 붙여넣으면 그 시점부터 성과를 추적합니다.
        과거에 올린 게시물도 주소만 있으면 소급 추적됩니다.
      </p>

      {items.length === 0 ? (
        <EmptyState
          title="게시 준비 목록이 비어 있습니다"
          description="파이프라인에서 '게시 준비' 단계로 옮긴 아이디어를 여기서 내보내고, 올린 주소를 기록합니다."
          action={{ label: '파이프라인으로', href: '/ci/pipeline' }}
        />
      ) : (
        <table className="table-base table-card">
          <thead>
            <tr><th>플랫폼</th><th>상태</th><th>예약·게시</th><th>게시 주소</th><th>작업</th></tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td className="card-header">{CI_PLATFORM_LABEL[p.platform]}</td>
                <td data-label="상태">
                  <span className={p.status === 'published' ? 'ci-status ci-status-ok'
                    : p.status === 'failed' ? 'ci-status ci-status-danger' : 'ci-status ci-status-neutral'}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                  {p.error_message && <span className="error-state-code"> {p.error_code}: {p.error_message}</span>}
                </td>
                <td data-label="예약·게시">
                  {p.published_at ? formatKstDateTimeShort(p.published_at)
                    : p.scheduled_at ? formatKstDateTimeShort(p.scheduled_at)
                    : <span className="ci-basis">미정</span>}
                </td>
                <td data-label="게시 주소">
                  {p.published_url
                    ? <a href={p.published_url} target="_blank" rel="noreferrer">원본 열기</a>
                    : <span className="ci-basis">아직 없음</span>}
                </td>
                <td className="card-actions">
                  {!p.published_url && (
                    <>
                      <label className="label" htmlFor={`u-${p.id}`} style={{ position: 'absolute', left: '-9999px' }}>게시 주소</label>
                      <input className="input-field" id={`u-${p.id}`}
                        value={urlById[p.id] ?? ''}
                        onChange={(e) => setUrlById((m) => ({ ...m, [p.id]: e.target.value }))}
                        placeholder="올린 주소 붙여넣기" style={{ minWidth: '200px' }}
                      />
                      <button type="button" className="btn-primary" onClick={() => recordUrl(p.id)} disabled={busy}>
                        추적 시작
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
