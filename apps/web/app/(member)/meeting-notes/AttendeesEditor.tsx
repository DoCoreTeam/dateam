'use client'

// 참석자 편집(컨트롤드) — 에디터(작성/편집) 화면 내장용.
//  - 자체 저장/라우터 없음. 부모(MeetingEditor)가 폼 저장 시 members/externals를 함께 저장.
//  - 내부=조직원 칩(indigo) / 외부=텍스트 칩(slate). 모델은 AttendeesPanel과 동일.
import { useState } from 'react'
import { Users, Plus, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import OrgPeoplePicker, { type OrgPickerNode, type PickerPerson } from '@/components/ui/OrgPeoplePicker'

export interface MemberChip {
  id: string
  name: string
}

interface Props {
  people: { id: string; name: string }[]
  tree: OrgPickerNode[]
  members: MemberChip[]
  externals: string[]
  onChange: (next: { members: MemberChip[]; externals: string[] }) => void
}

export default function AttendeesEditor({ people, tree, members, externals, onChange }: Props) {
  const [externalInput, setExternalInput] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  function addMembers(added: PickerPerson[]) {
    const have = new Set(members.map((m) => m.id))
    const fresh = added.filter((p) => !have.has(p.id)).map((p) => ({ id: p.id, name: p.name }))
    if (fresh.length > 0) onChange({ members: [...members, ...fresh], externals })
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
          <label className="label">조직원 추가</label>
          <NbButton variant="ghost" onClick={() => setPickerOpen(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', width: '100%', justifyContent: 'center', minHeight: 44 }}>
            <Users size={15} /> 조직도에서 선택
          </NbButton>
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
