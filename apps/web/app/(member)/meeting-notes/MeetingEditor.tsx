'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Save, ArrowLeft, Trash2, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import TiptapEditor from '@/components/ui/TiptapEditor'
import AttendeesEditor, { type MemberChip } from './AttendeesEditor'
import { createMeetingNote, updateMeetingNote, deleteMeetingNote, getMeetingDepartments, getMyDefaultDepartmentId, listOrgPeople, getOrgTreeForPicker } from './actions'
import type { OrgPickerNode } from '@/components/ui/OrgPeoplePicker'

export interface MeetingNoteDraft {
  id?: string
  title: string
  meeting_at: string | null
  department_id: string | null
  tags: string[]
  body: string // HTML
  summary?: string
  decisions?: string
  attendees?: string[] // 이름(조직원 + 외부)
  attendeeUserIds?: string[] // 조직원 id
}

interface Props {
  initial: MeetingNoteDraft
  mode: 'create' | 'edit'
  // 편집 종료 콜백(조회 화면이 편집모드를 끄도록) — 저장 성공/취소 시 호출. create 모드는 미사용.
  onExit?: () => void
}

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

function nowLocalInput(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function MeetingEditor({ initial, mode, onExit }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [meetingAtLocal, setMeetingAtLocal] = useState(
    initial.meeting_at ? isoToLocalInput(initial.meeting_at) : mode === 'create' ? nowLocalInput() : ''
  )
  const [departmentId, setDepartmentId] = useState(initial.department_id ?? '')
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([])
  const [people, setPeople] = useState<{ id: string; name: string }[]>([])
  const [orgTree, setOrgTree] = useState<OrgPickerNode[]>([])
  const [body, setBody] = useState(initial.body)
  const [summary, setSummary] = useState(initial.summary ?? '')
  const [decisions, setDecisions] = useState(initial.decisions ?? '')
  const [tags, setTags] = useState<string[]>(initial.tags ?? [])
  const [tagInput, setTagInput] = useState('')
  const [members, setMembers] = useState<MemberChip[]>([])
  const [externals, setExternals] = useState<string[]>([])
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [deleting, startDelete] = useTransition()

  // 부서 + 조직원 선택지 로드. 조직원 로드 후 초기 참석자 칩(조직원/외부) 분류.
  const initAttendees = useMemo(() => initial.attendees ?? [], [initial.attendees])
  const initUserIds = useMemo(() => initial.attendeeUserIds ?? [], [initial.attendeeUserIds])
  useEffect(() => {
    let alive = true
    getMeetingDepartments().then((rows) => {
      if (!alive) return
      setDepartments(rows)
      // 새 회의노트: 부서 미지정이면 작성자 본인 부서를 기본값으로(목록에 존재할 때만).
      if (mode === 'create' && !initial.department_id) {
        getMyDefaultDepartmentId().then((deptId) => {
          if (alive && deptId && rows.some((r) => r.id === deptId)) {
            setDepartmentId((prev) => prev || deptId)
          }
        }).catch(() => {})
      }
    }).catch(() => {})
    listOrgPeople().then((rows) => {
      if (!alive) return
      setPeople(rows)
      getOrgTreeForPicker().then((t) => { if (alive) setOrgTree(t) }).catch(() => {})
      // user_ids=조직원 SSOT. 그 외 attendees 이름은 외부로 분류.
      const byId = new Map(rows.map((p) => [p.id, p.name] as const))
      const mem: MemberChip[] = []
      const memNames = new Set<string>()
      for (const id of initUserIds) {
        const name = byId.get(id)
        if (name) { mem.push({ id, name }); memNames.add(name) }
      }
      setMembers(mem)
      setExternals(initAttendees.filter((n) => !memNames.has(n)))
    }).catch(() => {})
    return () => { alive = false }
  }, [initAttendees, initUserIds, mode, initial.department_id])

  function addTag() {
    const t = tagInput.trim().replace(/^#/, '')
    if (!t || tags.includes(t)) { setTagInput(''); return }
    setTags((prev) => [...prev, t])
    setTagInput('')
  }

  function save() {
    if (!title.trim()) { setError('제목을 입력해 주세요.'); return }
    setError('')
    const attendeeNames = [...members.map((m) => m.name), ...externals]
    const attendeeUserIds = members.map((m) => m.id)
    const base = {
      title: title.trim(),
      meeting_at: localInputToIso(meetingAtLocal),
      department_id: departmentId || null,
      body_html: body,
      tags: tags.length > 0 ? tags : null,
      attendees: attendeeNames.length > 0 ? attendeeNames : null,
      attendee_user_ids: attendeeUserIds.length > 0 ? attendeeUserIds : null,
    }
    startTransition(async () => {
      try {
        // 본문이 실제 바뀐 경우에만 저장 후 자동 AI 분석(?analyze=1) — 토큰 낭비 방지.
        const bodyChanged = mode === 'create' ? body.trim().length > 0 : body !== initial.body
        const analyzeQs = bodyChanged ? '?analyze=1' : ''
        if (mode === 'create') {
          const res = await createMeetingNote(base)
          if (!res.ok) { setError(res.error); return }
          router.push(`/meeting-notes/${res.id}${analyzeQs}`)
        } else if (initial.id) {
          // 편집은 요약·결정사항까지 한 번에 저장(에디터가 모든 필드의 단일 수정면).
          const res = await updateMeetingNote(initial.id, { ...base, summary: summary.trim() || null, decisions: decisions.trim() || null })
          if (!res.ok) { setError(res.error); return }
          // 본문 변경 시에만 ?analyze=1로 자동 재분석. 저장 후 편집모드 종료 → 조회 화면 복귀.
          router.push(`/meeting-notes/${initial.id}${analyzeQs}`)
          router.refresh()
          onExit?.()
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
          <input id="mn-title" className="input-field" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 2분기 GPU 가격 전략 회의" style={{ minHeight: 44 }} />
        </div>

        <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)' }}>
          <div>
            <label className="label" htmlFor="mn-at">회의일시</label>
            <input id="mn-at" type="datetime-local" className="input-field" value={meetingAtLocal}
              onChange={(e) => setMeetingAtLocal(e.target.value)} style={{ minHeight: 44 }} />
          </div>
          <div>
            <label className="label" htmlFor="mn-dept">부서</label>
            <select id="mn-dept" className="input-field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={{ minHeight: 44 }}>
              <option value="">부서 없음</option>
              {departments.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">본문</label>
          <TiptapEditor value={body} onChange={setBody} placeholder="회의 내용을 입력하세요" minHeight={280} />
        </div>

        {/* 요약·결정사항 — 편집 화면에서만(작성 시엔 AI가 채움). 에디터가 모든 필드의 단일 수정면. */}
        {mode === 'edit' && (
          <>
            <div>
              <label className="label" htmlFor="mn-summary">요약</label>
              <textarea id="mn-summary" className="input-field" value={summary} onChange={(e) => setSummary(e.target.value)}
                rows={4} placeholder="AI 분석 결과 또는 직접 입력" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
            <div>
              <label className="label" htmlFor="mn-decisions">결정사항</label>
              <textarea id="mn-decisions" className="input-field" value={decisions} onChange={(e) => setDecisions(e.target.value)}
                rows={3} placeholder="회의에서 결정된 사항" style={{ resize: 'vertical', fontFamily: 'inherit' }} />
            </div>
          </>
        )}

        {/* 참석자 — 에디터 내장(저장 시 함께 저장) */}
        <AttendeesEditor people={people} tree={orgTree} members={members} externals={externals}
          onChange={({ members: m, externals: e }) => { setMembers(m); setExternals(e) }} />

        {/* 태그 */}
        <div>
          <label className="label" htmlFor="mn-tag">태그</label>
          {tags.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0 0 var(--space-2)', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {tags.map((t) => (
                <li key={t}>
                  <span className="badge badge-slate" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                    #{t}
                    <button type="button" onClick={() => setTags((prev) => prev.filter((x) => x !== t))} aria-label={`${t} 제거`}
                      style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}>
                      <X size={12} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input id="mn-tag" className="input-field" value={tagInput} onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }}
              placeholder="태그 입력 후 Enter" style={{ minHeight: 44, flex: 1, minWidth: 0 }} />
            <NbButton variant="ghost" onClick={addTag} disabled={!tagInput.trim()} style={{ flexShrink: 0 }}>추가</NbButton>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <NbButton variant="ghost" onClick={() => { if (onExit) onExit(); else router.back() }} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
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
