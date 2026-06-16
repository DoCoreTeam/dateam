'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useEscClose } from '@/lib/use-esc-close'
import {
  PROJECT_STATUS_OPTIONS, CURRENCY_OPTIONS, type ProjectMeta,
} from '@/lib/work/project-display'
import ProjectMemberPicker, { type SelectedMember } from './ProjectMemberPicker'

// 프로젝트 생성/수정 공용 모달. 이름 + 날짜체계 + 기간 + 예산/통화 + 상태 + 투입인원.
// mode='create'→POST /api/projects, 'edit'→PATCH + 멤버 diff(add/delete). 모달 표준(§2-2) 준수.
interface Props {
  mode: 'create' | 'edit'
  projectId?: string
  initial?: { name: string } & ProjectMeta
  onClose: () => void
  onSaved: () => void
}

const NAME_MAX = 200
const QUARTERS = [1, 2, 3, 4]
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

interface FormState {
  name: string
  year: string
  quarter: string
  half: string
  month: string
  startDate: string
  endDate: string
  budget: string
  currency: string
  status: string
}

function toForm(initial?: Props['initial']): FormState {
  return {
    name: initial?.name ?? '',
    year: initial?.year != null ? String(initial.year) : '',
    quarter: initial?.quarter != null ? String(initial.quarter) : '',
    half: initial?.half ?? '',
    month: initial?.month != null ? String(initial.month) : '',
    startDate: initial?.start_date ?? '',
    endDate: initial?.end_date ?? '',
    budget: initial?.budget != null ? String(initial.budget) : '',
    currency: initial?.currency ?? 'KRW',
    status: initial?.status ?? 'active',
  }
}

// 폼 → API payload(메타 키는 null 허용 = 값 해제). 빈 문자열은 null.
function toPayload(f: FormState): Record<string, unknown> {
  const numOrNull = (v: string) => (v.trim() === '' ? null : Number(v))
  const strOrNull = (v: string) => (v.trim() === '' ? null : v)
  return {
    name: f.name.trim(),
    year: numOrNull(f.year),
    quarter: numOrNull(f.quarter),
    half: strOrNull(f.half),
    month: numOrNull(f.month),
    start_date: strOrNull(f.startDate),
    end_date: strOrNull(f.endDate),
    budget: numOrNull(f.budget),
    currency: f.currency,
    status: f.status,
  }
}

