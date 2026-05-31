'use client'

import { useState, useTransition } from 'react'
import {
  createDepartment, updateDepartment, deleteDepartment,
  moveDepartment, addMember, removeMember,
} from './actions'
import {
  ChevronDown, ChevronRight, Plus, Pencil, Trash2,
  ArrowUp, ArrowDown, UserPlus, X, Check,
} from 'lucide-react'

export interface Member {
  id: string
  name: string | null
  email: string | null
}

export interface Department {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  display_order: number
  members: Member[]
}

interface OrgTreeProps {
  departments: Department[]
  allProfiles: Member[]
}

function DeptNode({
  dept,
  allDepts,
  allProfiles,
  siblings,
  depth,
}: {
  dept: Department
  allDepts: Department[]
  allProfiles: Member[]
  siblings: { id: string; display_order: number }[]
  depth: number
}) {
  const [open, setOpen] = useState(true)
  const [editing, setEditing] = useState(false)
  const [addingChild, setAddingChild] = useState(false)
  const [showMembers, setShowMembers] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const children = allDepts
    .filter((d) => d.parent_id === dept.id)
    .sort((a, b) => a.display_order - b.display_order)

  const isFirst = siblings[0]?.id === dept.id
  const isLast = siblings[siblings.length - 1]?.id === dept.id

  const filteredProfiles = allProfiles.filter((p) => {
    if (!memberSearch) return true
    const q = memberSearch.toLowerCase()
    return (p.name ?? '').toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q)
  })

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    startTransition(async () => {
      const result = await updateDepartment(dept.id, fd)
      if (result.error) setError(result.error)
      else setEditing(false)
    })
  }

  async function handleDelete() {
    if (!confirm(`"${dept.name}" 부서를 삭제하시겠습니까?`)) return
    startTransition(async () => {
      const result = await deleteDepartment(dept.id)
      if (result.error) alert(result.error)
    })
  }

  async function handleMove(dir: 'up' | 'down') {
    startTransition(async () => {
      await moveDepartment(dept.id, dir, siblings)
    })
  }

  async function handleAddMember(userId: string) {
    startTransition(async () => {
      const result = await addMember(dept.id, userId)
      if (result.error) alert(result.error)
    })
  }

  async function handleRemoveMember(userId: string) {
    startTransition(async () => {
      await removeMember(dept.id, userId)
    })
  }

  const indent = depth * 20

  return (
    <div style={{ marginLeft: indent > 0 ? indent : 0, marginTop: '0.5rem' }}>
      {/* 부서 헤더 */}
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          padding: '0.5rem 0.75rem', borderRadius: '0.5rem',
          background: editing ? '#f0f9ff' : '#ffffff',
          border: '1px solid #e2e8f0',
          opacity: isPending ? 0.6 : 1,
        }}
      >
        {/* 펼치기 버튼 */}
        <button
          onClick={() => setOpen((v) => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', color: '#94a3b8' }}
        >
          {children.length > 0
            ? (open ? <ChevronDown size={15} /> : <ChevronRight size={15} />)
            : <span style={{ width: 15 }} />}
        </button>

        {/* 이름/편집 */}
        {editing ? (
          <form onSubmit={handleUpdate} style={{ flex: 1, display: 'flex', gap: '0.5rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input
              name="name"
              defaultValue={dept.name}
              required
              placeholder="부서명"
              style={{ flex: '1 1 120px', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #c7d2fe', fontSize: '0.875rem' }}
            />
            <input
              name="description"
              defaultValue={dept.description ?? ''}
              placeholder="설명 (선택)"
              style={{ flex: '2 1 160px', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}
            />
            <select
              name="parent_id"
              defaultValue={dept.parent_id ?? ''}
              style={{ flex: '1 1 120px', padding: '0.25rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}
            >
              <option value="">최상위 부서</option>
              {allDepts
                .filter((d) => d.id !== dept.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
            </select>
            {error && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0, width: '100%' }}>{error}</p>}
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
              <button type="submit" style={{ background: '#6366f1', color: 'white', border: 'none', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                <Check size={12} /> 저장
              </button>
              <button type="button" onClick={() => setEditing(false)} style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.25rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}>
                취소
              </button>
            </div>
          </form>
        ) : (
          <>
            <div style={{ flex: 1 }}>
              <span style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>{dept.name}</span>
              {dept.description && (
                <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '0.5rem' }}>{dept.description}</span>
              )}
              {dept.members.length > 0 && (
                <span style={{
                  marginLeft: '0.5rem', fontSize: '0.75rem', fontWeight: 600,
                  background: '#ede9fe', color: '#6d28d9', borderRadius: '999px',
                  padding: '0.1rem 0.5rem',
                }}>
                  {dept.members.length}명
                </span>
              )}
            </div>
            {/* 액션 버튼들 */}
            <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexShrink: 0 }}>
              <button title="위로" disabled={isFirst || isPending} onClick={() => handleMove('up')}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.2rem', cursor: isFirst ? 'not-allowed' : 'pointer', opacity: isFirst ? 0.3 : 1, display: 'flex' }}>
                <ArrowUp size={13} />
              </button>
              <button title="아래로" disabled={isLast || isPending} onClick={() => handleMove('down')}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.2rem', cursor: isLast ? 'not-allowed' : 'pointer', opacity: isLast ? 0.3 : 1, display: 'flex' }}>
                <ArrowDown size={13} />
              </button>
              <button title="사용자 관리" onClick={() => setShowMembers((v) => !v)}
                style={{ background: showMembers ? '#ede9fe' : 'none', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.2rem 0.4rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.75rem', color: '#6366f1' }}>
                <UserPlus size={13} />
              </button>
              <button title="하위부서 추가" onClick={() => setAddingChild((v) => !v)}
                style={{ background: addingChild ? '#f0fdf4' : 'none', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.2rem 0.4rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.75rem', color: '#16a34a' }}>
                <Plus size={13} />
              </button>
              <button title="수정" onClick={() => setEditing(true)}
                style={{ background: 'none', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.2rem', cursor: 'pointer', display: 'flex', color: '#6366f1' }}>
                <Pencil size={13} />
              </button>
              <button title="삭제" onClick={handleDelete} disabled={isPending}
                style={{ background: 'none', border: '1px solid #fee2e2', borderRadius: '0.25rem', padding: '0.2rem', cursor: 'pointer', display: 'flex', color: '#dc2626' }}>
                <Trash2 size={13} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* 멤버 패널 */}
      {showMembers && (
        <div style={{
          marginLeft: 20, marginTop: '0.375rem', padding: '0.75rem',
          background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '0.5rem',
        }}>
          <div style={{ fontWeight: 600, fontSize: '0.8125rem', color: '#475569', marginBottom: '0.5rem' }}>
            소속 구성원 ({dept.members.length}명)
          </div>
          {/* 현재 멤버 목록 */}
          {dept.members.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginBottom: '0.75rem' }}>
              {dept.members.map((m) => (
                <span key={m.id} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
                  background: '#ede9fe', color: '#6d28d9', borderRadius: '999px',
                  padding: '0.2rem 0.6rem', fontSize: '0.8125rem', fontWeight: 500,
                }}>
                  {m.name ?? m.email ?? '이름 없음'}
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: '#7c3aed' }}
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* 사용자 검색·추가 */}
          <div style={{ fontSize: '0.8125rem', color: '#475569', marginBottom: '0.375rem' }}>사용자 추가</div>
          <input
            placeholder="이름 또는 이메일 검색"
            value={memberSearch}
            onChange={(e) => setMemberSearch(e.target.value)}
            style={{
              width: '100%', padding: '0.375rem 0.625rem', borderRadius: '0.375rem',
              border: '1px solid #e2e8f0', fontSize: '0.8125rem', marginBottom: '0.375rem', boxSizing: 'border-box',
            }}
          />
          <div style={{ maxHeight: '160px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
            {filteredProfiles
              .filter((p) => !dept.members.some((m) => m.id === p.id))
              .slice(0, 20)
              .map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleAddMember(p.id)}
                  disabled={isPending}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0.375rem 0.5rem', borderRadius: '0.25rem',
                    background: 'white', border: '1px solid #e2e8f0',
                    cursor: 'pointer', fontSize: '0.8125rem', textAlign: 'left',
                  }}
                >
                  <span style={{ fontWeight: 500, color: '#1e293b' }}>{p.name ?? '이름 없음'}</span>
                  <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{p.email}</span>
                  <Plus size={12} style={{ marginLeft: 'auto', color: '#6366f1' }} />
                </button>
              ))}
            {filteredProfiles.filter((p) => !dept.members.some((m) => m.id === p.id)).length === 0 && (
              <div style={{ fontSize: '0.8125rem', color: '#94a3b8', padding: '0.5rem' }}>
                추가 가능한 사용자가 없습니다
              </div>
            )}
          </div>
        </div>
      )}

      {/* 하위부서 추가 폼 */}
      {addingChild && (
        <AddDeptForm
          parentId={dept.id}
          allDepts={allDepts}
          onDone={() => setAddingChild(false)}
          indent={20}
        />
      )}

      {/* 하위 부서 렌더 */}
      {open && children.length > 0 && (
        <div>
          {children.map((child) => (
            <DeptNode
              key={child.id}
              dept={child}
              allDepts={allDepts}
              allProfiles={allProfiles}
              siblings={children}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AddDeptForm({
  parentId,
  allDepts,
  onDone,
  indent = 0,
}: {
  parentId: string | null
  allDepts: Department[]
  onDone: () => void
  indent?: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    if (parentId) fd.set('parent_id', parentId)
    startTransition(async () => {
      const result = await createDepartment(fd)
      if (result.error) setError(result.error)
      else { form.reset(); onDone() }
    })
  }

  return (
    <div style={{ marginLeft: indent, marginTop: '0.375rem' }}>
      <form onSubmit={handleSubmit} style={{
        display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center',
        padding: '0.625rem 0.75rem', background: '#f0fdf4', borderRadius: '0.5rem', border: '1px dashed #86efac',
      }}>
        <Plus size={14} color="#16a34a" />
        <input
          name="name"
          required
          placeholder={parentId ? '하위 부서명' : '부서명'}
          style={{ flex: '1 1 120px', padding: '0.3rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #bbf7d0', fontSize: '0.875rem' }}
        />
        <input
          name="description"
          placeholder="설명 (선택)"
          style={{ flex: '2 1 160px', padding: '0.3rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}
        />
        {!parentId && (
          <select
            name="parent_id"
            style={{ flex: '1 1 120px', padding: '0.3rem 0.5rem', borderRadius: '0.25rem', border: '1px solid #e2e8f0', fontSize: '0.8125rem' }}
          >
            <option value="">최상위 부서</option>
            {allDepts.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        )}
        {error && <p style={{ fontSize: '0.75rem', color: '#dc2626', margin: 0, width: '100%' }}>{error}</p>}
        <button
          type="submit"
          disabled={isPending}
          style={{
            background: '#16a34a', color: 'white', border: 'none', borderRadius: '0.25rem',
            padding: '0.3rem 0.75rem', cursor: isPending ? 'not-allowed' : 'pointer', fontSize: '0.8125rem', fontWeight: 500,
          }}
        >
          {isPending ? '추가 중...' : '추가'}
        </button>
        <button type="button" onClick={onDone}
          style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '0.25rem', padding: '0.3rem 0.5rem', cursor: 'pointer', fontSize: '0.8125rem', color: '#64748b' }}>
          취소
        </button>
      </form>
    </div>
  )
}

export default function OrgTree({ departments, allProfiles }: OrgTreeProps) {
  const [showAddRoot, setShowAddRoot] = useState(false)

  const rootDepts = departments
    .filter((d) => d.parent_id === null)
    .sort((a, b) => a.display_order - b.display_order)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
          부서 구조
        </h3>
        <button
          onClick={() => setShowAddRoot((v) => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: '0.375rem',
            padding: '0.4rem 0.875rem', borderRadius: '0.375rem',
            background: '#6366f1', color: 'white',
            border: 'none', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer',
          }}
        >
          <Plus size={14} /> 최상위 부서 추가
        </button>
      </div>

      {showAddRoot && (
        <AddDeptForm
          parentId={null}
          allDepts={departments}
          onDone={() => setShowAddRoot(false)}
          indent={0}
        />
      )}

      {rootDepts.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '3rem 1rem',
          color: '#94a3b8', fontSize: '0.9rem',
          border: '2px dashed #e2e8f0', borderRadius: '0.75rem',
        }}>
          아직 부서가 없습니다. 위 버튼을 눌러 첫 부서를 만들어 보세요.
        </div>
      ) : (
        rootDepts.map((dept) => (
          <DeptNode
            key={dept.id}
            dept={dept}
            allDepts={departments}
            allProfiles={allProfiles}
            siblings={rootDepts}
            depth={0}
          />
        ))
      )}
    </div>
  )
}
