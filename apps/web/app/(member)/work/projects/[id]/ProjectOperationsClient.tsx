'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

type Item = { id: string; kind: string; title: string; status: string }
type Relation = { id: string; entity_type: string; entity_id: string; label: string }
type OptionSet = { type: string; items: Array<{ id: string; label: string }> }

export default function ProjectOperationsClient({ projectId, items, canManage }: {
  projectId: string; items: Item[]; canManage: boolean
}) {
  const router = useRouter()
  const [relations, setRelations] = useState<Relation[]>([])
  const [options, setOptions] = useState<OptionSet[]>([])
  const [type, setType] = useState('daily_log')
  const [entity, setEntity] = useState('')
  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/relations`)
    if (response.ok) { const data = await response.json(); setRelations(data.relations); setOptions(data.options) }
  }, [projectId])
  useEffect(() => { void load() }, [load])

  async function updateItem(id: string, method: string, body?: object) {
    await fetch(`/api/projects/${projectId}/items/${id}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    router.refresh()
  }
  async function link() {
    if (!entity) return
    await fetch(`/api/projects/${projectId}/relations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entityType: type, entityId: entity }) })
    setEntity(''); await load()
  }
  async function unlink(id: string) { await fetch(`/api/projects/${projectId}/relations?relationId=${id}`, { method: 'DELETE' }); await load() }

  return <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    <section><h3 style={{ marginTop: 0 }}>실행 항목</h3>{items.map((item) => <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0' }}><strong>{item.kind}</strong><span style={{ flex: 1 }}>{item.title}</span>{canManage && <><select className="input-field" value={item.status} onChange={(event) => void updateItem(item.id, 'PATCH', { status: event.target.value })} style={{ minHeight: 44, width: 'auto' }}>{['open', 'in_progress', 'blocked', 'done', 'accepted', 'mitigated'].map((status) => <option key={status}>{status}</option>)}</select><button type="button" className="btn-ghost" onClick={() => void updateItem(item.id, 'DELETE')} style={{ minHeight: 44 }}>삭제</button></>}</div>)}</section>
    <section><h3>연결 자료</h3>{relations.map((relation) => <div key={relation.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0' }}><span>{relation.entity_type} · {relation.label}</span>{canManage && <button type="button" className="btn-ghost" onClick={() => void unlink(relation.id)} style={{ minHeight: 44 }}>연결 해제</button>}</div>)}{canManage && <div className="responsive-grid-cols-2" style={{ gap: 8 }}><select className="input-field" value={type} onChange={(event) => { setType(event.target.value); setEntity('') }} style={{ minHeight: 44 }}>{options.map((option) => <option key={option.type} value={option.type}>{option.type}</option>)}</select><select className="input-field" value={entity} onChange={(event) => setEntity(event.target.value)} style={{ minHeight: 44 }}><option value="">연결 대상 선택</option>{options.find((option) => option.type === type)?.items.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><button type="button" className="btn-primary" onClick={() => void link()} disabled={!entity} style={{ minHeight: 44 }}>자료 연결</button></div>}</section>
  </div>
}
