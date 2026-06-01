'use client'

import { useState, useTransition, useRef, useCallback, useEffect } from 'react'
import { Tree, TreeNode } from 'react-organizational-chart'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import type { OrgNode, OrgNodeType, OrgNodeWithChildren } from './OrgNodeCard'
import { NodeCard } from './OrgNodeCard'
import { AddNodeModal, EditNodeModal } from './OrgNodeModals'
import { moveNode, deleteNode, reorderNode } from './actions'

interface Profile {
  id: string
  name: string
  rank: string | null
  position: string | null
}

interface Props {
  nodes: OrgNode[]
  allProfiles: Profile[]
}

function buildTree(nodes: OrgNode[], parentId: string | null): OrgNodeWithChildren[] {
  return nodes
    .filter(n => n.parent_id === parentId)
    .sort((a, b) => {
      const diff = a.display_order - b.display_order
      if (diff !== 0) return diff
      return a.id.localeCompare(b.id)
    })
    .map(n => ({ ...n, children: buildTree(nodes, n.id) }))
}

export default function OrgTree({ nodes, allProfiles }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addModal, setAddModal] = useState<{ parentId: string; parentType: OrgNodeType } | null>(null)
  const [editModal, setEditModal] = useState<OrgNode | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<OrgNode | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState({ scale: 0.85, tx: 0, ty: 20 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  const fitToScreen = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const naturalW = content.scrollWidth
    const naturalH = content.scrollHeight
    const newScale = Math.min((cw - 40) / naturalW, (ch - 40) / naturalH, 1)
    const newTx = (cw - naturalW * newScale) / 2
    setZoom({ scale: Math.max(0.2, newScale), tx: newTx, ty: 20 })
  }, [])

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    const delta = e.deltaY > 0 ? 1 / 1.1 : 1.1
    setZoom(z => {
      const newScale = Math.max(0.2, Math.min(3, z.scale * delta))
      const ratio = newScale / z.scale
      return {
        scale: newScale,
        tx: mouseX - ratio * (mouseX - z.tx),
        ty: mouseY - ratio * (mouseY - z.ty),
      }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  useEffect(() => {
    const timer = setTimeout(fitToScreen, 150)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePanDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const target = e.target as Element
    if (target.closest('button') || target.closest('[data-drag-handle]')) return
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty }
  }

  function handlePanMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setZoom(z => ({ ...z, tx: panStart.current.tx + dx, ty: panStart.current.ty + dy }))
  }

  function handlePanUp() {
    isPanning.current = false
  }

  const roots = buildTree(nodes, null)

  function handleDragStart(e: DragStartEvent) {
    setActiveId(e.active.id as string)
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const targetNode = nodes.find(n => n.id === (over.id as string))
    if (!targetNode || targetNode.type === 'person') return
    startTransition(async () => {
      const res = await moveNode(active.id as string, over.id as string)
      if (res.error) setErrorMsg(res.error)
    })
  }

  function handleReorder(nodeId: string, dir: 'up' | 'down', siblingIds: string[]) {
    startTransition(async () => {
      await reorderNode(nodeId, dir, siblingIds)
    })
  }

  function confirmDelete() {
    if (!deleteConfirm) return
    const target = deleteConfirm
    setDeleteConfirm(null)
    startTransition(async () => {
      const res = await deleteNode(target.id)
      if (res.error) setErrorMsg(res.error)
    })
  }

  const activeNode = nodes.find(n => n.id === activeId) ?? null

  function getSiblings(node: OrgNode): OrgNodeWithChildren[] {
    return nodes
      .filter(n => n.parent_id === node.parent_id)
      .sort((a, b) => a.display_order - b.display_order)
      .map(n => ({ ...n, children: buildTree(nodes, n.id) }))
  }

  function getHeadName(node: OrgNode): string | null {
    if (!node.head_user_id) return null
    const profile = allProfiles.find(p => p.id === node.head_user_id)
    if (!profile) return null
    const r = profile.rank
    const pos = profile.position
    if (r && pos) return `${profile.name} ${r}(${pos})`
    if (r) return `${profile.name} ${r}`
    if (pos) return `${profile.name} ${pos}`
    return profile.name
  }

  function getHeadEmail(node: OrgNode): string | null {
    // head_user_id 우선, 없으면 role의 첫 번째 person child
    const uid = node.head_user_id
      ?? (node as OrgNodeWithChildren).children?.find(c => c.type === 'person')?.user_id
      ?? null
    if (!uid) return null
    const profile = allProfiles.find(p => p.id === uid)
    return (profile as Profile & { email?: string | null })?.email ?? null
  }

  function renderNode(node: OrgNodeWithChildren, depth = 1): React.ReactNode {
    const siblings = getSiblings(node)
    const card = (
      <NodeCard
        node={node}
        siblings={siblings}
        activeId={activeId}
        headName={getHeadName(node)}
        headEmail={getHeadEmail(node)}
        depth={depth}
        allProfiles={allProfiles}
        onAdd={(parentId, parentType) => setAddModal({ parentId, parentType })}
        onEdit={(n) => setEditModal(n)}
        onDelete={(n) => setDeleteConfirm(n)}
        onReorder={handleReorder}
      />
    )
    // role: persons shown inline in card — exclude from tree
    // department: persons shown as vertical column (single tree branch) — exclude from horizontal siblings
    const structuralChildren = (node.type === 'role' || node.type === 'department')
      ? node.children.filter(ch => ch.type !== 'person')
      : node.children

    const personColumn = node.type === 'department'
      ? node.children.filter(ch => ch.type === 'person')
      : []

    if (structuralChildren.length === 0 && personColumn.length === 0) {
      return <TreeNode key={node.id} label={card} />
    }

    return (
      <TreeNode key={node.id} label={card}>
        {structuralChildren.map(child => renderNode(child, depth + 1))}
        {personColumn.length > 0 && (
          <TreeNode label={
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {personColumn.map(p => (
                <NodeCard
                  key={p.id}
                  node={{ ...p, children: [] }}
                  siblings={personColumn.map(pk => ({ ...pk, children: [] }))}
                  activeId={activeId}
                  headName={null}
                  depth={depth + 1}
                  allProfiles={allProfiles}
                  onAdd={(parentId, parentType) => setAddModal({ parentId, parentType })}
                  onEdit={(n) => setEditModal(n)}
                  onDelete={(n) => setDeleteConfirm(n)}
                  onReorder={handleReorder}
                />
              ))}
            </div>
          } />
        )}
      </TreeNode>
    )
  }

  if (roots.length === 0) {
    return <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>조직도 데이터가 없습니다.</div>
  }

  const root = roots[0]

  return (
    <>
      {errorMsg && (
        <div style={{ marginBottom: '1rem', padding: '0.75rem 1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '0.5rem', color: '#dc2626', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
          {errorMsg}
          <button onClick={() => setErrorMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontWeight: 700 }}>×</button>
        </div>
      )}

      <DndContext collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        {/* Zoom/Pan Canvas */}
        <div
          ref={containerRef}
          style={{
            position: 'relative',
            overflow: 'hidden',
            height: 'clamp(400px, 65vh, 800px)',
            border: '1px solid #e2e8f0',
            borderRadius: '0.75rem',
            background: '#f8fafc',
            cursor: isPanning.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          onMouseDown={handlePanDown}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanUp}
          onMouseLeave={handlePanUp}
        >
          {/* Zoom controls */}
          <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10, display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.95)', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            <button
              onClick={() => setZoom(z => ({ ...z, scale: Math.min(z.scale * 1.2, 3) }))}
              style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
              title="확대"
            >+</button>
            <button
              onClick={() => setZoom(z => ({ ...z, scale: Math.max(z.scale / 1.2, 0.2) }))}
              style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
              title="축소"
            >−</button>
            <div style={{ width: 1, background: '#e2e8f0', margin: '4px 2px' }} />
            <button
              onClick={fitToScreen}
              style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '0.7rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}
              title="화면 맞춤"
            >FIT</button>
            <button
              onClick={() => setZoom({ scale: 1, tx: 50, ty: 30 })}
              style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '0.65rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}
              title="100% 리셋"
            >1:1</button>
          </div>

          {/* Scale indicator */}
          <div style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.85)', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.15rem 0.5rem', fontSize: '0.7rem', color: '#64748b', pointerEvents: 'none' }}>
            {Math.round(zoom.scale * 100)}%
          </div>

          {/* Help hint */}
          <div style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.8)', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.15rem 0.5rem', fontSize: '0.68rem', color: '#94a3b8', pointerEvents: 'none' }}>
            스크롤: 줌 · 드래그: 이동
          </div>

          {/* Transformed content */}
          <div
            ref={contentRef}
            style={{
              position: 'absolute',
              transformOrigin: '0 0',
              transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
              transition: isPanning.current ? 'none' : 'transform 0.05s',
            }}
          >
            <Tree
              label={
                <NodeCard
                  node={{ ...root, children: root.children }}
                  siblings={[root]}
                  activeId={activeId}
                  headName={getHeadName(root)}
                  headEmail={getHeadEmail(root)}
                  depth={0}
                  allProfiles={allProfiles}
                  onAdd={(parentId, parentType) => setAddModal({ parentId, parentType })}
                  onEdit={(n) => setEditModal(n)}
                  onDelete={(n) => setDeleteConfirm(n)}
                  onReorder={handleReorder}
                />
              }
              lineWidth="2px"
              lineColor="#c7d2fe"
              lineBorderRadius="8px"
              nodePadding="12px"
            >
              {root.children.map(child => renderNode(child))}
            </Tree>
          </div>
        </div>

        <DragOverlay>
          {activeNode && (
            <div style={{ padding: '0.5rem 1rem', background: '#4f46e5', color: '#fff', borderRadius: '0.5rem', fontSize: '0.875rem', fontWeight: 600, boxShadow: '0 8px 24px rgba(79,70,229,0.4)', opacity: 0.95, cursor: 'grabbing' }}>
              {activeNode.name}
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {addModal && (
        <AddNodeModal
          parentId={addModal.parentId}
          parentType={addModal.parentType}
          allProfiles={allProfiles}
          existingPersonUserIds={nodes.filter(n => n.type === 'person' && n.user_id).map(n => n.user_id!)}
          onClose={() => setAddModal(null)}
        />
      )}

      {editModal && (
        <EditNodeModal node={editModal} allProfiles={allProfiles} allNodes={nodes} onClose={() => setEditModal(null)} />
      )}

      {deleteConfirm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
          <div style={{ background: '#fff', borderRadius: '0.75rem', padding: '1.5rem', width: '340px', boxShadow: '0 20px 40px rgba(0,0,0,0.15)' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', fontWeight: 700 }}>삭제 확인</h3>
            <p style={{ margin: '0 0 1.25rem', color: '#475569', fontSize: '0.875rem' }}>
              <strong>{deleteConfirm.name}</strong>을(를) 삭제하시겠습니까?
              {deleteConfirm.type !== 'person' && ' 하위 노드가 있으면 삭제할 수 없습니다.'}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={() => setDeleteConfirm(null)} style={{ padding: '0.45rem 1rem', background: '#f1f5f9', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem', color: '#475569' }}>취소</button>
              <button onClick={confirmDelete} style={{ padding: '0.45rem 1rem', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', fontSize: '0.875rem' }}>삭제</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
