'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ArrowLeft, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import TiptapEditor from '@/components/ui/TiptapEditor'
import { createMeetingNote, updateMeetingNote, deleteMeetingNote, getMeetingDepartments } from './actions'

export interface MeetingNoteDraft {
  id?: string
  title: string
  meeting_at: string | null
  department_id: string | null
  tags: string[]
  body: string // HTML
}

interface Props {
  initial: MeetingNoteDraft
  mode: 'create' | 'edit'
}

// datetime-local 값(YYYY-MM-DDTHH:mm) ↔ ISO 상호 변환.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// 작성 순간(현재 일시)을 datetime-local 기본값으로.
function nowLocalInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MeetingEditor({ initial, mode }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [meetingAtLocal, setMeetingAtLocal] = useState(
    initial.meeting_at ? isoToLocalInput(initial.meeting_at) : mode === 'create' ? nowLocalInput() : ''
  )
  const [departmentId, setDepartmentId] = useState(initial.department_id ?? '')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [body, setBody] = useState(initial.body)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()

  // 부서 선택지 — 클라이언트 마운트 시 1회 로드(목록이 비어도 '부서 없음'은 항상 선택 가능)
  useEffect(() => {
    let alive = true
    getMeetingDepartments()
      .then((rows) => { if (alive) setDepartments(rows) })
      .catch(() => { /* best effort — 부서 로드 실패가 작성 흐름을 막지 않음 */ })
    return () => { alive = false }
  }, [])

  function save() {
    if (!title.trim()) {
      setError('제목을 입력해 주세요.')
      return
    }
    setError('')
    const input = {
      title: title.trim(),
      meeting_at: localInputToIso(meetingAtLocal),
      department_id: departmentId || null,
      body_html: body,
    }
    startTransition(async () => {
      try {
        if (mode === 'create') {
          const res = await createMeetingNote(input)
          if (!res.ok) { setError(res.error); return }
          router.push(`/meeting-notes/${res.id}`)
        } else if (initial.id) {
          const res = await updateMeetingNote(initial.id, input)
          if (!res.ok) { setError(res.error); return }
          router.push(`/meeting-notes/${initial.id}`)
          router.refresh()
        }
      } catch {
        setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      }
    })
  }

  function remove() {
    if (!initial.id) return
    if (!confirm(`회의노트 "${title || '(제목 없음)'}"을(를) 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return
    startDelete(async () => {
      try {
        const res = await deleteMeetingNote(initial.id!)
        if (!res.ok) { setError(res.error); return }
        router.push('/meeting-notes')
        router.refresh()
      } catch {
        setError('삭제에 실패했습니다.')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      {error && (
        <p role="alert" style={{ margin: 0, padding: 'var(--space-3) var(--space-4)', background: 'var(--danger-bg)', border: 'var(--hairline) solid var(--danger-border)', borderRadius: 'var(--radius)', color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>
          {error}
        </p>
      )}

      <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <div>
          <label className="label" htmlFor="mn-title">제목</label>
          <input id="mn-title" className="input-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2분기 GPU 가격 전략 회의"
            style={{ minHeight: 44 }}
          />
        </div>

        <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)' }}>
          <div>
            <label className="label" htmlFor="mn-at">회의일시</label>
            <input id="mn-at" type="datetime-local" className="input-field"
              value={meetingAtLocal}
              onChange={(e) => setMeetingAtLocal(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </div>
          <div>
            <label className="label" htmlFor="mn-dept">부서</label>
            <select id="mn-dept" className="input-field"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              style={{ minHeight: 44 }}
            >
              <option value="">부서 없음</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">본문</label>
          <TiptapEditor value={body} onChange={setBody} placeholder="회의 내용을 입력하세요" minHeight={280} />
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <NbButton variant="ghost" onClick={() => router.back()} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <ArrowLeft size={15} /> 취소
        </NbButton>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {mode === 'edit' && (
            <NbButton variant="danger" onClick={remove} disabled={deleting || pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <Trash2 size={15} /> {deleting ? '삭제 중…' : '삭제'}
            </NbButton>
          )}
          <NbButton onClick={save} disabled={pending || deleting} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Save size={15} /> {pending ? '저장 중…' : mode === 'create' ? '작성 완료' : '변경 저장'}
          </NbButton>
        </div>
      </div>
    </div>
  )
}
