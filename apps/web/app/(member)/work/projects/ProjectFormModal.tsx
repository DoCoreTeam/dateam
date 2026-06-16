'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'

// 프로젝트 생성/수정 공용 모달. mode='create'면 POST, 'edit'면 PATCH. 모달 표준(§2-2) 준수.
interface Props {
  mode: 'create' | 'edit'
  initialName?: string
  projectId?: string
  onClose: () => void
  onSaved: () => void
}

const NAME_MAX = 200

export default function ProjectFormModal({ mode, initialName = '', projectId, onClose, onSaved }: Props) {
  useEscClose(onClose)
  const [name, setName] = useState(initialName)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) { setErr('프로젝트 이름은 필수입니다'); return }
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const url = mode === 'create' ? '/api/projects' : `/api/projects/${projectId}`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setErr(j?.error ?? '저장에 실패했습니다'); setBusy(false); return
      }
      onSaved()
    } catch {
      setErr('서버 연결에 실패했습니다'); setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>{mode === 'create' ? '프로젝트 추가' : '프로젝트 수정'}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {err && (
          <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</div>
        )}

        <label className="label" htmlFor="project-name">프로젝트 이름</label>
        <input id="project-name" className="input-field" value={name} maxLength={NAME_MAX} autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          placeholder="예: 2026 상반기 GPU 도입" />

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
          <button onClick={save} disabled={busy} style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: busy ? 'wait' : 'pointer' }}>{busy ? '저장중' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
