'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@/lib/swr-config'

// 일일업무 행 → 부서업무로 1클릭 승격(참조). 부서 선택 후 /api/work/promote 호출.
export default function PromoteToDeptButton({ logId, onToast }: { logId: string; onToast?: (msg: string, type?: 'success' | 'error') => void }) {
  const [open, setOpen] = useState(false)
  const [deptId, setDeptId] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const { data } = useSWR<{ departments: { id: string; name: string }[] }>(open ? '/api/work/departments' : null, fetcher)
  const depts = data?.departments ?? []

  async function promote() {
    const target = deptId || depts[0]?.id
    if (!target) { onToast?.('등록 가능한 부서가 없습니다', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/work/promote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceLogId: logId, departmentId: target }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) { onToast?.(j.error ?? '승격 실패', 'error'); return }
      setDone(true); setOpen(false)
      onToast?.('부서업무로 승격되었습니다')
    } finally { setBusy(false) }
  }

  if (done) return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--brand)', fontWeight: 700 }} title="부서업무로 승격됨">↗ 승격됨</span>

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        data-testid={`promote-btn-${logId}`}
        onClick={() => setOpen((v) => !v)}
        title="부서업무로 승격"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', padding: '0.2rem 0.35rem' }}
      >↗ 승격</button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', zIndex: 30, marginTop: 4,
          background: 'var(--color-bg)', border: 'var(--border-w-2) solid var(--border-color)',
          borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-md)', padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', minWidth: 200,
        }}>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>부서업무로 승격(원본 유지)</span>
          <select className="input-field" value={deptId} onChange={(e) => setDeptId(e.target.value)} style={{ fontSize: 'var(--fs-sm)' }}>
            {depts.length === 0 && <option value="">부서 로딩…</option>}
            {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 'var(--space-1)', justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={{ fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--border-color)', background: 'var(--surface-bg)', color: 'var(--text-muted)', cursor: 'pointer' }}>취소</button>
            <button data-testid={`promote-confirm-${logId}`} onClick={promote} disabled={busy} style={{ fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--brand)', background: 'var(--brand)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{busy ? '승격 중…' : '승격'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
