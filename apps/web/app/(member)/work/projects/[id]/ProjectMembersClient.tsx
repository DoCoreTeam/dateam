'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import InlineError from '@/components/ui/InlineError'

interface Member { user_id: string; role: string; profiles: { name?: string; position?: string } | null }
interface ProfileOption { id: string; name: string | null; position: string | null }
interface Props { projectId: string; initialMembers: Member[]; profiles: ProfileOption[] }

export default function ProjectMembersClient({ projectId, initialMembers, profiles }: Props) {
  const [members, setMembers] = useState(initialMembers)
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState('contributor')
  const [error, setError] = useState<string | null>(null)
  const available = profiles.filter((profile) => !members.some((member) => member.user_id === profile.id))

  async function add() {
    if (!userId) return
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, role }),
      })
      if (!res.ok) { const data = await res.json().catch(() => null); setError(data?.error ?? '저장에 실패했습니다'); return }
      const profile = profiles.find((item) => item.id === userId)
      setMembers((prev) => [...prev, { user_id: userId, role, profiles: profile ? { name: profile.name ?? undefined, position: profile.position ?? undefined } : null }])
      setUserId('')
    } catch { setError('서버 연결에 실패했습니다') }
  }

  async function remove(member: Member) {
    if (member.role === 'owner') return
    setError(null)
    try {
      const res = await fetch(`/api/projects/${projectId}/members?userId=${member.user_id}`, { method: 'DELETE' })
      if (!res.ok) { const data = await res.json().catch(() => null); setError(data?.error ?? '제거에 실패했습니다'); return }
      setMembers((prev) => prev.filter((item) => item.user_id !== member.user_id))
    } catch { setError('서버 연결에 실패했습니다') }
  }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
    {members.map((member) => <div key={member.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, borderBottom: 'var(--hairline) solid var(--border-light)' }}>
      <span style={{ flex: 1 }}>{member.profiles?.name ?? '이름 없음'}{member.profiles?.position ? ` · ${member.profiles.position}` : ''}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>{roleLabel(member.role)}</span>
      {member.role !== 'owner' && <button onClick={() => remove(member)} aria-label={`${member.profiles?.name ?? '참여자'} 제거`} style={{ minWidth: 44, minHeight: 44, border: 0, background: 'none', color: 'var(--danger)', cursor: 'pointer' }}><Trash2 size={16} /></button>}
    </div>)}
    {available.length > 0 && <div className="responsive-grid-cols-2" style={{ display: 'grid', gap: 8 }}>
      <select className="input-field" value={userId} onChange={(event) => setUserId(event.target.value)} style={{ minHeight: 44 }}><option value="">참여자 선택</option>{available.map((profile) => <option key={profile.id} value={profile.id}>{profile.name ?? '이름 없음'}</option>)}</select>
      <select className="input-field" value={role} onChange={(event) => setRole(event.target.value)} style={{ minHeight: 44 }}><option value="manager">운영자</option><option value="contributor">참여자</option><option value="viewer">조회자</option><option value="stakeholder">이해관계자</option></select>
      <button type="button" className="btn-primary" onClick={add} disabled={!userId} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44 }}><Plus size={16} /> 추가</button>
    </div>}
    <InlineError>{error}</InlineError>
  </div>
}

function roleLabel(value: string): string { return ({ owner: '책임자', manager: '운영자', contributor: '참여자', viewer: '조회자', stakeholder: '이해관계자' } as Record<string, string>)[value] ?? value }
