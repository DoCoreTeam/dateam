'use client'

import { Tree, TreeNode } from 'react-organizational-chart'
import { Building2, Crown, Users, User } from 'lucide-react'

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
    .sort((a, b) => a.display_order - b.display_order)
    .map(n => ({ ...n, children: buildTree(nodes, n.id) }))
}

function NodeCard({ node }: { node: OrgNodeWithChildren }) {
  if (node.type === 'company') {
    return (
      <div style={{
        display: 'inline-block',
        padding: '0.75rem 1.25rem',
        borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#4f46e5,#7c3aed)',
        border: '2px solid #4f46e5',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        minWidth: '140px',
        maxWidth: '200px',
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Building2 size={14} color="#c7d2fe" />
          <span style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff' }}>{node.name}</span>
        </div>
        {node.subtitle && <p style={{ margin: '0.2rem 0 0', fontSize: '0.72rem', color: 'rgba(255,255,255,0.7)' }}>{node.subtitle}</p>}
      </div>
    )
  }

  if (node.type === 'role') {
    const personChild = node.children.find(ch => ch.type === 'person')
    return (
      <div style={{
        display: 'inline-block',
        padding: '0.65rem 1rem',
        borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#1e1b4b,#312e81)',
        border: '2px solid #312e81',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        minWidth: '130px',
        maxWidth: '200px',
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Crown size={13} color="#a5b4fc" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>{node.name}</span>
        </div>
        {personChild && (
          <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <div style={{
              width: '1.35rem', height: '1.35rem', borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: '#fff',
            }}>
              {personChild.name.charAt(0)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.85)' }}>
              {personChild.name}
              {personChild.subtitle && <span style={{ opacity: 0.7 }}> · {personChild.subtitle}</span>}
            </span>
          </div>
        )}
      </div>
    )
  }

  if (node.type === 'department') {
    const personCount = node.children.filter(ch => ch.type === 'person').length
    return (
      <div style={{
        display: 'inline-block',
        padding: '0.65rem 1rem',
        borderRadius: '0.75rem',
        background: 'linear-gradient(135deg,#3730a3,#4338ca)',
        border: '2px solid #4338ca',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        minWidth: '120px',
        maxWidth: '190px',
        textAlign: 'left',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <Users size={13} color="#c7d2fe" />
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff', flex: 1 }}>{node.name}</span>
          {personCount > 0 && (
            <span style={{ fontSize: '0.65rem', background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: '999px', padding: '1px 6px', flexShrink: 0 }}>
              {personCount}명
            </span>
          )}
        </div>
        {node.subtitle && <p style={{ margin: '0.15rem 0 0', fontSize: '0.7rem', color: 'rgba(255,255,255,0.65)' }}>{node.subtitle}</p>}
      </div>
    )
  }

  // person
  return (
    <div style={{
      display: 'inline-block',
      padding: '0.5rem 0.875rem',
      borderRadius: '0.75rem',
      background: '#fff',
      border: '2px solid #e2e8f0',
      boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      minWidth: '110px',
      maxWidth: '170px',
      textAlign: 'left',
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
        </div>
      </div>
    </div>
  )
}

function renderNode(node: OrgNodeWithChildren): React.ReactNode {
  const nonPersonChildren = node.children.filter(ch => ch.type !== 'person' || node.type === 'role')
  const displayChildren = node.type === 'role'
    ? []
    : node.children.filter(ch => ch.type !== 'person')

  const label = <NodeCard node={node} />

  if (displayChildren.length === 0) {
    return <TreeNode key={node.id} label={label} />
  }
  return (
    <TreeNode key={node.id} label={label}>
      {displayChildren.map(child => renderNode(child))}
    </TreeNode>
  )
}

export default function OrgPublicTree({ nodes }: { nodes: OrgNode[] }) {
  const roots = buildTree(nodes, null)

  if (roots.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
        아직 등록된 조직도 데이터가 없습니다.
      </div>
    )
  }

  const root = roots[0]
  const nonPersonChildren = root.children.filter(ch => ch.type !== 'person')

  return (
    <div style={{ overflowX: 'auto', padding: '1.5rem 0' }}>
      <Tree
        label={<NodeCard node={root} />}
        lineWidth="2px"
        lineColor="#c7d2fe"
        lineBorderRadius="8px"
        nodePadding="12px"
      >
        {nonPersonChildren.map(child => renderNode(child))}
      </Tree>
    </div>
  )
}
