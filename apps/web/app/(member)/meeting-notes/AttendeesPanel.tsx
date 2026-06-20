'use client'

// 회의노트 참석자 관리 패널 (상세 화면 전용)
//  - 내부=조직원 칩(brand 계열) / 외부=텍스트 칩(slate 계열)으로 구분.
//  - 초기화: attendee_user_ids → people에서 name 복원(조직원 칩), 나머지 attendees → matchAttendees로 외부인 분류.
//  - 저장: updateMeetingNote({ attendees: [조직원 name + 외부 텍스트], attendee_user_ids: [조직원 id] }) → router.refresh.
//  - SSOT: 이름→조직원 매칭은 lib/meeting/match-attendees(matchAttendees) 재사용.
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Plus, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { updateMeetingNote } from './actions'

interface Props {
  noteId: string
  initialAttendees: string[]
  initialUserIds: string[]
  people: { id: string; name: string }[]
}

interface MemberChip {
  id: string
  name: string
}

export default function AttendeesPanel({ noteId, initialAttendees, initialUserIds, people }: Props) {
  const router = useRouter()
  const peopleById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of people) m.set(p.id, p.name)
    return m
  }, [people])

  // 초기 분류: user_ids → 조직원 칩, 나머지 이름 → matchAttendees로 외부인만 텍스트 칩.
  const initialState = useMemo(() => {
    const members: MemberChip[] = []
    const memberNames = new Set<string>()
    for (const id of initialUserIds) {
      const name = peopleById.get(id)
      if (name) { members.push({ id, name }); memberNames.add(name) }
    }
    // attendee_user_ids가 내부(조직원)의 SSOT. 그 외 attendees 이름은 모두 외부로 본다.
    // 이름이 조직원과 겹쳐도 user_id가 없으면 외부 — 동명이인 외부인이 내부로 되돌려지는 오분류를 막는다.
    const externals = initialAttendees.filter((n) => !memberNames.has(n))
    return { members, externals }
  }, [initialAttendees, initialUserIds, peopleById])

  const [members, setMembers] = useState<MemberChip[]>(initialState.members)
  const [externals, setExternals] = useState<string[]>(initialState.externals)
  // 로컬 미저장 편집 여부. 편집이 있으면 서버 재동기화로 사용자 변경을 덮지 않는다.
  const [dirty, setDirty] = useState(false)

  // 서버 데이터가 바뀌면(예: AI 패널에서 참석자 반영 → router.refresh) 로컬 칩을 재동기화.
  // 단, 미저장 로컬 편집(dirty)이 있으면 사용자 변경 보호를 위해 건너뛴다.
  const serverSig = useMemo(
    () => JSON.stringify({ a: initialAttendees, u: initialUserIds }),
    [initialAttendees, initialUserIds]
  )
  useEffect(() => {
    if (dirty) return
    setMembers(initialState.members)
    setExternals(initialState.externals)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSig])

  // 미저장 편집 중 탭 닫기/새로고침/이탈 시 경고(브라우저 기본 확인창).
  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const [selectId, setSelectId] = useState('')
  const [externalInput, setExternalInput] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [pending, startTransition] = useTransition()

  // 아직 추가되지 않은 조직원만 드롭다운에 노출
  const availablePeople = useMemo(
    () => people.filter((p) => !members.some((m) => m.id === p.id)),
    [people, members]
  )

  function addMember() {
    if (!selectId) return
    const p = people.find((x) => x.id === selectId)
    if (p && !members.some((m) => m.id === p.id)) {
      setMembers((prev) => [...prev, { id: p.id, name: p.name }])
      setDirty(true)
    }
    setSelectId('')
    setInfo('')
  }

  function addExternal() {
    const name = externalInput.trim()
    if (!name) return
    // 외부 텍스트 중복 방지 + 이미 조직원 칩에 있는 이름이면 흡수(같은 이름이 내부+외부로 이중 저장되지 않게)
    if (externals.includes(name) || members.some((m) => m.name === name)) { setExternalInput(''); return }
    setExternals((prev) => [...prev, name])
    setDirty(true)
    setExternalInput('')
    setInfo('')
  }

  function removeMember(id: string) {
    setMembers((prev) => prev.filter((m) => m.id !== id))
    setDirty(true)
  }

  function removeExternal(name: string) {
    setExternals((prev) => prev.filter((n) => n !== name))
    setDirty(true)
  }

  function save() {
    setError(''); setInfo('')
    const attendees = [...members.map((m) => m.name), ...externals]
    const attendeeUserIds = members.map((m) => m.id)
    startTransition(async () => {
      try {
        const res = await updateMeetingNote(noteId, {
          attendees: attendees.length > 0 ? attendees : null,
          attendee_user_ids: attendeeUserIds.length > 0 ? attendeeUserIds : null,
        })
        if (!res.ok) { setError(res.error); return }
        setDirty(false) // 저장 완료 → 이후 router.refresh의 재동기화 허용(동일값이라 무해)
        setInfo('참석자를 저장했습니다.')
        router.refresh()
      } catch {
        setError('저장에 실패했습니다. 잠시 후 다시 시도해 주세요.')
      }
    })
  }

  const isEmpty = members.length === 0 && externals.length === 0

  return (
    <section className="card" style={{ padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-labelledby="mn-attendees-h">
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <Users size={16} color="var(--brand)" />
        <h2 id="mn-attendees-h" className="tape-title" style={{ margin: 0 }}>참석자</h2>
      </div>

      {/* 현재 참석자 칩 — 내부(조직원)=brand, 외부=slate */}
      {isEmpty ? (
        <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
          아직 등록된 참석자가 없습니다. 아래에서 조직원이나 외부 참석자를 추가하세요.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {members.map((m) => (
            <li key={`mem-${m.id}`}>
              <span className="badge badge-indigo" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {m.name}
                <button type="button" onClick={() => removeMember(m.id)} aria-label={`${m.name} 제거`}
                  style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}>
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
          {externals.map((name) => (
            <li key={`ext-${name}`}>
              <span className="badge badge-slate" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {name}
                <button type="button" onClick={() => removeExternal(name)} aria-label={`${name} 제거`}
                  style={{ display: 'inline-flex', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, lineHeight: 1 }}>
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* 조작: 조직원 추가 / 외부인 텍스트 추가 */}
      <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)', alignItems: 'end' }}>
        <div>
          <label className="label" htmlFor="mn-att-member">조직원 추가</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <select id="mn-att-member" className="input-field"
              value={selectId}
              onChange={(e) => setSelectId(e.target.value)}
              style={{ minHeight: 44, flex: 1, minWidth: 0 }}
            >
              <option value="">조직원 선택…</option>
              {availablePeople.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <NbButton variant="ghost" onClick={addMember} disabled={!selectId} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
              <Plus size={15} /> 추가
            </NbButton>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="mn-att-external">외부 참석자</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input id="mn-att-external" className="input-field"
              value={externalInput}
              onChange={(e) => setExternalInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExternal() } }}
              placeholder="외부 참석자 이름"
              style={{ minHeight: 44, flex: 1, minWidth: 0 }}
            />
            <NbButton variant="ghost" onClick={addExternal} disabled={!externalInput.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
              <Plus size={15} /> 추가
            </NbButton>
          </div>
        </div>
      </div>

      {error && <p role="alert" style={{ margin: 0, color: 'var(--danger)', fontSize: 'var(--fs-sm)' }}>{error}</p>}
      {info && <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>{info}</p>}

      <div>
        <NbButton onClick={save} disabled={pending} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          {pending ? '저장 중…' : '참석자 저장'}
        </NbButton>
      </div>
    </section>
  )
}
