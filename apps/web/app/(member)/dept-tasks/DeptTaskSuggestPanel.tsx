'use client'

import { useState } from 'react'
import { Sparkles, AlertTriangle } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { createDeptTasksBulk } from './actions'
import { htmlToPlain } from '@/lib/html-to-plain'
import type { DeptOption } from './DeptTasksClient'

interface Candidate {
  title: string
  assignee_hint: string | null
  priority: 'urgent' | 'high' | 'normal' | 'low'
  due_hint: string | null
  source_log_date: string
  source_quote: string | null
  confidence: number
  existing_match: string | null
}

interface Props {
  creatableDepts: DeptOption[]
  editableDeptIds: string[]
  onRegistered: () => void
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export default function DeptTaskSuggestPanel({ creatableDepts, editableDeptIds, onRegistered }: Props) {
  const [open, setOpen] = useState(false)
  const [departmentId, setDepartmentId] = useState(creatableDepts[0]?.id ?? '')
  const [weeks, setWeeks] = useState(2)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())

  async function findCandidates() {
    if (!departmentId) return
    setLoading(true); setError(''); setInfo(''); setCandidates([]); setChecked(new Set())
    try {
      const scope = editableDeptIds.includes(departmentId) ? 'dept' : 'mine'
      const res = await fetch('/api/ai/suggest-dept-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, departmentId, weeks }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? '탐색 실패'); return }
      const list = (data.candidates ?? []) as Candidate[]
      setCandidates(list)
      // 중복의심 아닌 것만 기본 선택
      setChecked(new Set(list.map((c, i) => (c.existing_match ? -1 : i)).filter((i) => i >= 0)))
      if (list.length === 0) setInfo(data.message ?? '탐색된 후보가 없습니다.')
    } catch {
      setError('탐색 중 오류가 발생했습니다.')
    } finally { setLoading(false) }
  }

  function toggle(i: number) {
    setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })
  }

  async function register() {
    const picks = candidates.filter((_, i) => checked.has(i))
    if (picks.length === 0) return
    setBusy(true); setError('')
    try {
      const res = await createDeptTasksBulk(picks.map((c) => ({
        content: c.title,
        departmentId,
        priority: c.priority,
        targetDate: c.due_hint && ISO.test(c.due_hint) ? c.due_hint : null,
      })))
      if (!res.ok) { setError(res.error); return }
      setInfo(`${res.created}개 등록 완료${res.failed ? ` · ${res.failed}개 실패` : ''}`)
      setCandidates([]); setChecked(new Set())
      onRegistered()
    } catch {
      setError('등록 중 오류가 발생했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--brand)', fontWeight: 600, minHeight: 44, width: '100%', justifyContent: 'flex-start' }}>
        <Sparkles size={16} /> 부서업무 탐색
      </button>

      {open && (
        <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)' }}>
            <div>
              <label className="label">부서</label>
              <select className="input-field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ minHeight: 44 }}>
                {creatableDepts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">기간</label>
              <select className="input-field" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ minHeight: 44 }}>
                <option value={1}>최근 1주</option>
                <option value={2}>최근 2주</option>
                <option value={3}>최근 3주</option>
                <option value={4}>최근 4주</option>
              </select>
            </div>
          </div>
          <div>
            <NbButton onClick={findCandidates} disabled={loading || !departmentId}>
              {loading ? '탐색 중…' : '✨ 탐색 시작'}
            </NbButton>
            <span style={{ marginLeft: 'var(--space-3)', color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
              일일업무·주간보고에서 탐색 (부서장=부서원 전체)
            </span>
          </div>

          {error && <p role="alert" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
          {info && <p role="status" style={{ color: 'var(--text-muted)', margin: 0 }}>{info}</p>}

          {candidates.length > 0 && (
            <>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {candidates.map((c, i) => (
                  <li key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', padding: 'var(--space-2) var(--space-3)', background: 'var(--surface-bg)', borderRadius: 'var(--radius)' }}>
                    <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} style={{ marginTop: 4 }} aria-label={`${c.title} 선택`} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <strong>{c.title}</strong>
                        {c.existing_match && (
                          <span title={`유사: ${c.existing_match}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 2, color: 'var(--warning)', fontSize: 'var(--fs-xs)' }}>
                            <AlertTriangle size={12} /> 중복의심
                          </span>
                        )}
                        <span style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-xs)' }}>신뢰도 {Math.round(c.confidence * 100)}%</span>
                      </div>
                      <div title={htmlToPlain(c.source_quote)} style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        근거({c.source_log_date}): {htmlToPlain(c.source_quote)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div>
                <NbButton onClick={register} disabled={busy || checked.size === 0}>
                  {busy ? '등록 중…' : `선택 ${checked.size}개 부서업무로 등록`}
                </NbButton>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
