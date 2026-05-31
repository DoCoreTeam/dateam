'use client'

import { useState, useTransition } from 'react'
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
    .sort((a, b) => a.display_order - b.display_order)
    .map(n => ({ ...n, children: buildTree(nodes, n.id) }))
}

export default function OrgTree({ nodes, allProfiles }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addModal, setAddModal] = useState<{ parentId: string; parentType: OrgNodeType } | null>(null)
  const [editModal, setEditModal] = useState<OrgNode | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<OrgNode | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [, startTransition] = useTransition()

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

  function renderNode(node: OrgNodeWithChildren): React.ReactNode {
    const siblings = getSiblings(node)
    const card = (
      <NodeCard
        node={node}
        siblings={siblings}
        activeId={activeId}
        onAdd={(parentId, parentType) => setAddModal({ parentId, parentType })}
        onEdit={(n) => setEditModal(n)}
        onDelete={(n) => setDeleteConfirm(n)}
        onReorder={handleReorder}
      />
    )
    if (node.children.length === 0) return <TreeNode key={node.id} label={card} />
    return (
      <TreeNode key={node.id} label={card}>
        {node.children.map(child => renderNode(child))}
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
        <div style={{ overflowX: 'auto', padding: '1.5rem 0' }}>
          <Tree
            label={
              <NodeCard
                node={{ ...root, children: root.children }}
                siblings={[root]}
                activeId={activeId}
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
          existingPersonUserIds={nodes.filter(n => n.parent_id === addModal.parentId && n.type === 'person' && n.user_id).map(n => n.user_id!)}
          onClose={() => setAddModal(null)}
        />
      )}

      {editModal && (
        <EditNodeModal node={editModal} allProfiles={allProfiles} onClose={() => setEditModal(null)} />
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
