// 프로젝트 저장 이력 드로어 (A). 성공/실패/부분 전부 타임라인으로 표시하고,
// 성공 시 저장값(after) 스냅샷·실패 시 원인(error_detail)을 펼쳐 본다.
'use client'

import { useEffect, useState } from 'react'
import { X, History, AlertTriangle } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import {
  ACTIVITY_ACTION_LABEL, ACTIVITY_STATUS_LABEL,
  type ProjectActivityRow, type ProjectActivityStatus,
} from '@/lib/work/project-activity'

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
}

const STATUS_STYLE: Record<ProjectActivityStatus, { color: string; bg: string; border: string }> = {
  success: { color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  failure: { color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  partial: { color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
}

export default function ProjectActivityDrawer({ projectId, projectName, onClose }: Props) {
  useEscClose(onClose)
  const [items, setItems] = useState<ProjectActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}/activity`, { cache: 'no-store' })
        if (!res.ok) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? '불러오기 실패') }
        const j = await res.json()
        if (alive) setItems((j.items ?? []) as ProjectActivityRow[])
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '이력을 불러오지 못했습니다')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [projectId])

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', justifyContent: 'flex-end' }}>
      <div role="dialog" aria-label={`${projectName} 저장 이력`}
        style={{ width: '100%', maxWidth: 460, height: '100%', background: 'var(--color-surface)', boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-4) var(--space-5)', borderBottom: 'var(--border-w-2) solid var(--border-color)' }}>
          <History size={18} style={{ color: 'var(--brand)' }} />
          <h3 className="tape-title" style={{ margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectName} · 이력</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4) var(--space-5)' }}>
          {loading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', textAlign: 'center', padding: 'var(--space-6)' }}>불러오는 중…</p>
          ) : error ? (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3)', borderRadius: 'var(--radius)', border: 'var(--border-w-2) solid var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
              <AlertTriangle size={16} /> {error}
            </div>
          ) : items.length === 0 ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)', textAlign: 'center', padding: 'var(--space-6)' }}>아직 기록된 이력이 없습니다.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {items.map((it) => {
                const st = STATUS_STYLE[it.status]
                return (
                  <li key={it.id} style={{ borderLeft: `3px solid ${st.color}`, paddingLeft: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>{ACTIVITY_ACTION_LABEL[it.action] ?? it.action}</span>
                      <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: st.color, background: st.bg, border: `var(--hairline) solid ${st.border}`, borderRadius: '9999px', padding: '1px 8px' }}>
                        {ACTIVITY_STATUS_LABEL[it.status] ?? it.status}
                      </span>
                      <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{formatKstDateTimeShort(it.occurred_at)}</span>
                    </div>

                    {it.error_detail?.message && (
                      <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger)' }}>⚠ {it.error_detail.message}</p>
                    )}
                    {it.evidence && Object.keys(it.evidence).length > 0 && (
                      <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)' }}>
                        {Object.entries(it.evidence).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                      </p>
                    )}
                    {it.after_snapshot && (
                      <details style={{ marginTop: 4 }}>
                        <summary style={{ fontSize: 'var(--fs-2xs)', color: 'var(--brand)', cursor: 'pointer' }}>저장된 값 보기</summary>
                        <pre style={{ margin: '4px 0 0', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)', padding: 'var(--space-2)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                          {JSON.stringify(it.after_snapshot, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
