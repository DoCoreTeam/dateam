// 프로젝트 저장 이력 드로어 (A). 성공/실패/부분 전부 타임라인으로 표시하고,
// 성공 시 저장값(after) 스냅샷·실패 시 원인(error_detail)을 펼쳐 본다.
'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { X, History, AlertTriangle, Undo2 } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { restoreProject } from '@/lib/work/restore-action'
import { diffSnapshots } from '@/lib/work/activity-diff'
import {
  ACTIVITY_ACTION_LABEL, ACTIVITY_STATUS_LABEL,
  type ProjectActivityRow, type ProjectActivityStatus,
} from '@/lib/work/project-activity'

interface Props {
  projectId: string
  projectName: string
  onClose: () => void
  onRestored?: () => void   // 되살리기 성공 시 부모 프로젝트 목록(SWR) 재검증 — 화면 실시간 반영
}

const STATUS_STYLE: Record<ProjectActivityStatus, { color: string; bg: string; border: string }> = {
  success: { color: 'var(--success)', bg: 'var(--success-bg)', border: 'var(--success-border)' },
  failure: { color: 'var(--danger)', bg: 'var(--danger-bg)', border: 'var(--danger-border)' },
  partial: { color: 'var(--warning)', bg: 'var(--warning-bg)', border: 'var(--warning-border)' },
}

export default function ProjectActivityDrawer({ projectId, projectName, onClose, onRestored }: Props) {
  useEscClose(onClose)
  const router = useRouter()
  const [items, setItems] = useState<ProjectActivityRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null)
  const [, startRestore] = useTransition()

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
  }, [projectId, reloadKey])

  // 되돌리기 — restoreProject 후 드로어 이력 + 화면(프로젝트 목록) 실시간 갱신.
  function handleRestore(activityId: string) {
    if (restoring) return
    setRestoring(activityId); setRestoreMsg(null)
    startRestore(async () => {
      const res = await restoreProject(activityId)
      if (res.ok) { setRestoreMsg('되살렸습니다.'); setReloadKey((k) => k + 1); router.refresh(); onRestored?.() }
      else setRestoreMsg(res.error)
      setRestoring(null)
    })
  }

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
          {restoreMsg && (
            <div role="status" style={{ marginBottom: 'var(--space-3)', padding: '0.5rem 0.8rem', borderRadius: 'var(--radius)', background: 'var(--brand-soft)', border: 'var(--hairline) solid var(--brand)', color: 'var(--brand)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
              {restoreMsg}
            </div>
          )}
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
                    {(() => {
                      const changes = diffSnapshots(it.action, it.before_snapshot, it.after_snapshot)
                      if (changes.length === 0) return null
                      const isUpd = it.action === 'update'
                      return (
                        <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          {changes.map((c) => (
                            <li key={c.field} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
                              <span style={{ flexShrink: 0, fontWeight: 700, color: 'var(--text-muted)', minWidth: 56 }}>{c.label}</span>
                              {isUpd ? (
                                <span style={{ minWidth: 0, color: 'var(--text)' }}>
                                  <span style={{ color: 'var(--text-faint)', textDecoration: 'line-through' }}>{c.from ?? '없음'}</span>
                                  <span style={{ margin: '0 6px', color: 'var(--brand)', fontWeight: 700 }}>→</span>
                                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{c.to ?? '없음'}</span>
                                </span>
                              ) : (
                                <span style={{ minWidth: 0, color: 'var(--text)' }}>{(it.action === 'delete' ? c.from : c.to) ?? '없음'}</span>
                              )}
                            </li>
                          ))}
                        </ul>
                      )
                    })()}

                    {it.status === 'success' && it.before_snapshot && (it.action === 'update' || it.action === 'delete') && (
                      <button type="button" onClick={() => handleRestore(it.id)} disabled={restoring === it.id}
                        title="이 시점 상태로 되살립니다"
                        style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 'var(--radius)', background: 'var(--surface-bg)', color: 'var(--brand)', border: 'var(--hairline) solid var(--brand)', cursor: restoring === it.id ? 'wait' : 'pointer', fontSize: 'var(--fs-2xs)', fontWeight: 700 }}>
                        <Undo2 size={12} /> {restoring === it.id ? '되살리는 중…' : '되살리기'}
                      </button>
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
