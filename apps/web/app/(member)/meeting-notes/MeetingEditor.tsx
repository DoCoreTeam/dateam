'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ArrowLeft, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import TiptapEditor from '@/components/ui/TiptapEditor'
import { createMeetingNote, updateMeetingNote, deleteMeetingNote } from './actions'

export interface MeetingNoteDraft {
  id?: string
  title: string
  meeting_at: string | null
  attendees: string
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

export default function MeetingEditor({ initial, mode }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [meetingAtLocal, setMeetingAtLocal] = useState(isoToLocalInput(initial.meeting_at))
  const [attendees, setAttendees] = useState(initial.attendees)
  const [tagsInput, setTagsInput] = useState(initial.tags.join(', '))
  const [body, setBody] = useState(initial.body)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()

  function splitCsv(raw: string): string[] {
    return raw.split(',').map((t) => t.trim()).filter(Boolean)
  }

  function save() {
    if (!title.trim()) {
      setError('제목을 입력해 주세요.')
      return
    }
    setError('')
    const attendeeList = splitCsv(attendees)
    const input = {
      title: title.trim(),
      meeting_at: localInputToIso(meetingAtLocal),
      attendees: attendeeList.length > 0 ? attendeeList : null,
      tags: splitCsv(tagsInput),
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
            <label className="label" htmlFor="mn-attendees">참석자</label>
            <input id="mn-attendees" className="input-field"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="쉼표로 구분 (예: 김도현, 이수민)"
              style={{ minHeight: 44 }}
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="mn-tags">태그</label>
          <input id="mn-tags" className="input-field"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            placeholder="쉼표로 구분 (예: 가격정책, GPU)"
            style={{ minHeight: 44 }}
          />
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
