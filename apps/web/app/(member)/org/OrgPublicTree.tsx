'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { Tree, TreeNode } from 'react-organizational-chart'
import { Building2, Crown, Users, User, Copy, Check } from 'lucide-react'

type OrgNodeType = 'company' | 'role' | 'department' | 'person'

interface OrgNode {
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

interface OrgNodeWithChildren extends OrgNode {
  children: OrgNodeWithChildren[]
}

function buildTree(nodes: OrgNode[], parentId: string | null): OrgNodeWithChildren[] {
  return nodes
    .filter(n => n.parent_id === parentId)
    .sort((a, b) => {
      const diff = a.display_order - b.display_order
      return diff !== 0 ? diff : a.id.localeCompare(b.id)
    })
    .map(n => ({ ...n, children: buildTree(nodes, n.id) }))
}

function CopyEmailBtn({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      title="이메일 복사"
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', color: copied ? '#22c55e' : '#94a3b8', display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle' }}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  )
}

interface NodeCardProps {
  node: OrgNodeWithChildren
  headName?: string | null
  email?: string | null
}

function NodeCard({ node, headName, email }: NodeCardProps) {
  if (node.type === 'company') {
    return (
      <div style={{
        display: 'inline-block', padding: '0.75rem 1.25rem', borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#4f46e5,#7c3aed)', border: '2px solid #4f46e5',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)', minWidth: '140px', maxWidth: '200px', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Building2 size={14} color="#c7d2fe" />
          <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff' }}>{node.name}</span>
        </div>
        {node.subtitle && (
          <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.7)' }}>{node.subtitle}</p>
        )}
      </div>
    )
  }

  if (node.type === 'role') {
    const personChild = node.children.find(ch => ch.type === 'person')
    const displayPerson = personChild
      ? { name: personChild.name, subtitle: personChild.subtitle }
      : headName ? { name: headName, subtitle: null } : null
    return (
      <div style={{
        display: 'inline-block', padding: '0.65rem 1rem', borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#1e1b4b,#312e81)', border: '2px solid #312e81',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)', minWidth: '130px', maxWidth: '200px', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Crown size={13} color="#a5b4fc" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>{node.name}</span>
        </div>
        {displayPerson && (
          <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{ width: '1.35rem', height: '1.35rem', borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff' }}>
              {displayPerson.name.charAt(0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)' }}>
              {displayPerson.name}
              {displayPerson.subtitle && <span style={{ opacity: 0.7 }}> · {displayPerson.subtitle}</span>}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (node.type === 'department') {
    const personChildren = node.children.filter(ch => ch.type === 'person')
    return (
      <div style={{
        display: 'inline-block', padding: '0.65rem 1rem', borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#3730a3,#4338ca)', border: '2px solid #4338ca',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)', minWidth: '120px', maxWidth: '190px', textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Users size={13} color="#c7d2fe" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', flex: 1 }}>{node.name}</span>
          {personChildren.length > 0 && (
            <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: '999px', padding: '1px 6px', flexShrink: 0 }}>
              {personChildren.length}명
            </span>
          )}
        </div>
        {headName && (
          <div style={{ marginTop: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <div style={{ width: '1.1rem', height: '1.1rem', borderRadius: '50%', background: 'rgba(255,255,255,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.55rem', fontWeight: 700, color: '#fff', flexShrink: 0 }}>
              {headName.charAt(0)}
            </div>
            <span style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,0.8)' }}>{headName}</span>
          </div>
        )}
      </div>
    )
  }

  // person
  return (
    <div style={{
      display: 'inline-block', padding: '0.5rem 0.875rem', borderRadius: '0.75rem',
      background: '#fff', border: '2px solid #e2e8f0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)', minWidth: '110px', maxWidth: '180px', textAlign: 'left',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <div style={{
          width: '1.75rem', height: '1.75rem', borderRadius: '50%',
          background: 'linear-gradient(135deg,#6366f1,#818cf8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.7rem', fontWeight: 700, color: '#fff', flexShrink: 0,
        }}>
          {node.name.charAt(0) || <User size={10} />}
        </div>
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#1e293b' }}>{node.name}</div>
          {node.subtitle && <div style={{ fontSize: '0.68rem', color: '#64748b' }}>{node.subtitle}</div>}
          {email && (
            <div style={{ fontSize: '0.62rem', color: '#94a3b8', marginTop: '1px', display: 'flex', alignItems: 'center', gap: '2px' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '130px' }}>{email}</span>
              <CopyEmailBtn email={email} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OrgPublicTree({
  nodes,
  emailMap = {},
  profileMap = {},
}: {
  nodes: OrgNode[]
  emailMap?: Record<string, string>
  profileMap?: Record<string, { name: string; rank: string | null; position: string | null }>
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState({ scale: 0.85, tx: 0, ty: 20 })
  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  function getHeadName(headUserId: string | null): string | null {
    if (!headUserId) return null
    // profileMap 우선, 없으면 person 노드에서 fallback
    const profile = profileMap[headUserId]
    if (profile) {
      const label = profile.position || profile.rank || ''
      return label ? `${profile.name} ${label}` : profile.name
    }
    const personNode = nodes.find(n => n.type === 'person' && n.user_id === headUserId)
    if (personNode) return personNode.subtitle ? `${personNode.name} ${personNode.subtitle}` : personNode.name
    return null
  }

  const fitToScreen = useCallback(() => {
    const container = containerRef.current
    const content = contentRef.current
    if (!container || !content) return
    // 현재 transform 임시 제거 후 자연 크기 측정
    const prev = content.style.transform
    content.style.transform = 'none'
    const naturalW = content.offsetWidth || content.scrollWidth
    const naturalH = content.offsetHeight || content.scrollHeight
    content.style.transform = prev
    if (!naturalW || !naturalH) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    const newScale = Math.min((cw - 40) / naturalW, (ch - 40) / naturalH, 1)
    const newTx = (cw - naturalW * newScale) / 2
    const newTy = Math.max(20, (ch - naturalH * newScale) / 2)
    setZoom({ scale: Math.max(0.15, newScale), tx: newTx, ty: newTy })
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
      return { scale: newScale, tx: mouseX - ratio * (mouseX - z.tx), ty: mouseY - ratio * (mouseY - z.ty) }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  useEffect(() => {
    const timer = setTimeout(fitToScreen, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePanDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const target = e.target as Element
    if (target.closest('button')) return
    isPanning.current = true
    panStart.current = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty }
  }

  function handlePanMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!isPanning.current) return
    const dx = e.clientX - panStart.current.x
    const dy = e.clientY - panStart.current.y
    setZoom(z => ({ ...z, tx: panStart.current.tx + dx, ty: panStart.current.ty + dy }))
  }

  function handlePanUp() { isPanning.current = false }

  function renderNode(node: OrgNodeWithChildren): React.ReactNode {
    const structuralChildren = node.children.filter(ch => ch.type !== 'person')
    const personChildren = node.type === 'department'
      ? node.children.filter(ch => ch.type === 'person')
      : []

    const label = (
      <NodeCard
        node={node}
        headName={(node.type === 'department' || node.type === 'role') ? getHeadName(node.head_user_id) : null}
        email={node.type === 'person' && node.user_id ? emailMap[node.user_id] : undefined}
      />
    )

    if (structuralChildren.length === 0 && personChildren.length === 0) {
      return <TreeNode key={node.id} label={label} />
    }

    return (
      <TreeNode key={node.id} label={label}>
        {structuralChildren.map(child => renderNode(child))}
        {personChildren.length > 0 && (
          <TreeNode label={
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {personChildren.map(p => (
                <NodeCard
                  key={p.id}
                  node={{ ...p, children: [] }}
                  email={p.user_id ? emailMap[p.user_id] : undefined}
                />
              ))}
            </div>
          } />
        )}
      </TreeNode>
    )
  }

  const roots = buildTree(nodes, null)

  if (roots.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
        아직 등록된 조직도 데이터가 없습니다.
      </div>
    )
  }

  const root = roots[0]

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative', overflow: 'hidden',
        height: 'clamp(400px, 70vh, 860px)',
        border: '1px solid #e2e8f0', borderRadius: '0.75rem',
        background: '#f8fafc',
        cursor: isPanning.current ? 'grabbing' : 'grab',
        userSelect: 'none',
      }}
      onMouseDown={handlePanDown}
      onMouseMove={handlePanMove}
      onMouseUp={handlePanUp}
      onMouseLeave={handlePanUp}
    >
      {/* 줌 컨트롤 */}
      <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem', zIndex: 10, display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.95)', border: '1px solid #e2e8f0', borderRadius: '0.5rem', padding: '0.25rem', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <button onClick={() => setZoom(z => ({ ...z, scale: Math.min(z.scale * 1.2, 3) }))} style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>+</button>
        <button onClick={() => setZoom(z => ({ ...z, scale: Math.max(z.scale / 1.2, 0.2) }))} style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '1.1rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>−</button>
        <div style={{ width: 1, background: '#e2e8f0', margin: '4px 2px' }} />
        <button onClick={fitToScreen} style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '0.7rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>FIT</button>
        <button onClick={() => setZoom({ scale: 1, tx: 50, ty: 30 })} style={{ width: 32, height: 32, border: 'none', borderRadius: '0.375rem', background: 'transparent', cursor: 'pointer', fontSize: '0.65rem', color: '#475569', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600 }}>1:1</button>
      </div>

      <div style={{ position: 'absolute', bottom: '0.75rem', right: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.85)', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.15rem 0.5rem', fontSize: '0.7rem', color: '#64748b', pointerEvents: 'none' }}>
        {Math.round(zoom.scale * 100)}%
      </div>
      <div style={{ position: 'absolute', bottom: '0.75rem', left: '0.75rem', zIndex: 10, background: 'rgba(255,255,255,0.8)', border: '1px solid #e2e8f0', borderRadius: '0.375rem', padding: '0.15rem 0.5rem', fontSize: '0.68rem', color: '#94a3b8', pointerEvents: 'none' }}>
        스크롤: 줌 · 드래그: 이동
      </div>

      <div
        ref={contentRef}
        style={{
          position: 'absolute', transformOrigin: '0 0',
          transform: `translate(${zoom.tx}px, ${zoom.ty}px) scale(${zoom.scale})`,
          transition: isPanning.current ? 'none' : 'transform 0.05s',
        }}
      >
        <Tree
          label={<NodeCard node={root} />}
          lineWidth="2px"
          lineColor="#c7d2fe"
          lineBorderRadius="8px"
          nodePadding="12px"
        >
          {root.children
            .filter(ch => ch.type !== 'person')
            .map(child => renderNode(child))}
        </Tree>
      </div>
    </div>
  )
}
