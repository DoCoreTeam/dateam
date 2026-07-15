'use client'

// 목록 심층분석 세션 목록(§C4)의 모달·드로어 3종 — SessionListClient.tsx에서 분리(300줄 제한).
// 모달 표준(§2-2): useEscClose·X닫기·tape-title·광원형 그림자·통일 backdrop.

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useEscClose } from '@/lib/use-esc-close'
import {
  renameAnalysisSession,
  getAnalysisSession,
  type AnalysisSessionSummary,
  type AnalysisSessionDetail,
} from './session-actions'

const BACKDROP = 'var(--modal-backdrop)'
const MODAL_SHADOW = 'var(--shadow-modal)'

function ModalShell({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: BACKDROP, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: wide ? 420 : 400, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: MODAL_SHADOW, boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>{title}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** 세션 이름변경 모달(§C4 CRUD). */
export function RenameModal({ session, onClose, onRenamed }: { session: AnalysisSessionSummary; onClose: () => void; onRenamed: (title: string) => void }) {
  useEscClose(onClose)
  const [title, setTitle] = useState(session.title)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    if (busy || !title.trim()) return
    setBusy(true); setErr(null)
    const r = await renameAnalysisSession(session.id, title)
    setBusy(false)
    if (!r.ok) { setErr(r.error); return }
    onRenamed(title.trim())
  }

  return (
    <ModalShell title="세션 이름변경" onClose={onClose} wide>
      <label className="label" htmlFor="rename-title">제목</label>
      <input id="rename-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)}
        maxLength={60} autoFocus style={{ marginTop: 'var(--space-1)', marginBottom: 'var(--space-3)' }} />
      {err && <p role="alert" style={{ margin: '0 0 var(--space-3)', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</p>}
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <NbButton variant="ghost" onClick={onClose} type="button">취소</NbButton>
        <NbButton onClick={submit} disabled={busy || !title.trim()} type="button">{busy ? '저장중…' : '저장'}</NbButton>
      </div>
    </ModalShell>
  )
}

/** 삭제/되돌리기 공용 확인 모달(§C4 CRUD). */
export function ConfirmModal({ title, message, confirmLabel, danger, onClose, onConfirm }: {
  title: string; message: ReactNode; confirmLabel: string; danger?: boolean; onClose: () => void; onConfirm: () => void
}) {
  useEscClose(onClose)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    await onConfirm()
    setBusy(false)
  }

  return (
    <ModalShell title={title} onClose={onClose}>
      <p style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>{message}</p>
      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
        <NbButton variant="ghost" onClick={onClose} type="button">취소</NbButton>
        <NbButton variant={danger ? 'danger' : 'primary'} onClick={run} disabled={busy} type="button">{busy ? '처리중…' : confirmLabel}</NbButton>
      </div>
    </ModalShell>
  )
}

/**
 * 세션 상세(읽기전용) 드로어 — getAnalysisSession으로 원문·항목·결과 조회.
 * 실제 "이어서 분석"은 '새 분석' 탭의 자체 이전분석 목록(AnalyzeClient 내장)에서 진행
 * (분석 재개 로직은 그쪽 SSOT — 여기서 중복 구현하지 않음).
 */
export function SessionDetailDrawer({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  useEscClose(onClose)
  const [detail, setDetail] = useState<AnalysisSessionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    getAnalysisSession(sessionId).then((r) => {
      if (!alive) return
      if (!r.ok) { setError(r.error); setLoading(false); return }
      setDetail(r.session)
      setLoading(false)
    })
    return () => { alive = false }
  }, [sessionId])

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: BACKDROP, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: '100%', maxWidth: 520, height: '100%', background: 'var(--color-surface)', boxShadow: MODAL_SHADOW, overflowY: 'auto', padding: 'var(--space-6)', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>세션 상세</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>불러오는 중…</p>
        ) : error || !detail ? (
          <p role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error ?? '세션을 찾을 수 없습니다'}</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {detail.items.map((it) => (
              <div key={it.idx} style={{ padding: 'var(--space-3)', border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)' }}>
                <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{it.text}</p>
                {it.resultText && (
                  <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{it.resultText}</p>
                )}
                {it.status !== 'done' && (
                  <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{it.status === 'error' ? '분석 실패' : it.status === 'running' ? '분석중' : '대기중'}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
