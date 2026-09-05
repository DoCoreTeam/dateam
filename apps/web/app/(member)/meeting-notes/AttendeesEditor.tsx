'use client'

// 참석자 편집(컨트롤드) — 에디터(작성/편집) 화면 내장용.
//  - 자체 저장/라우터 없음. 부모(MeetingEditor)가 폼 저장 시 members/externals/persons를 함께 저장.
//  - 내부=조직원 칩(indigo) / 외부=텍스트 칩(slate) / CRM 인물=초록 칩. 모델은 AttendeesPanel과 동일.
//
// **왜 CRM 인물 칩이 생겼나**: 외부 참석자가 글자 배열로만 남아 CRM 인물과 영영 만나지 않았다.
// 실측(2026-09-05) — 회의에 이름이 적힌 외부인 9명이 CRM 에 아예 없었고,
// CRM 에 있는 사람조차 자기 회의를 화면에서 볼 수 없었다. 이름을 적는 이 자리가
// 그 사실이 만들어지는 유일한 지점이라, 여기서 잇지 않으면 뒤에서 아무리 훑어도 늦다.
import { useCallback, useEffect, useRef, useState } from 'react'
import { Users, Plus, X, Link2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import OrgPeoplePicker, { type OrgPickerNode, type PickerPerson } from '@/components/ui/OrgPeoplePicker'
import { isEnterKey } from '@/lib/ui/ime'
import { parseAttendee } from '@/lib/meeting/attendee-parse'
import styles from './attendees-editor.module.css'

export interface MemberChip {
  id: string
  name: string
}

/** CRM 인물과 이어진 외부 참석자 */
export interface LinkedPerson {
  id: string
  name: string
  companyName: string | null
  title: string | null
}

interface CandidateRow {
  id: string
  name: string
  companyId: string | null
  companyName: string | null
  title: string | null
}

interface Props {
  people: { id: string; name: string }[]
  tree: OrgPickerNode[]
  members: MemberChip[]
  externals: string[]
  /** 안 주면 예전과 똑같이 동작한다(추가 전용) */
  persons?: LinkedPerson[]
  onChange: (next: { members: MemberChip[]; externals: string[]; persons: LinkedPerson[] }) => void
}

export default function AttendeesEditor({ people, tree, members, externals, persons = [], onChange }: Props) {
  const [externalInput, setExternalInput] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [searching, setSearching] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  /**
   * 이름을 치면 CRM 에서 찾아 본다.
   *
   * 적는 말은 「컬쳐랜드 김시홍팀장」처럼 소속·직급이 붙어 있으므로
   * 이름만 떼어 찾는다 — 통째로 찾으면 아무것도 안 걸린다.
   */
  useEffect(() => {
    const raw = externalInput.trim()
    if (raw.length < 2) { setCandidates([]); return }
    const term = parseAttendee(raw).name || raw

    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/meeting-notes/attendee-candidates?q=${encodeURIComponent(term)}`)
        if (!alive) return
        const body = await res.json()
        setCandidates(res.ok ? (body.people ?? []) : [])
      } catch {
        // CRM 을 못 봐도 이름은 그냥 적을 수 있어야 한다 — 곁들이는 일이 본 일을 막지 않는다
        if (alive) setCandidates([])
      } finally {
        if (alive) setSearching(false)
      }
    }, 250)

    return () => { alive = false; clearTimeout(t) }
  }, [externalInput])

  // 바깥을 누르면 후보를 닫는다
  useEffect(() => {
    if (candidates.length === 0) return
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setCandidates([])
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [candidates.length])

  function addMembers(added: PickerPerson[]) {
    const have = new Set(members.map((m) => m.id))
    const fresh = added.filter((p) => !have.has(p.id)).map((p) => ({ id: p.id, name: p.name }))
    if (fresh.length > 0) onChange({ members: [...members, ...fresh], externals, persons })
  }

  const addExternal = useCallback(() => {
    const name = externalInput.trim()
    if (!name) return
    // 중복/조직원 이름 흡수(이중 저장 방지)
    if (externals.includes(name) || members.some((m) => m.name === name)) { setExternalInput(''); return }
    onChange({ members, externals: [...externals, name], persons })
    setExternalInput('')
    setCandidates([])
  }, [externalInput, externals, members, persons, onChange])

  /** 후보를 고르면 글자가 아니라 **그 인물**로 붙는다 */
  const linkPerson = useCallback((c: CandidateRow) => {
    if (!persons.some((p) => p.id === c.id)) {
      onChange({
        members, externals,
        persons: [...persons, { id: c.id, name: c.name, companyName: c.companyName, title: c.title }],
      })
    }
    setExternalInput('')
    setCandidates([])
  }, [members, externals, persons, onChange])

  function removeMember(id: string) {
    onChange({ members: members.filter((m) => m.id !== id), externals, persons })
  }

  function removeExternal(name: string) {
    onChange({ members, externals: externals.filter((n) => n !== name), persons })
  }

  function removePerson(id: string) {
    onChange({ members, externals, persons: persons.filter((p) => p.id !== id) })
  }

  const isEmpty = members.length === 0 && externals.length === 0 && persons.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 0 }}>
        <Users size={14} color="var(--brand)" /> 참석자
      </label>

      {isEmpty ? (
        <p style={{ margin: 0, color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
          조직원이나 외부 참석자를 추가하세요.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {members.map((m) => (
            <li key={`mem-${m.id}`}>
              <span className="badge badge-indigo" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {m.name}
                <button type="button" onClick={() => removeMember(m.id)} aria-label={`${m.name} 제거`} className={styles.chipRemove}>
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
          {/* CRM 인물과 이어진 사람 — 소속까지 보여야 「누구인지」가 확실해진다 */}
          {persons.map((p) => (
            <li key={`per-${p.id}`}>
              <span className={`badge badge-green ${styles.linked}`} title={`영업 CRM 인물 · ${p.companyName ?? '소속 없음'}`}>
                <Link2 size={11} />
                {p.name}
                {p.companyName && <span className={styles.linkedOrg}>{p.companyName}</span>}
                <button type="button" onClick={() => removePerson(p.id)} aria-label={`${p.name} 제거`} className={styles.chipRemove}>
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
          {externals.map((name) => (
            <li key={`ext-${name}`}>
              <span className="badge badge-slate" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                {name}
                <button type="button" onClick={() => removeExternal(name)} aria-label={`${name} 제거`} className={styles.chipRemove}>
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="responsive-grid-cols-2" style={{ gap: 'var(--space-4)', alignItems: 'end' }}>
        <div>
          <label className="label">조직원 추가</label>
          <NbButton variant="ghost" onClick={() => setPickerOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', width: '100%', justifyContent: 'center', minHeight: 44 }}>
            <Users size={15} /> 조직도에서 선택
          </NbButton>
        </div>
        <div>
          <label className="label" htmlFor="mn-att-external">외부 참석자</label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }} ref={boxRef}>
            <div className={styles.searchWrap}>
              <input id="mn-att-external" className="input-field"
                value={externalInput}
                onChange={(e) => setExternalInput(e.target.value)}
                onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); addExternal() } }}
                placeholder="외부 참석자 이름"
                autoComplete="off"
                style={{ minHeight: 44, width: '100%' }}
              />
              {candidates.length > 0 && (
                <ul className={styles.candidates}>
                  {candidates.slice(0, 8).map((c) => (
                    <li key={c.id}>
                      <button type="button" className={styles.candidate} onClick={() => linkPerson(c)}>
                        <span className={styles.candidateName}>{c.name}</span>
                        <span className={styles.candidateMeta}>
                          {[c.title, c.companyName].filter(Boolean).join(' · ') || '소속 없음'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <NbButton variant="ghost" onClick={addExternal} disabled={!externalInput.trim()} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
              <Plus size={15} /> 추가
            </NbButton>
          </div>
          <p className={styles.hint}>
            {searching ? '영업 CRM 에서 찾는 중…' : '이름을 치면 영업 CRM 의 인물을 찾아 드려요. 고르면 그 사람과 이어집니다.'}
          </p>
        </div>
      </div>

      {pickerOpen && (
        <OrgPeoplePicker
          people={people}
          tree={tree}
          existingIds={members.map((m) => m.id)}
          onConfirm={addMembers}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  )
}
