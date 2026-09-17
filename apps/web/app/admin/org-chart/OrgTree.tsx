'use client'

import { useState, useTransition, useRef, useCallback, useEffect, useLayoutEffect } from 'react'
import { Tree, TreeNode } from 'react-organizational-chart'
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core'
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core'
import type { OrgNode, OrgNodeType, OrgNodeWithChildren } from './OrgNodeCard'
import { NodeCard } from './OrgNodeCard'
import { AddNodeModal, EditNodeModal } from './OrgNodeModals'
import { moveNode, reorderNode } from './actions'
import DeleteNodeModal from './DeleteNodeModal'
import EmptyState from '@/components/ui/EmptyState'
import InlineError from '@/components/ui/InlineError'

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

  const activeNode = nodes.find(n => n.id === activeId) ?? null

  /**
   * 기록을 옮겨 갈 후보. 사람 노드는 소속을 받을 수 없고, 자기 자신과 자기 자손으로 옮기면
   * 지우는 순간 함께 사라진다 — 고를 수 없게 여기서 뺀다(DB 함수도 같은 규칙으로 한 번 더 막는다).
   */
  function transferTargets(node: OrgNode): { id: string; name: string }[] {
    const descendants = new Set<string>()
    const walk = (id: string) => {
      nodes.filter(n => n.parent_id === id).forEach((n) => { descendants.add(n.id); walk(n.id) })
    }
    walk(node.id)
    return nodes
      .filter(n => n.type !== 'person' && n.id !== node.id && !descendants.has(n.id))
      .map(n => ({ id: n.id, name: n.name }))
  }

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

  /**
   * 같은 깊이의 카드 높이를 그 깊이의 가장 큰 것에 맞춘다 — 한 깊이가 한 줄이 된다.
   *
   * 왜 필요한가 (사용자 지적 2026-09-17): 「레벨이 무너졌다」. 원인이 둘이었다.
   *   ① 형제 중에 role(C레벨)이 있으면 department 를 일부러 48px 아래로 밀어 놓았다.
   *      CTO 와 성장지원본부가 같은 깊이인데 시작 y 가 달랐던 것이 이것이다. 지웠다.
   *   ② 트리는 가지마다 제 칸을 쓰므로, 카드 하나가 높으면 **그 가지의 다음 줄만** 내려간다.
   *      부서장·이메일이 있는 카드는 없는 카드보다 높아서, 줄이 가지마다 어긋났다.
   *      그래서 그리는 것이 끝난 뒤 재서 같은 깊이끼리 높이를 맞춘다.
   *
   * 사람 카드는 세로로 쌓이는 칸이라 이 맞춤에서 뺀다(넣으면 그 칸이 통째로 부푼다).
   */
  const alignRows = useCallback(() => {
    const root = containerRef.current
    if (!root) return
    const cards = Array.from(root.querySelectorAll<HTMLElement>('[data-org-depth]'))
    // 재기 전에 지난 회차 값을 지운다 — 안 그러면 한 번 커진 높이가 다시는 안 줄어든다
    for (const c of cards) c.style.minHeight = ''
    const byDepth = new Map<string, HTMLElement[]>()
    for (const c of cards) {
      const d = c.dataset.orgDepth
      if (!d) continue
      const group = byDepth.get(d)
      if (group) group.push(c)
      else byDepth.set(d, [c])
    }
    for (const group of byDepth.values()) {
      const tallest = group.reduce((max, c) => Math.max(max, c.offsetHeight), 0)
      for (const c of group) c.style.minHeight = `${tallest}px`
    }
  }, [])

  useLayoutEffect(() => {
    alignRows()
    // 글꼴이 늦게 오면 높이가 한 번 더 바뀐다 — 그때 다시 잰다
    document.fonts?.ready.then(alignRows).catch(() => {})
  }, [alignRows, nodes, allProfiles])

  function renderNode(node: OrgNodeWithChildren, depth = 1): React.ReactNode {
    const siblings = getSiblings(node)
    const cardEl = (
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
    const card = cardEl

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
    return <EmptyState title="조직도가 아직 비어 있어요" description="회사/조직 노드를 먼저 추가하면 여기에 조직 트리가 그려집니다" />
  }

  const root = roots[0]

  return (
    <>
      {errorMsg && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <InlineError banner onDismiss={() => setErrorMsg(null)}>{errorMsg}</InlineError>
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
            border: 'var(--border-w-2) solid var(--border-color)',
            borderRadius: 'var(--radius)',
            background: 'var(--color-bg)',
            cursor: isPanning.current ? 'grabbing' : 'grab',
            userSelect: 'none',
          }}
          onMouseDown={handlePanDown}
          onMouseMove={handlePanMove}
          onMouseUp={handlePanUp}
          onMouseLeave={handlePanUp}
        >
          {/* Zoom controls */}
          <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10, display: 'flex', gap: 'var(--space-1)', background: 'rgba(255,255,255,0.95)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-1)', boxShadow: 'var(--shadow-sm)' }}>
            <button
              onClick={() => setZoom(z => ({ ...z, scale: Math.min(z.scale * 1.2, 3) }))}
              style={{ width: 32, height: 32, border: 'none', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
              title="확대"
            >+</button>
            <button
              onClick={() => setZoom(z => ({ ...z, scale: Math.max(z.scale / 1.2, 0.2) }))}
              style={{ width: 32, height: 32, border: 'none', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}
              title="축소"
            >−</button>
            <div style={{ width: 1, background: 'var(--color-border)', margin: '4px 2px' }} />
            <button
              onClick={fitToScreen}
              style={{ width: 32, height: 32, border: 'none', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}
              title="화면 맞춤"
            >FIT</button>
            <button
              onClick={() => setZoom({ scale: 1, tx: 50, ty: 30 })}
              style={{ width: 32, height: 32, border: 'none', borderRadius: 'var(--radius)', background: 'transparent', cursor: 'pointer', fontSize: 'var(--fs-2xs)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}
              title="100% 리셋"
            >1:1</button>
          </div>

          {/* Scale indicator */}
          <div style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.85)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.15rem 0.5rem', fontSize: '0.7rem', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            {Math.round(zoom.scale * 100)}%
          </div>

          {/* Help hint */}
          <div style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.8)', border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: '0.15rem 0.5rem', fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)', pointerEvents: 'none' }}>
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
              lineColor="var(--brand-soft-2)"
              lineBorderRadius="8px"
              nodePadding="12px"
            >
              {root.children.map(child => renderNode(child))}
            </Tree>
          </div>
        </div>

        <DragOverlay>
          {activeNode && (
            <div style={{ padding: 'var(--space-2) var(--space-4)', background: 'var(--brand-dark)', color: '#fff', borderRadius: 'var(--radius)', fontSize: 'var(--fs-base)', fontWeight: 600, boxShadow: '0 8px 24px rgba(79,70,229,0.4)', opacity: 0.95, cursor: 'grabbing' }}>
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
        <DeleteNodeModal
          node={deleteConfirm}
          targets={transferTargets(deleteConfirm)}
          onClose={() => setDeleteConfirm(null)}
        />
      )}
    </>
  )
}
