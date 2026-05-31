'use client'

import { GripVertical, Plus, Pencil, Trash2, Crown, ChevronUp, ChevronDown, Building2, User, Users } from 'lucide-react'
import { useDraggable, useDroppable } from '@dnd-kit/core'

export type OrgNodeType = 'company' | 'role' | 'department' | 'person'

export interface OrgNode {
  id: string
  type: OrgNodeType
  parent_id: string | null
  name: string
  subtitle: string | null
  display_order: number
  head_user_id: string | null
  user_id: string | null
  color: string | null
}

export interface OrgNodeWithChildren extends OrgNode {
  children: OrgNodeWithChildren[]
}

const TYPE_COLORS: Record<OrgNodeType, { bg: string; border: string; text: string; badge: string }> = {
  company: { bg: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '#4f46e5', text: '#fff', badge: '#c7d2fe' },
  role:    { bg: 'linear-gradient(135deg,#1e1b4b,#312e81)', border: '#312e81', text: '#fff', badge: '#a5b4fc' },
  department: { bg: 'linear-gradient(135deg,#3730a3,#4338ca)', border: '#4338ca', text: '#fff', badge: '#c7d2fe' },
  person: { bg: '#ffffff', border: '#e2e8f0', text: '#1e293b', badge: '#ede9fe' },
}

interface CardProps {
  node: OrgNodeWithChildren
  siblings: OrgNodeWithChildren[]
  activeId: string | null
  headName?: string | null
  onAdd: (parentId: string, parentType: OrgNodeType) => void
  onEdit: (node: OrgNode) => void
  onDelete: (node: OrgNode) => void
  onReorder: (nodeId: string, dir: 'up' | 'down', siblingIds: string[]) => void
}

export function NodeCard(props: CardProps) {
  const { node } = props
  switch (node.type) {
    case 'company':    return <CompanyCard {...props} />
    case 'role':       return <RoleCard {...props} />
    case 'department': return <DeptCard {...props} />
    case 'person':     return <PersonCard {...props} />
  }
}

function DragDropWrapper({
  node, activeId, children, droppable = true,
}: {
  node: OrgNode; activeId: string | null; children: React.ReactNode; droppable?: boolean
}) {
  const { setNodeRef: setDragRef, attributes, listeners } = useDraggable({ id: node.id })
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: node.id, disabled: !droppable })

  const mergedRef = (el: HTMLElement | null) => {
    setDragRef(el)
    if (droppable) setDropRef(el)
  }

  const c = TYPE_COLORS[node.type]
  const isBeingDragged = activeId === node.id

  return (
    <div
      ref={mergedRef}
      {...attributes}
      {...listeners}
      style={{
        display: 'inline-block',
        position: 'relative',
        borderRadius: '0.75rem',
        background: node.type === 'person' ? '#fff' : c.bg,
        border: `2px solid ${isOver ? '#818cf8' : c.border}`,
        boxShadow: isOver
          ? '0 0 0 3px rgba(99,102,241,0.25), 0 4px 12px rgba(0,0,0,0.1)'
          : '0 2px 8px rgba(0,0,0,0.08)',
        opacity: isBeingDragged ? 0.4 : 1,
        transition: 'box-shadow 0.15s, border-color 0.15s',
        minWidth: '160px',
        maxWidth: '220px',
        cursor: 'grab',
        touchAction: 'none',
        verticalAlign: 'top',
      }}
    >
      {/* Drag handle — visual only */}
      <div
        style={{
          position: 'absolute', top: '6px', left: '6px',
          color: node.type === 'person' ? '#94a3b8' : 'rgba(255,255,255,0.5)',
          pointerEvents: 'none',
        }}
      >
        <GripVertical size={13} />
      </div>
      {/* Drop indicator */}
      {isOver && (
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '0.65rem',
          background: 'rgba(99,102,241,0.08)', pointerEvents: 'none', zIndex: 1,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <span style={{ fontSize: '0.7rem', color: '#6366f1', fontWeight: 700, background: '#eef2ff', padding: '2px 8px', borderRadius: '999px' }}>
            여기로 이동
          </span>
        </div>
      )}
      {children}
    </div>
  )
}

