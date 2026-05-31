'use client'

import { useState, useTransition, useCallback } from 'react'
import { Tree, TreeNode } from 'react-organizational-chart'
import {
  DndContext, DragOverlay, useDraggable, useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  Plus, Pencil, Trash2, UserPlus, X, Check, GripVertical,
} from 'lucide-react'
import {
  createDepartment, updateDepartment, deleteDepartment,
  addMember, removeMember,
} from './actions'

export interface Member { id: string; name: string | null; email: string | null }
export interface Department {
  id: string; name: string; description: string | null
  parent_id: string | null; display_order: number; members: Member[]
}

// Check if targetId is a descendant of ancestorId
function isDescendant(targetId: string, ancestorId: string, depts: Department[]): boolean {
  let current = depts.find(d => d.id === targetId)
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true
    current = depts.find(d => d.id === current!.parent_id)
  }
  return false
}

function getDepth(dept: Department, allDepts: Department[]): number {
  let depth = 0
  let cur = dept
  while (cur.parent_id) {
    depth++
    const parent = allDepts.find(d => d.id === cur.parent_id)
    if (!parent) break
    cur = parent
  }
  return depth
}

const HEADER_COLORS = ['#1e1b4b', '#312e81', '#4338ca', '#4f46e5', '#6366f1']

