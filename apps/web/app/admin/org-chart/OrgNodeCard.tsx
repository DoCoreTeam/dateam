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

interface Profile {
  id: string
  name: string
  rank: string | null
  position: string | null
  email?: string | null
}

interface CardProps {
  node: OrgNodeWithChildren
  siblings: OrgNodeWithChildren[]
  activeId: string | null
  headName?: string | null
  depth?: number
  allProfiles?: Profile[]
  onAdd: (parentId: string, parentType: OrgNodeType) => void
  onEdit: (node: OrgNode) => void
  onDelete: (node: OrgNode) => void
  onReorder: (nodeId: string, dir: 'up' | 'down', siblingIds: string[]) => void
}

function rankLabel(profile: Profile | undefined, subtitle: string | null): string | null {
  if (!profile) return subtitle
  const r = profile.rank
  const p = profile.position
  if (r && p) return `${r}(${p})`
  if (r) return r
  if (p) return p
  return subtitle
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

function InlineMember({
  person, dark, profile, onEdit, onDelete,
}: {
  person: OrgNodeWithChildren
  dark: boolean
  profile?: Profile
  onEdit: (n: OrgNode) => void
  onDelete: (n: OrgNode) => void
}) {
  const stop = (e: React.PointerEvent) => e.stopPropagation()
  const displayName = profile?.name || person.name
  const label = rankLabel(profile, person.subtitle)
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '0.4rem',
      marginTop: '0.35rem',
      padding: '0.25rem 0.35rem',
      borderRadius: '0.4rem',
      background: dark ? 'rgba(255,255,255,0.08)' : '#f8fafc',
    }}>
      <div style={{
        width: '1.5rem', height: '1.5rem', borderRadius: '50%', flexShrink: 0,
        background: dark ? 'rgba(255,255,255,0.2)' : 'linear-gradient(135deg,#6366f1,#818cf8)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.65rem', fontWeight: 700, color: '#fff',
      }}>
        {displayName.charAt(0)}
      </div>
      <span style={{ fontSize: '0.72rem', color: dark ? 'rgba(255,255,255,0.85)' : '#334155', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {displayName}
        {label && <span style={{ opacity: 0.65 }}> {label}</span>}
      </span>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', borderRadius: '3px', display: 'flex', alignItems: 'center', color: dark ? 'rgba(255,255,255,0.6)' : '#94a3b8', flexShrink: 0 }}
        onPointerDown={stop} onClick={() => onEdit(person)} title="수정"
      >
        <Pencil size={11} />
      </button>
      <button
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', borderRadius: '3px', display: 'flex', alignItems: 'center', color: dark ? 'rgba(255,150,150,0.8)' : '#ef4444', flexShrink: 0 }}
        onPointerDown={stop} onClick={() => onDelete(person)} title="삭제"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

function RoleCard(props: CardProps) {
  const { node, headName, depth = 1 } = props
  const c = TYPE_COLORS.role
  const personChildren = node.children.filter(ch => ch.type === 'person')
  const scale = Math.max(0, depth - 1)
  const fontSize = `${Math.max(0.75, 0.875 - scale * 0.05)}rem`
  const pad = `${Math.max(0.5, 0.75 - scale * 0.1)}rem 1rem ${Math.max(0.5, 0.75 - scale * 0.1)}rem 1.5rem`
  return (
    <DragDropWrapper node={node} activeId={props.activeId}>
      <div style={{ padding: pad }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Crown size={scale > 0 ? 12 : 14} color={c.badge} />
          <span style={{ fontSize, fontWeight: 700, color: c.text }}>{node.name}</span>
        </div>
        {headName && (
          <div style={{ marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Crown size={10} color={c.badge} />
            <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.85)' }}>{headName}</span>
          </div>
        )}
        {personChildren.map(p => (
          <InlineMember key={p.id} person={p} dark profile={props.allProfiles?.find(pr => pr.id === p.user_id)} onEdit={props.onEdit} onDelete={props.onDelete} />
        ))}
        <ActionBar {...props} />
      </div>
    </DragDropWrapper>
  )
}

function DeptCard(props: CardProps) {
  const { node, headName, depth = 1 } = props
  const c = TYPE_COLORS.department
  const personChildren = node.children.filter(ch => ch.type === 'person')
  const scale = Math.max(0, depth - 1)
  const fontSize = `${Math.max(0.72, 0.875 - scale * 0.055)}rem`
  const iconSize = scale > 1 ? 12 : scale > 0 ? 13 : 14
  const padV = Math.max(0.45, 0.75 - scale * 0.1)
  const pad = `${padV}rem 1rem ${padV}rem 1.5rem`
  return (
    <DragDropWrapper node={node} activeId={props.activeId}>
      <div style={{ padding: pad }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Users size={iconSize} color={c.badge} />
          <span style={{ fontSize, fontWeight: 700, color: c.text, flex: 1 }}>{node.name}</span>
        </div>
        {node.subtitle && <p style={{ margin: '0.15rem 0 0', fontSize: '0.68rem', color: 'rgba(255,255,255,0.65)' }}>{node.subtitle}</p>}
        {headName && (
          <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Crown size={10} color={c.badge} />
            <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.85)' }}>{headName}</span>
          </div>
        )}
        <ActionBar {...props} />
      </div>
    </DragDropWrapper>
  )
}

function PersonCard(props: CardProps) {
  const { node } = props
  const profile = props.allProfiles?.find(pr => pr.id === node.user_id)
  // prefer live profile name over the snapshot stored in org_nodes.name
  const displayName = profile?.name || node.name
  const label = rankLabel(profile, node.subtitle)
  return (
    <DragDropWrapper node={node} activeId={props.activeId} droppable={false}>
      <div style={{ padding: '0.35rem 0.75rem 0.35rem 1.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <div style={{
            width: '1.6rem', height: '1.6rem', borderRadius: '50%',
            background: 'linear-gradient(135deg,#6366f1,#818cf8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.68rem', fontWeight: 700, color: '#fff', flexShrink: 0,
          }}>
            {displayName.charAt(0) || <User size={11} />}
          </div>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e293b' }}>{displayName}</div>
            {label && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{label}</div>}
            {profile?.email && <div style={{ fontSize: '0.62rem', color: '#94a3b8', marginTop: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '160px' }}>{profile.email}</div>}
          </div>
        </div>
        <ActionBar {...props} showAdd={false} />
      </div>
    </DragDropWrapper>
  )
}
