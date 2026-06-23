'use client'

// 참석자 편집(컨트롤드) — 에디터(작성/편집) 화면 내장용.
//  - 자체 저장/라우터 없음. 부모(MeetingEditor)가 폼 저장 시 members/externals를 함께 저장.
//  - 내부=조직원 칩(indigo) / 외부=텍스트 칩(slate). 모델은 AttendeesPanel과 동일.
import { useMemo, useState } from 'react'
import { Users, Plus, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'

export interface MemberChip {
  id: string
  name: string
}

interface Props {
  people: { id: string; name: string }[]
  members: MemberChip[]
  externals: string[]
  onChange: (next: { members: MemberChip[]; externals: string[] }) => void
}

export default function AttendeesEditor({ people, members, externals, onChange }: Props) {
  const [selectId, setSelectId] = useState('')
  const [externalInput, setExternalInput] = useState('')

  // 아직 추가되지 않은 조직원만 드롭다운에 노출
  const availablePeople = useMemo(
    () => people.filter((p) => !members.some((m) => m.id === p.id)),
    [people, members]
  )

  function addMember() {
    if (!selectId) return
    const p = people.find((x) => x.id === selectId)
    if (p && !members.some((m) => m.id === p.id)) {
      onChange({ members: [...members, { id: p.id, name: p.name }], externals })
    }
    setSelectId('')
  }

  function addExternal() {
    const name = externalInput.trim()
    if (!name) return
    // 중복/조직원 이름 흡수(이중 저장 방지)
    if (externals.includes(name) || members.some((m) => m.name === name)) { setExternalInput(''); return }
    onChange({ members, externals: [...externals, name] })
    setExternalInput('')
  }

  function removeMember(id: string) {
    onChange({ members: members.filter((m) => m.id !== id), externals })
  }

  function removeExternal(name: string) {
    onChange({ members, externals: externals.filter((n) => n !== name) })
  }

  const isEmpty = members.length === 0 && externals.length === 0

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
    </div>
  )
}
