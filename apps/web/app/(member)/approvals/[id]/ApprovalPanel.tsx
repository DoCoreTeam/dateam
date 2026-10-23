'use client'

// 승인 요청 한 건, 결정 단추는 기다리는 중일 때만 (P0158 I08)
import { useState } from 'react'
import { useAskDialog } from '@/components/ui/useAskDialog'
import { API_APPROVAL, API_APPROVAL_ERROR, API_APPROVAL_STATUS, API_KEY_SCOPE } from '@/lib/terms'
import type { Scope } from '@/lib/actions/types'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { decideApprovalAction } from './actions'

export interface ApprovalView {
  id: string
  action: string
  requiredScope: Scope
  method: string
  path: string
  payload: string
  status: string
  resultStatus: number | null
  createdAt: string
  expiresAt: string
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(7rem, 10rem) minmax(0, 1fr)', gap: 'var(--space-3)', padding: 'var(--space-2) 0', borderBottom: 'var(--hairline) solid var(--border-light)' }}>
      <dt style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{label}</dt>
      <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{children}</dd>
    </div>
  )
}

export default function ApprovalPanel({ view }: { view: ApprovalView | null }) {
  const { ask, dialog } = useAskDialog()
  const [state, setState] = useState(view)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!state) return <div className="card" role="alert" style={{ padding: 'var(--space-5)' }}>{API_APPROVAL.notFound}</div>

  async function decide(decision: 'approve' | 'reject') {
    if (!state) return
    if (decision === 'approve' && !await ask.confirm({ title: API_APPROVAL.confirmTitle, body: `${state.action} (${state.requiredScope}). ${API_APPROVAL.confirmBody}`, confirmLabel: API_APPROVAL.approve, danger: true })) return
    setBusy(true)
    setError(null)
    try {
      const r = await decideApprovalAction(state.id, decision)
      if (r.ok) setState({ ...state, status: r.status, resultStatus: r.resultStatus ?? null })
      else setError(API_APPROVAL_ERROR[r.code] ?? API_APPROVAL_ERROR.invalid)
    } catch {
      setError(API_APPROVAL_ERROR.invalid)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" style={{ padding: 'var(--space-5)' }} aria-labelledby="approval-action">
      <dl style={{ margin: 0 }}>
        <Row label={API_APPROVAL.action}><code id="approval-action">{state.action}</code></Row>
        <Row label={API_APPROVAL.requiredScope}><code>{state.requiredScope}</code> {API_KEY_SCOPE[state.requiredScope]}</Row>
        <Row label={API_APPROVAL.path}><code>{state.method} {state.path}</code></Row>
        {state.payload && <Row label={API_APPROVAL.payload}><pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 'var(--fs-xs)' }}>{state.payload}</pre></Row>}
        <Row label={API_APPROVAL.requestedAt}>{formatKstDateTimeExact(state.createdAt)}</Row>
        <Row label={API_APPROVAL.expiresAt}>{formatKstDateTimeExact(state.expiresAt)}</Row>
        <Row label={API_APPROVAL.status}><span className="badge" data-status={state.status === 'APPROVED' ? 'done' : state.status === 'PENDING' ? 'doing' : 'blocker'}>{API_APPROVAL_STATUS[state.status] ?? state.status}</span></Row>
        {state.resultStatus !== null && <Row label={API_APPROVAL.resultStatus}>{state.resultStatus}</Row>}
      </dl>
      {error && <p role="alert" style={{ color: 'var(--danger)', margin: 'var(--space-3) 0 0' }}>{error}</p>}
      {state.status === 'PENDING' && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => decide('reject')}>{API_APPROVAL.reject}</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => decide('approve')}>{API_APPROVAL.approve}</button>
        </div>
      )}
      {dialog}
    </section>
  )
}