function ActionBar({
  node, siblings, onAdd, onEdit, onDelete, onReorder, showAdd = true,
}: CardProps & { showAdd?: boolean }) {
  const siblingIds = siblings.map(s => s.id)
  const idx = siblingIds.indexOf(node.id)
  const btnStyle = {
    background: 'none', border: 'none', cursor: 'pointer', padding: '3px',
    borderRadius: '4px', color: node.type === 'person' ? '#94a3b8' : 'rgba(255,255,255,0.7)',
    display: 'flex', alignItems: 'center',
  }
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginTop: '6px', justifyContent: 'flex-end' }}>
      {idx > 0 && (
        <button style={btnStyle} onPointerDown={stop} onClick={() => onReorder(node.id, 'up', siblingIds)} title="위로">
          <ChevronUp size={13} />
        </button>
      )}
      {idx < siblings.length - 1 && (
        <button style={btnStyle} onPointerDown={stop} onClick={() => onReorder(node.id, 'down', siblingIds)} title="아래로">
          <ChevronDown size={13} />
        </button>
      )}
      {showAdd && (
        <button style={btnStyle} onPointerDown={stop} onClick={() => onAdd(node.id, node.type)} title="하위 추가">
          <Plus size={13} />
        </button>
      )}
      <button style={btnStyle} onPointerDown={stop} onClick={() => onEdit(node)} title="수정">
        <Pencil size={13} />
      </button>
      <button style={{ ...btnStyle, color: node.type === 'person' ? '#ef4444' : 'rgba(255,150,150,0.9)' }} onPointerDown={stop} onClick={() => onDelete(node)} title="삭제">
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function CompanyCard(props: CardProps) {
  const { node } = props
  const c = TYPE_COLORS.company
  return (
    <DragDropWrapper node={node} activeId={props.activeId}>
      <div style={{ padding: '0.75rem 1rem 0.75rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Building2 size={16} color={c.badge} />
          <span style={{ fontSize: '0.95rem', fontWeight: 800, color: c.text }}>{node.name}</span>
        </div>
        {node.subtitle && <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'rgba(255,255,255,0.7)' }}>{node.subtitle}</p>}
        <ActionBar {...props} />
      </div>
    </DragDropWrapper>
  )
}

function RoleCard(props: CardProps) {
  const { node, headName } = props
  const c = TYPE_COLORS.role
  const personChild = props.node.children.find(ch => ch.type === 'person')
  return (
    <DragDropWrapper node={node} activeId={props.activeId}>
      <div style={{ padding: '0.75rem 1rem 0.75rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Crown size={14} color={c.badge} />
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: c.text }}>{node.name}</span>
        </div>
        {personChild && (
          <div style={{ marginTop: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{
              width: '1.5rem', height: '1.5rem', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: '#fff',
            }}>
              {personChild.name.charAt(0)}
            </div>
            <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.85)' }}>
              {personChild.name}
              {personChild.subtitle && <span style={{ opacity: 0.7 }}> · {personChild.subtitle}</span>}
            </span>
          </div>
        )}
        <ActionBar {...props} />
      </div>
    </DragDropWrapper>
  )
}

function DeptCard(props: CardProps) {
  const { node } = props
  const c = TYPE_COLORS.department
  const personCount = node.children.filter(ch => ch.type === 'person').length
  return (
    <DragDropWrapper node={node} activeId={props.activeId}>
      <div style={{ padding: '0.75rem 1rem 0.75rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={14} color={c.badge} />
          <span style={{ fontSize: '0.875rem', fontWeight: 700, color: c.text, flex: 1 }}>{node.name}</span>
          {personCount > 0 && (
            <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: '999px', padding: '1px 7px', flexShrink: 0 }}>
              {personCount}명
            </span>
          )}
        </div>
        {node.subtitle && <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.65)' }}>{node.subtitle}</p>}
        <ActionBar {...props} />
      </div>
    </DragDropWrapper>
  )
}

function PersonCard(props: CardProps) {
  const { node } = props
  return (
    <DragDropWrapper node={node} activeId={props.activeId} droppable={false}>
      <div style={{ padding: '0.65rem 0.875rem 0.65rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div style={{
            width: '2rem', height: '2rem', borderRadius: '50%',
            background: 'linear-gradient(135deg,#6366f1,#818cf8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.75rem', fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {node.name.charAt(0) || <User size={12} />}
          </div>
          <div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#1e293b' }}>{node.name}</div>
            {node.subtitle && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{node.subtitle}</div>}
          </div>
        </div>
        <ActionBar {...props} showAdd={false} />
      </div>
    </DragDropWrapper>
  )
}
