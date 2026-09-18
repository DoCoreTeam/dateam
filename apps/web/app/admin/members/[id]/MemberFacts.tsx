'use client'

// app/admin/members/[id]/MemberFacts.tsx — 계정 카드. 보고 그 자리에서 고친다
//
// 왜 고칠 수 있어야 하나 (사용자 지적 2026-09-19): 상세에 와서 계정을 보고 있는데 고칠 방법이
// 하나도 없었다. 틀린 직급을 보고도 목록으로 돌아가 그 행을 다시 찾아야 했다.
// 상세는 「그 대상에 대해 할 수 있는 일이 모이는 자리」다 — 읽기만 되면 상세가 아니라 인쇄물이다.
//
// 「수정」은 누르는 순간 「저장」이 된다. 고치는 중에는 취소도 함께 보인다
// (사용자 지시 2026-09-17: 고칠 수 있으면 저장할 방법이 화면에 있어야 한다).

import { useState, useTransition } from 'react'
import { Mail, Building2, Shield, CalendarDays, KeyRound, Pencil, Save, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import InlineError from '@/components/ui/InlineError'
import { updateUserProfile } from '../../org-chart/actions'
import { changeRole, setMemberDepartment } from '../../users/actions'
import type { Profile } from '@/types/database'

export interface NamedItem {
  id: number
  name: string
  display_order: number
}

export interface DeptOption {
  id: string
  name: string
}

interface Props {
  profile: Profile
  email: string
  /** 지금 소속된 조직 노드 id. 조직도에 없으면 null */
  departmentId: string | null
  departments: DeptOption[]
  ranks: NamedItem[]
  positions: NamedItem[]
  isSelf: boolean
}

export default function MemberFacts({ profile, email, departmentId, departments, ranks, positions, isSelf }: Props) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name ?? '')
  const [rank, setRank] = useState(profile.rank ?? '')
  const [position, setPosition] = useState(profile.position ?? '')
  const [role, setRole] = useState<'admin' | 'member'>(profile.role)
  const [dept, setDept] = useState(departmentId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function cancel() {
    // 고치기 전 값으로 되돌린다 — 취소가 「방금 친 것만」 지우면 취소가 아니다
    setName(profile.name ?? '')
    setRank(profile.rank ?? '')
    setPosition(profile.position ?? '')
    setRole(profile.role)
    setDept(departmentId ?? '')
    setError(null)
    setEditing(false)
  }

  function save() {
    if (!name.trim()) { setError('이름을 입력하세요'); return }
    setError(null)
    startTransition(async () => {
      const res = await updateUserProfile(profile.id, { name: name.trim(), rank: rank || null, position: position || null })
      if (res.error) { setError(res.error); return }

      if (role !== profile.role) {
        const roleRes = await changeRole(profile.id, role)
        if (roleRes.error) { setError(roleRes.error); return }
      }

      if ((dept || null) !== departmentId) {
        const deptRes = await setMemberDepartment(profile.id, dept || null)
        if (!deptRes.ok) { setError(deptRes.error); return }
      }

      setEditing(false)
    })
  }

  const deptName = departments.find((d) => d.id === departmentId)?.name ?? null

  return (
    <div className="card" style={{ padding: 'var(--space-5) var(--space-6)', marginBottom: '1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
        <h2 className="tape-title" style={{ margin: 0, flex: 1 }}>계정</h2>
        {editing ? (
          <>
            <NbButton id="acc-cancel" variant="secondary" onClick={cancel} disabled={pending}>
              <X size={14} /> 취소
            </NbButton>
            <NbButton id="acc-save" onClick={save} disabled={pending}>
              <Save size={14} /> {pending ? '저장 중' : '저장'}
            </NbButton>
          </>
        ) : (
          <NbButton id="acc-edit" variant="secondary" onClick={() => setEditing(true)}>
            <Pencil size={14} /> 수정
          </NbButton>
        )}
      </div>

      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
        gap: 'var(--space-4)', margin: 0,
      }}>
        <Field label="이름">
          {editing
            ? <input id="acc-name" className="input-field" value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
            : (profile.name || '—')}
        </Field>

        <Field label="직급">
          {editing
            ? (
              <select id="acc-rank" className="input-field" value={rank} onChange={(e) => setRank(e.target.value)} disabled={pending}>
                <option value="">직급 없음</option>
                {[...ranks].sort((a, b) => a.display_order - b.display_order).map((r) => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            )
            : (profile.rank || '—')}
        </Field>

        <Field label="직책">
          {editing
            ? (
              <select id="acc-position" className="input-field" value={position} onChange={(e) => setPosition(e.target.value)} disabled={pending}>
                <option value="">직책 없음</option>
                {[...positions].sort((a, b) => a.display_order - b.display_order).map((p) => (
                  <option key={p.id} value={p.name}>{p.name}</option>
                ))}
              </select>
            )
            : (profile.position || '—')}
        </Field>

        <Field label="역할" icon={<Shield size={14} />}>
          {editing && !isSelf
            ? (
              <select id="acc-role" className="input-field" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} disabled={pending}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            )
            : profile.role}
        </Field>

        <Field label="소속" icon={<Building2 size={14} />}>
          {editing
            ? (
              <select id="acc-dept" className="input-field" value={dept} onChange={(e) => setDept(e.target.value)} disabled={pending}>
                <option value="">조직도에 없음</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )
            : (deptName ?? '조직도에 없음')}
        </Field>

        {/* 이메일은 로그인 계정 자체라 여기서 못 바꾼다. 가입일은 사실이라 고칠 것이 아니다 */}
        <Field label="이메일" icon={<Mail size={14} />}>{email || '—'}</Field>
        <Field label="가입일" icon={<CalendarDays size={14} />}>
          {new Date(profile.created_at).toLocaleDateString('ko-KR')}
        </Field>
        <Field label="초기 비밀번호 변경" icon={<KeyRound size={14} />}>
          {profile.must_change_password ? '대기중' : '완료'}
        </Field>
      </dl>

      {isSelf && editing && (
        <p style={{ margin: 'var(--space-3) 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          자기 자신의 역할은 바꿀 수 없어 그 칸이 잠겨 있습니다
        </p>
      )}
      <InlineError compact>{error}</InlineError>
    </div>
  )
}

function Field({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <dt style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>
        {icon}{label}
      </dt>
      <dd style={{ margin: 0, fontSize: 'var(--fs-base)' }}>{children}</dd>
    </div>
  )
}
