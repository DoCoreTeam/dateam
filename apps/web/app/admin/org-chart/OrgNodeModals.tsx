'use client'
import { useEscClose } from '@/lib/use-esc-close'

import { useState, useTransition } from 'react'
import { X } from 'lucide-react'
import type { OrgNode, OrgNodeType, OrgNodeWithChildren } from './OrgNodeCard'
import { createNode, updateNode, moveNode } from './actions'

interface Profile {
  id: string
  name: string
  rank: string | null
  position: string | null
}

// ── Add Node Modal ────────────────────────────────────────────────────────────

interface AddModalProps {
  parentId: string
  parentType: OrgNodeType
  allProfiles: Profile[]
  existingPersonUserIds: string[]
  onClose: () => void
}

const TYPE_LABELS: Record<OrgNodeType, string> = {
  company: '회사/조직',
  role: '역할(C레벨)',
  department: '부서',
  person: '구성원',
}

const ALLOWED_CHILD_TYPES: Record<OrgNodeType, OrgNodeType[]> = {
  company:    ['role', 'department', 'person', 'company'],
  role:       ['department', 'person'],
  department: ['department', 'person'],
  person:     [],
}

export function AddNodeModal({ parentId, parentType, allProfiles, existingPersonUserIds, onClose }: AddModalProps) {
  const allowedTypes = ALLOWED_CHILD_TYPES[parentType]
  const [type, setType] = useState<OrgNodeType>(allowedTypes[0] ?? 'department')
  const [name, setName] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [userId, setUserId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const availableProfiles = allProfiles.filter(p => !existingPersonUserIds.includes(p.id) && p.name.trim())

  function handleUserSelect(uid: string) {
    setUserId(uid)
    const p = allProfiles.find(p => p.id === uid)
    if (p) {
      setName(p.name)
      setSubtitle(p.position || p.rank || '')
    }
  }

  function handleSubmit() {
    if (type !== 'person' && !name.trim()) { setError('이름을 입력하세요'); return }
    if (type === 'person' && !userId) { setError('구성원을 선택하세요'); return }
    setError(null)
    startTransition(async () => {
      const res = await createNode({
        type, parent_id: parentId,
        name: name.trim() || allProfiles.find(p => p.id === userId)?.name || '',
        subtitle: subtitle.trim() || null,
        user_id: type === 'person' ? userId : null,
      })
      if (res.error) setError(res.error)
      else onClose()
    })
  }

  return (
    <Modal title="노드 추가" onClose={onClose}>
      {allowedTypes.length > 1 && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>타입</span>
          <select value={type} onChange={e => setType(e.target.value as OrgNodeType)} style={inputStyle}>
            {allowedTypes.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
          </select>
        </label>
      )}

      {type === 'person' ? (
        <label style={labelStyle}>
          <span style={labelTextStyle}>구성원 선택 *</span>
          <select value={userId} onChange={e => handleUserSelect(e.target.value)} style={inputStyle}>
            <option value="">— 선택하세요 —</option>
            {availableProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.position ? ` (${p.position})` : p.rank ? ` (${p.rank})` : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <label style={labelStyle}>
            <span style={labelTextStyle}>이름 *</span>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="예: 개발본부" style={inputStyle} />
          </label>
          <label style={labelStyle}>
            <span style={labelTextStyle}>설명 / 부제목</span>
            <input value={subtitle} onChange={e => setSubtitle(e.target.value)} placeholder="선택사항" style={inputStyle} />
          </label>
        </>
      )}

      {error && <p style={errorStyle}>{error}</p>}
      <ModalFooter onClose={onClose} onSubmit={handleSubmit} isPending={isPending} label="추가" />
    </Modal>
  )
}

// ── Edit Node Modal ───────────────────────────────────────────────────────────

interface EditModalProps {
  node: OrgNode
  allProfiles: Profile[]
  allNodes?: OrgNode[]
  onClose: () => void
}

export function EditNodeModal({ node, allProfiles, allNodes = [], onClose }: EditModalProps) {
  const [name, setName] = useState(node.name)
  const [subtitle, setSubtitle] = useState(node.subtitle ?? '')
  const [headUserId, setHeadUserId] = useState(node.head_user_id ?? '')
  const [parentId, setParentId] = useState(node.parent_id ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const showHead = node.type === 'department' || node.type === 'role'
  // candidates: non-person, not self, not a descendant of self
  const descendantIds = new Set<string>()
  function collectDescendants(id: string) {
    allNodes.filter(n => n.parent_id === id).forEach(n => {
      descendantIds.add(n.id)
      collectDescendants(n.id)
    })
  }
  collectDescendants(node.id)
  const parentCandidates = allNodes.filter(n => n.type !== 'person' && n.id !== node.id && !descendantIds.has(n.id))

  function handleSubmit() {
    if (node.type !== 'person' && !name.trim()) { setError('이름을 입력하세요'); return }
    setError(null)
    startTransition(async () => {
      if (parentId && parentId !== (node.parent_id ?? '')) {
        const mv = await moveNode(node.id, parentId)
        if (mv.error) { setError(mv.error); return }
      }
      if (node.type !== 'person') {
        const res = await updateNode(node.id, {
          name: name.trim(),
          subtitle: subtitle.trim() || null,
          ...(showHead ? { head_user_id: headUserId || null } : {}),
        })
        if (res.error) { setError(res.error); return }
      }
      onClose()
    })
  }

  return (
    <Modal title="노드 수정" onClose={onClose}>
      {node.type !== 'person' && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>이름 *</span>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
        </label>
      )}
      {node.type !== 'person' && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>설명 / 부제목</span>
          <input value={subtitle} onChange={e => setSubtitle(e.target.value)} style={inputStyle} />
        </label>
      )}
      {showHead && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>부서장</span>
          <select value={headUserId} onChange={e => setHeadUserId(e.target.value)} style={inputStyle}>
            <option value="">— 없음 —</option>
            {allProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.name}{p.position ? ` (${p.position})` : p.rank ? ` (${p.rank})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {parentCandidates.length > 0 && (
        <label style={labelStyle}>
          <span style={labelTextStyle}>상위 노드 변경</span>
          <select value={parentId} onChange={e => setParentId(e.target.value)} style={inputStyle}>
            <option value="">— 현재 위치 유지 —</option>
            {parentCandidates.map(n => (
              <option key={n.id} value={n.id}>{n.name}</option>
            ))}
          </select>
        </label>
      )}
      {error && <p style={errorStyle}>{error}</p>}
      <ModalFooter onClose={onClose} onSubmit={handleSubmit} isPending={isPending} label="저장" />
    </Modal>
  )
}

// ── Shared UI ─────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEscClose(onClose)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#fff', borderRadius: '0.75rem', width: '380px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid #e2e8f0' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={18} /></button>
        </div>
        <div style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function ModalFooter({ onClose, onSubmit, isPending, label }: { onClose: () => void; onSubmit: () => void; isPending: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', paddingTop: '0.25rem' }}>
      <button onClick={onClose} disabled={isPending} style={{ padding: '0.45rem 1rem', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}>취소</button>
      <button onClick={onSubmit} disabled={isPending} style={{ padding: '0.45rem 1rem', background: 'var(--brand-dark)', color: '#fff', border: 'none', borderRadius: '0.5rem', fontSize: '0.875rem', cursor: isPending ? 'not-allowed' : 'pointer', opacity: isPending ? 0.7 : 1 }}>
        {isPending ? '처리 중...' : label}
      </button>
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.35rem' }
const labelTextStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 600, color: '#475569' }
const inputStyle: React.CSSProperties = { padding: '0.5rem 0.75rem', border: '1px solid #cbd5e1', borderRadius: '0.5rem', fontSize: '0.875rem', background: '#fff', outline: 'none' }
const errorStyle: React.CSSProperties = { margin: 0, color: '#ef4444', fontSize: '0.8rem' }
