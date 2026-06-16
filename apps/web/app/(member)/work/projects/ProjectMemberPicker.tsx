'use client'

import { useState, useEffect, useMemo } from 'react'
import { UserPlus, X } from 'lucide-react'
import { listProjectMemberCandidates, type MemberCandidate } from './actions'
import { initial } from '@/lib/work/project-display'

// 투입인원 다중 선택. 후보(조직 범위 person)에서 추가/제거 + role 입력.
// 부모는 selected 배열만 소유(container/presentational 분리). API 호출은 부모가 저장 시 수행.
export interface SelectedMember {
  userId: string
  name: string
  role: string | null
}

interface Props {
  selected: SelectedMember[]
  onChange: (next: SelectedMember[]) => void
}

export default function ProjectMemberPicker({ selected, onChange }: Props) {
  const [candidates, setCandidates] = useState<MemberCandidate[]>([])
  const [picking, setPicking] = useState('')

  useEffect(() => {
    let alive = true
    listProjectMemberCandidates().then((c) => { if (alive) setCandidates(c) })
    return () => { alive = false }
  }, [])

  const selectedIds = useMemo(() => new Set(selected.map((m) => m.userId)), [selected])
  const available = candidates.filter((c) => !selectedIds.has(c.userId))

  function add(userId: string) {
    const cand = candidates.find((c) => c.userId === userId)
    if (!cand) return
    onChange([...selected, { userId: cand.userId, name: cand.name, role: null }])
    setPicking('')
  }
  function remove(userId: string) {
    onChange(selected.filter((m) => m.userId !== userId))
  }
  function setRole(userId: string, role: string) {
    onChange(selected.map((m) => (m.userId === userId ? { ...m, role: role || null } : m)))
  }

  return (
    <div>
      <label className="label">투입 인원</label>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: selected.length ? 'var(--space-2)' : 0 }}>
        <select className="input-field" value={picking} onChange={(e) => add(e.target.value)}
          aria-label="인원 추가" style={{ flex: 1, minHeight: 44 }} disabled={available.length === 0}>
          <option value="">{available.length === 0 ? '추가할 인원이 없습니다' : '인원 선택해 추가…'}</option>
          {available.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
        <UserPlus size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} aria-hidden />
      </div>

      {selected.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {selected.map((m) => (
            <li key={m.userId}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2)', borderRadius: 'var(--radius)', border: 'var(--hairline) solid var(--border-color)', background: 'var(--surface-bg)' }}>
              <span aria-hidden style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: 'var(--brand)', color: 'var(--brand-fg)', fontSize: 'var(--fs-xs)', fontWeight: 700, flexShrink: 0 }}>
                {initial(m.name)}
              </span>
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text)', minWidth: 0, flex: '0 1 auto', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
              <input className="input-field" value={m.role ?? ''} onChange={(e) => setRole(m.userId, e.target.value)}
                placeholder="역할(선택)" aria-label={`${m.name} 역할`} maxLength={50}
                style={{ flex: 1, minWidth: 80, minHeight: 36, padding: 'var(--space-1) var(--space-2)' }} />
              <button type="button" onClick={() => remove(m.userId)} aria-label={`${m.name} 제거`}
                style={{ display: 'inline-flex', padding: 'var(--space-1)', borderRadius: 'var(--radius)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', color: 'var(--danger)', cursor: 'pointer', flexShrink: 0 }}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
