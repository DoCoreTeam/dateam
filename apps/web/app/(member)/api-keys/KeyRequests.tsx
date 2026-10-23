'use client'

// 키 하나의 최근 쓰기 요청 100건 (P0158 I11), 관문이 api_write_audit 에 남긴 줄
import { useEffect, useState } from 'react'
import { API_AUDIT } from '@/lib/terms'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'

interface RequestRow {
  id: number
  action_name: string
  status: number
  agent: string | null
  dry_run: boolean
  approval_id: string | null
  created_at: string
}

export default function KeyRequests({ keyId, keyName, onClose }: { keyId: string; keyName: string; onClose: () => void }) {
  const [rows, setRows] = useState<RequestRow[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let alive = true
    setRows(null)
    setFailed(false)
    fetch(`/api/user/api-keys/${keyId}/requests`)
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!alive) return
        if (res.ok && body?.success) setRows(body.data)
        else setFailed(true)
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [keyId])

  return (
    <section className="card" aria-labelledby="key-requests-title" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
        <h2 id="key-requests-title" className="tape-title" style={{ margin: 0 }}>{API_AUDIT.requestsTitle} · {keyName}</h2>
        <button type="button" className="btn-ghost" onClick={onClose}>{API_AUDIT.close}</button>
      </div>
      <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', margin: 'var(--space-1) 0 var(--space-3)' }}>{API_AUDIT.requestsHint}</p>
      {failed && <p role="alert" style={{ color: 'var(--danger)' }}>{API_AUDIT.failed}</p>}
      {!failed && rows && rows.length === 0 && <p>{API_AUDIT.empty}</p>}
      {rows && rows.length > 0 && (
        <ul aria-label={API_AUDIT.requestsTitle} style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: 'grid', gridTemplateColumns: '9rem minmax(0, 2fr) 4rem minmax(0, 1fr)', gap: 'var(--space-2)', padding: 'var(--space-2) 0', borderBottom: 'var(--hairline) solid var(--border-light)', fontSize: 'var(--fs-sm)' }}>
              <time dateTime={r.created_at} style={{ color: 'var(--text-muted)' }}>{formatKstDateTimeShort(r.created_at)}</time>
              <code style={{ overflowWrap: 'anywhere' }}>{r.action_name}{r.dry_run ? ' (dryRun)' : ''}</code>
              <span className="badge" data-status={r.status < 300 ? 'done' : r.status === 202 ? 'doing' : 'blocker'}>{r.status}</span>
              <span style={{ color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{r.agent ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