export default function ProjectFormModal({ mode, projectId, initial, onClose, onSaved }: Props) {
  useEscClose(onClose)
  const [form, setForm] = useState<FormState>(() => toForm(initial))
  const [members, setMembers] = useState<SelectedMember[]>([])
  const [initialMemberIds, setInitialMemberIds] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  // 편집 모드: 기존 멤버 로드(GET 단건). 생성 모드는 빈 상태.
  useEffect(() => {
    if (mode !== 'edit' || !projectId) return
    let alive = true
    fetch(`/api/projects/${projectId}`).then((r) => (r.ok ? r.json() : null)).then((data) => {
      if (!alive || !data?.members) return
      const ms: SelectedMember[] = data.members.map((m: { user_id: string; name: string; role: string | null }) =>
        ({ userId: m.user_id, name: m.name, role: m.role }))
      setMembers(ms)
      setInitialMemberIds(new Set(ms.map((m) => m.userId)))
    })
    return () => { alive = false }
  }, [mode, projectId])

  // 멤버 동기화 — 현재 선택 전체를 upsert(POST 멱등: role 갱신 포함) + 제거된 멤버만 DELETE.
  async function syncMembers(id: string) {
    const currentIds = new Set(members.map((m) => m.userId))
    const toRemove = Array.from(initialMemberIds).filter((uid) => !currentIds.has(uid))
    await Promise.all([
      ...members.map((m) =>
        fetch(`/api/projects/${id}/members`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: m.userId, role: m.role }),
        })),
      ...toRemove.map((uid) =>
        fetch(`/api/projects/${id}/members/${uid}`, { method: 'DELETE' })),
    ])
  }

  async function save() {
    const trimmed = form.name.trim()
    if (!trimmed) { setErr('프로젝트 이름은 필수입니다'); return }
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const url = mode === 'create' ? '/api/projects' : `/api/projects/${projectId}`
      const res = await fetch(url, {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toPayload(form)),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        setErr(j?.error ?? '저장에 실패했습니다'); setBusy(false); return
      }
      const saved = await res.json().catch(() => null)
      const id = mode === 'create' ? saved?.id : projectId
      if (id) await syncMembers(id)
      onSaved()
    } catch {
      setErr('서버 연결에 실패했습니다'); setBusy(false)
    }
  }

  return (
    <div onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}>
      <div style={{ width: '100%', maxWidth: 520, background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: 'var(--space-6)', boxShadow: 'var(--shadow-modal)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h3 className="tape-title" style={{ margin: 0 }}>{mode === 'create' ? '프로젝트 추가' : '프로젝트 수정'}</h3>
          <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-faint)' }}><X size={18} /></button>
        </div>

        {err && (
          <div role="alert" style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', marginBottom: '0.75rem', fontSize: 'var(--fs-sm)', color: 'var(--danger)' }}>{err}</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <label className="label" htmlFor="project-name">프로젝트 이름 *</label>
            <input id="project-name" className="input-field" value={form.name} maxLength={NAME_MAX} autoFocus
              onChange={(e) => set('name', e.target.value)} placeholder="예: 2026 상반기 GPU 도입" style={{ minHeight: 44 }} />
          </div>

          <fieldset style={{ border: 'var(--hairline) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-3)', margin: 0 }}>
            <legend style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-muted)', padding: '0 var(--space-1)' }}>기간 (선택 — 연도+분기만 골라도 됩니다)</legend>
            <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-3)' }}>
              <div>
                <label className="label" htmlFor="project-year">연도</label>
                <input id="project-year" className="input-field" type="number" inputMode="numeric" min={1900} max={9999}
                  value={form.year} onChange={(e) => set('year', e.target.value)} placeholder="2026" style={{ minHeight: 44 }} />
              </div>
              <div>
                <label className="label" htmlFor="project-quarter">분기</label>
                <select id="project-quarter" className="input-field" value={form.quarter} onChange={(e) => set('quarter', e.target.value)} style={{ minHeight: 44 }}>
                  <option value="">미지정</option>
                  {QUARTERS.map((q) => <option key={q} value={q}>{q}분기</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="project-half">반기</label>
                <select id="project-half" className="input-field" value={form.half} onChange={(e) => set('half', e.target.value)} style={{ minHeight: 44 }}>
                  <option value="">미지정</option>
                  <option value="H1">상반기</option>
                  <option value="H2">하반기</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="project-month">월</label>
                <select id="project-month" className="input-field" value={form.month} onChange={(e) => set('month', e.target.value)} style={{ minHeight: 44 }}>
                  <option value="">미지정</option>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="project-start">시작일</label>
                <input id="project-start" className="input-field" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} style={{ minHeight: 44 }} />
              </div>
              <div>
                <label className="label" htmlFor="project-end">종료일</label>
                <input id="project-end" className="input-field" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} style={{ minHeight: 44 }} />
              </div>
            </div>
          </fieldset>

          <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-3)' }}>
            <div>
              <label className="label" htmlFor="project-budget">예산</label>
              <input id="project-budget" className="input-field" type="number" inputMode="numeric" min={0}
                value={form.budget} onChange={(e) => set('budget', e.target.value)} placeholder="0" style={{ minHeight: 44 }} />
            </div>
            <div>
              <label className="label" htmlFor="project-currency">통화</label>
              <select id="project-currency" className="input-field" value={form.currency} onChange={(e) => set('currency', e.target.value)} style={{ minHeight: 44 }}>
                {CURRENCY_OPTIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="project-status">상태</label>
            <select id="project-status" className="input-field" value={form.status} onChange={(e) => set('status', e.target.value)} style={{ minHeight: 44 }}>
              {PROJECT_STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>

          <ProjectMemberPicker selected={members} onChange={setMembers} />
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: '1.25rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>취소</button>
          <button onClick={save} disabled={busy} data-testid="save-project" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--brand-fg)', background: 'var(--brand)', border: 'none', borderRadius: 'var(--radius)', padding: 'var(--space-2) var(--space-5)', cursor: busy ? 'wait' : 'pointer' }}>{busy ? '저장중' : '저장'}</button>
        </div>
      </div>
    </div>
  )
}