// ── Individual dept card ──────────────────────────────────────────────────────
function DeptCard({
  dept, allDepts, disabled,
  onEdit, onManageMembers, onAddChild,
}: {
  dept: Department
  allDepts: Department[]
  disabled: boolean
  onEdit: (dept: Department) => void
  onManageMembers: (dept: Department) => void
  onAddChild: (parentId: string) => void
}) {
  const [isPending, startTransition] = useTransition()

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: dept.id,
    disabled: disabled || isPending,
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `dept-${dept.id}` })

  const depth = getDepth(dept, allDepts)
  const headerBg = HEADER_COLORS[Math.min(depth, HEADER_COLORS.length - 1)]

  async function handleDelete() {
    if (!confirm(`"${dept.name}" 부서를 삭제하시겠습니까?\n하위 부서가 있으면 삭제되지 않습니다.`)) return
    startTransition(async () => {
      const r = await deleteDepartment(dept.id)
      if (r.error) alert(r.error)
    })
  }

  return (
    <div
      ref={node => { setDragRef(node); setDropRef(node) }}
      style={{ display: 'inline-block', verticalAlign: 'top' }}
    >
      <div style={{
        width: 176,
        borderRadius: 8,
        overflow: 'hidden',
        border: `2px solid ${isOver ? '#6366f1' : isDragging ? '#a5b4fc' : '#e2e8f0'}`,
        boxShadow: isOver
          ? '0 4px 20px rgba(99,102,241,0.25)'
          : isDragging
          ? '0 8px 28px rgba(99,102,241,0.2)'
          : '0 1px 4px rgba(0,0,0,0.08)',
        opacity: isDragging ? 0.3 : isPending ? 0.6 : 1,
        transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
        background: 'white',
      }}>
        {/* Header */}
        <div style={{
          background: headerBg,
          padding: '7px 8px',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}>
          <span
            {...attributes}
            {...listeners}
            title="드래그하여 이동"
            style={{
              cursor: disabled ? 'not-allowed' : 'grab',
              color: 'rgba(255,255,255,0.5)',
              display: 'flex',
              alignItems: 'center',
              touchAction: 'none',
              flexShrink: 0,
            }}
          >
            <GripVertical size={13} />
          </span>
          <span style={{
            flex: 1, fontWeight: 700, fontSize: 12,
            color: 'white',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {dept.name}
          </span>
          {dept.members.length > 0 && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              borderRadius: 999,
              padding: '1px 6px',
              flexShrink: 0,
            }}>
              {dept.members.length}명
            </span>
          )}
        </div>

        {/* Members body */}
        <div style={{ background: 'white', minHeight: 36 }}>
          {dept.members.length === 0 ? (
            <div style={{ padding: '8px 10px', fontSize: 11, color: '#cbd5e1', textAlign: 'center' }}>
              구성원 없음
            </div>
          ) : (
            <div style={{ padding: '5px 10px' }}>
              {dept.members.map(m => (
                <div key={m.id} style={{
                  fontSize: 11, color: '#374151',
                  padding: '2px 0',
                  borderBottom: '1px solid #f3f4f6',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {m.name ?? m.email ?? '이름 없음'}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 3,
            padding: '5px 6px',
            borderTop: '1px solid #f3f4f6',
          }}>
            <ActionBtn title="구성원 관리" onClick={() => onManageMembers(dept)}>
              <UserPlus size={11} />
            </ActionBtn>
            <ActionBtn title="하위부서 추가" onClick={() => onAddChild(dept.id)}>
              <Plus size={11} />
            </ActionBtn>
            <ActionBtn title="부서 수정" onClick={() => onEdit(dept)}>
              <Pencil size={11} />
            </ActionBtn>
            <ActionBtn title="부서 삭제" danger onClick={handleDelete} disabled={isPending}>
              <Trash2 size={11} />
            </ActionBtn>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionBtn({
  children, title, onClick, danger, disabled,
}: {
  children: React.ReactNode; title: string; onClick: () => void
  danger?: boolean; disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 22,
        background: danger ? '#fff5f5' : '#f8fafc',
        border: `1px solid ${danger ? '#fecaca' : '#e2e8f0'}`,
        borderRadius: 4,
        cursor: disabled ? 'not-allowed' : 'pointer',
        color: danger ? '#dc2626' : '#64748b',
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  )
}

// ── Root drop zone ────────────────────────────────────────────────────────────
function RootDropZone() {
  const { setNodeRef, isOver } = useDroppable({ id: 'root' })
  return (
    <div
      ref={setNodeRef}
      style={{
        height: isOver ? 36 : 8,
        marginBottom: 8,
        borderRadius: 8,
        border: `2px dashed ${isOver ? '#6366f1' : 'transparent'}`,
        background: isOver ? '#eef2ff' : 'transparent',
        transition: 'all 0.15s',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, color: '#6366f1', fontWeight: 600,
      }}
    >
      {isOver && '↑ 최상위 부서로 이동'}
    </div>
  )
}

// ── Edit modal ────────────────────────────────────────────────────────────────
function EditDeptModal({
  dept, allDepts, onClose,
}: { dept: Department; allDepts: Department[]; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const r = await updateDepartment(dept.id, fd)
      if (r.error) setError(r.error)
      else onClose()
    })
  }

  return (
    <ModalOverlay onClose={onClose}>
      <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
        부서 수정
      </h3>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={labelStyle}>
          부서명 <span style={{ color: '#dc2626' }}>*</span>
          <input name="name" required defaultValue={dept.name} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          설명
          <input name="description" defaultValue={dept.description ?? ''} placeholder="(선택)" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          상위 부서
          <select name="parent_id" defaultValue={dept.parent_id ?? ''} style={inputStyle}>
            <option value="">최상위 부서</option>
            {allDepts
              .filter(d => d.id !== dept.id && !isDescendant(d.id, dept.id, allDepts))
              .map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={isPending} style={submitBtnStyle}>
            <Check size={13} /> 저장
          </button>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            취소
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ── Add dept modal ────────────────────────────────────────────────────────────
function AddDeptModal({
  parentId, allDepts, onClose,
}: { parentId: string | null; allDepts: Department[]; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const parentName = parentId ? allDepts.find(d => d.id === parentId)?.name : null

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    if (parentId) fd.set('parent_id', parentId)
    startTransition(async () => {
      const r = await createDepartment(fd)
      if (r.error) setError(r.error)
      else onClose()
    })
  }

  return (
    <ModalOverlay onClose={onClose}>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
        부서 추가
      </h3>
      {parentName && (
        <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>
          상위 부서: <strong>{parentName}</strong>
        </p>
      )}
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <label style={labelStyle}>
          부서명 <span style={{ color: '#dc2626' }}>*</span>
          <input name="name" required placeholder="부서명 입력" style={inputStyle} autoFocus />
        </label>
        <label style={labelStyle}>
          설명
          <input name="description" placeholder="(선택)" style={inputStyle} />
        </label>
        {!parentId && (
          <label style={labelStyle}>
            상위 부서
            <select name="parent_id" style={inputStyle}>
              <option value="">최상위 부서</option>
              {allDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
        )}
        {error && <p style={{ fontSize: 12, color: '#dc2626', margin: 0 }}>{error}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button type="submit" disabled={isPending} style={submitBtnStyle}>
            <Plus size={13} /> 추가
          </button>
          <button type="button" onClick={onClose} style={cancelBtnStyle}>
            취소
          </button>
        </div>
      </form>
    </ModalOverlay>
  )
}

// ── Member management modal ───────────────────────────────────────────────────
function ManageMembersModal({
  dept, allProfiles, onClose,
}: { dept: Department; allProfiles: Member[]; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [isPending, startTransition] = useTransition()

  const available = allProfiles.filter(p => {
    if (dept.members.some(m => m.id === p.id)) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (p.name ?? '').toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q)
  })

  async function handleAdd(userId: string) {
    startTransition(async () => {
      const r = await addMember(dept.id, userId)
      if (r.error) alert(r.error)
    })
  }

  async function handleRemove(userId: string) {
    startTransition(async () => { await removeMember(dept.id, userId) })
  }

  return (
    <ModalOverlay onClose={onClose} wide>
      <h3 style={{ margin: '0 0 4px', fontSize: 15, fontWeight: 700, color: '#1e293b' }}>
        구성원 관리
      </h3>
      <p style={{ margin: '0 0 14px', fontSize: 12, color: '#64748b' }}>
        <strong>{dept.name}</strong> — {dept.members.length}명
      </p>

      {/* Current members */}
      {dept.members.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {dept.members.map(m => (
            <span key={m.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#ede9fe', color: '#6d28d9',
              borderRadius: 999, padding: '3px 10px',
              fontSize: 12, fontWeight: 500,
            }}>
              {m.name ?? m.email ?? '이름 없음'}
              <button
                onClick={() => handleRemove(m.id)}
                disabled={isPending}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#7c3aed', display: 'flex' }}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>사용자 추가</div>
        <input
          placeholder="이름 또는 이메일 검색"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={inputStyle}
        />
      </div>

      {/* Available users */}
      <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {available.slice(0, 30).map(p => (
          <button
            key={p.id}
            onClick={() => handleAdd(p.id)}
            disabled={isPending}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: 'white', border: '1px solid #e2e8f0',
              cursor: isPending ? 'not-allowed' : 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ fontWeight: 500, fontSize: 13, color: '#1e293b', flex: 1 }}>
              {p.name ?? '이름 없음'}
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.email}</span>
            <Plus size={12} style={{ color: '#6366f1', flexShrink: 0 }} />
          </button>
        ))}
        {available.length === 0 && (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '12px', textAlign: 'center' }}>
            추가 가능한 사용자가 없습니다
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={onClose} style={cancelBtnStyle}>닫기</button>
      </div>
    </ModalOverlay>
  )
}

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function ModalOverlay({ children, onClose, wide }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(15,23,42,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1rem',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 12,
          padding: '24px',
          width: '100%',
          maxWidth: wide ? 480 : 360,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4,
  fontSize: 12, fontWeight: 600, color: '#374151',
}

const inputStyle: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  outline: 'none',
}

const submitBtnStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  background: '#6366f1', color: 'white',
  border: 'none', borderRadius: 6,
  padding: '8px 0',
  cursor: 'pointer', fontSize: 13, fontWeight: 600,
}

const cancelBtnStyle: React.CSSProperties = {
  flex: 1,
  background: 'transparent', color: '#64748b',
  border: '1px solid #e2e8f0', borderRadius: 6,
  padding: '8px 0',
  cursor: 'pointer', fontSize: 13,
}

// ── Tree renderer (recursive) ─────────────────────────────────────────────────
function renderNodes(
  parentId: string | null,
  allDepts: Department[],
  allProfiles: Member[],
  disabled: boolean,
  onEdit: (dept: Department) => void,
  onManageMembers: (dept: Department) => void,
  onAddChild: (parentId: string) => void,
): React.ReactNode {
  const children = allDepts
    .filter(d => d.parent_id === parentId)
    .sort((a, b) => a.display_order - b.display_order)

  return children.map(dept => {
    const card = (
      <DeptCard
        key={dept.id}
        dept={dept}
        allDepts={allDepts}
        disabled={disabled}
        onEdit={onEdit}
        onManageMembers={onManageMembers}
        onAddChild={onAddChild}
      />
    )
    const grandChildren = allDepts.filter(d => d.parent_id === dept.id)

    if (grandChildren.length === 0) {
      return <TreeNode key={dept.id} label={card} />
    }
    return (
      <TreeNode key={dept.id} label={card}>
        {renderNodes(dept.id, allDepts, allProfiles, disabled, onEdit, onManageMembers, onAddChild)}
      </TreeNode>
    )
  })
}

// ── Main OrgTree component ────────────────────────────────────────────────────
export default function OrgTree({
  departments, allProfiles, companyName,
}: {
  departments: Department[]
  allProfiles: Member[]
  companyName?: string
}) {
  const [activeDeptId, setActiveDeptId] = useState<string | null>(null)
  const [editingDept, setEditingDept] = useState<Department | null>(null)
  const [memberDept, setMemberDept] = useState<Department | null>(null)
  const [addingChildOf, setAddingChildOf] = useState<string | null | undefined>(undefined) // undefined = closed, null = root
  const [isPending, startTransition] = useTransition()

  const rootDepts = departments.filter(d => d.parent_id === null).sort((a, b) => a.display_order - b.display_order)
  const activeDept = activeDeptId ? departments.find(d => d.id === activeDeptId) : null

  const handleEdit = useCallback((dept: Department) => setEditingDept(dept), [])
  const handleManageMembers = useCallback((dept: Department) => setMemberDept(dept), [])
  const handleAddChild = useCallback((parentId: string) => setAddingChildOf(parentId), [])

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveDeptId(null)
    if (!over) return

    const draggedId = active.id as string
    const overId = over.id as string
    let newParentId: string | null = null

    if (overId === 'root') {
      newParentId = null
    } else if (overId.startsWith('dept-')) {
      const targetId = overId.slice(5)
      if (targetId === draggedId) return
      if (isDescendant(targetId, draggedId, departments)) return
      newParentId = targetId
    } else return

    const dragged = departments.find(d => d.id === draggedId)
    if (!dragged || dragged.parent_id === newParentId) return

    startTransition(async () => {
      const fd = new FormData()
      fd.set('name', dragged.name)
      fd.set('description', dragged.description ?? '')
      if (newParentId) fd.set('parent_id', newParentId)
      await updateDepartment(draggedId, fd)
    })
  }

  const companyLabel = (
    <div style={{
      display: 'inline-block',
      background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
      color: 'white',
      padding: '10px 24px',
      borderRadius: 8,
      fontWeight: 800,
      fontSize: 14,
      boxShadow: '0 4px 12px rgba(99,102,241,0.35)',
      letterSpacing: '-0.01em',
    }}>
      {companyName ?? '조직도'}
    </div>
  )

  return (
    <DndContext
      onDragStart={e => setActiveDeptId(e.active.id as string)}
      onDragEnd={onDragEnd}
    >
      <div>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 20,
        }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: '#1e293b' }}>
            부서 구조
          </h3>
          <button
            onClick={() => setAddingChildOf(null)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 6,
              background: '#6366f1', color: 'white',
              border: 'none', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}
          >
            <Plus size={14} /> 최상위 부서 추가
          </button>
        </div>

        <RootDropZone />

        {rootDepts.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '3rem 1rem',
            color: '#94a3b8', fontSize: '0.9rem',
            border: '2px dashed #e2e8f0', borderRadius: 12,
          }}>
            아직 부서가 없습니다. 위 버튼을 눌러 첫 부서를 만들어 보세요.
          </div>
        ) : (
          <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
            <Tree
              label={companyLabel}
              lineWidth="2px"
              lineColor="#c7d2fe"
              lineBorderRadius="6px"
            >
              {renderNodes(null, departments, allProfiles, isPending, handleEdit, handleManageMembers, handleAddChild)}
            </Tree>
          </div>
        )}
      </div>

      {/* DragOverlay */}
      <DragOverlay>
        {activeDept && (
          <div style={{
            width: 176, borderRadius: 8, overflow: 'hidden',
            border: '2px solid #6366f1',
            boxShadow: '0 16px 40px rgba(99,102,241,0.35)',
            background: 'white',
            cursor: 'grabbing',
          }}>
            <div style={{
              background: HEADER_COLORS[Math.min(getDepth(activeDept, departments), HEADER_COLORS.length - 1)],
              padding: '8px 10px',
              fontWeight: 700, fontSize: 12, color: 'white',
            }}>
              {activeDept.name}
            </div>
            <div style={{ padding: '6px 10px', fontSize: 11, color: '#64748b' }}>
              {activeDept.members.length}명
            </div>
          </div>
        )}
      </DragOverlay>

      {/* Modals */}
      {editingDept && (
        <EditDeptModal
          dept={editingDept}
          allDepts={departments}
          onClose={() => setEditingDept(null)}
        />
      )}
      {memberDept && (
        <ManageMembersModal
          dept={memberDept}
          allProfiles={allProfiles}
          onClose={() => setMemberDept(null)}
        />
      )}
      {addingChildOf !== undefined && (
        <AddDeptModal
          parentId={addingChildOf}
          allDepts={departments}
          onClose={() => setAddingChildOf(undefined)}
        />
      )}
    </DndContext>
  )
}
