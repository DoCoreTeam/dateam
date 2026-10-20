'use client'

// 품목 탭 — 묶음마다 끌어 놓아 순서를 바꾸고, 여러 개 골라 한꺼번에 처리한다.
//
// 찾는 동안에는 걸러진 목록만 보이므로 순서를 바꾸지 않는다 — 안 보이는 품목 사이로 끼워 넣으면
// 사람이 의도하지 않은 자리에 놓인다. 찾기를 비우면 다시 끌 수 있다.
// 지우기는 없다. 지난 견적이 가리키는 품목이 사라지면 안 되므로 판매 중지로 숨긴다.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Check, Copy, PauseCircle, PlayCircle, X } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import EmptyState from '@/components/ui/EmptyState'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import Sensitive from '@/components/crm/Sensitive'
import { ACTION, PRICEBOOK, progress } from '@/lib/terms'
import { selectedCount } from '@/lib/terms/action'
import { readResponse } from '@/lib/crm/api/read-error'
import { useBulkAction } from '@/lib/ui/use-bulk-action'
import type { DetailJson, ItemJson } from './detail-shape'
import { won } from './detail-shape'
import ItemEditModal from './ItemEditModal'
import ItemsBoard from './ItemsBoard'
import { arrange } from '@/lib/crm/ui/price-items-arrange'
import styles from './detail.module.css'

interface Props { data: DetailJson; onSaved: () => void }

type BulkAction = 'stop' | 'resume' | 'confirm' | 'move' | 'duplicate'

export default function ItemsTab({ data, onSaved }: Props) {
  const [editing, setEditing] = useState<ItemJson | 'new' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [hideStopped, setHideStopped] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [moveTo, setMoveTo] = useState('')

  const sections = useMemo(() => {
    const order = [...data.product.sections.map((s) => s.name), ...data.items.map((i) => i.section ?? '기타')]
    return [...new Set(order)]
  }, [data.product.sections, data.items])
  const [items, setItems] = useState<ItemJson[]>(() => arrange(data.items, sections))
  useEffect(() => { setItems(arrange(data.items, sections)) }, [data.items, sections])

  const shown = items.filter((i) => (!hideStopped || i.isActive) && (q.trim() === '' || i.name.toLowerCase().includes(q.trim().toLowerCase())))
  const searching = q.trim() !== ''

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleMany = (ids: string[], on: boolean) => setSelected((s) => { const n = new Set(s); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n })

  /** 끌어 놓은 결과 — 먼저 보이고 저장한다. 실패하면 되돌린다 */
  const saveOrder = async (next: ItemJson[]) => {
    const before = items
    setItems(next)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/pricebook/products/${data.product.id}/items/order`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: next.map((i) => ({ id: i.id, section: i.section ?? '기타', position: i.position })) }),
      })
      const r = await readResponse(res, '순서를 저장하지 못했어요.')
      if (!r.ok) { setItems(before); setError(r.message); return }
      onSaved()
    } catch {
      setItems(before)
      setError('순서를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setBusy(false)
    }
  }

  /*
    여러 개는 한 건 창구를 여러 번 부른다(lib/ui/use-bulk-action — 이 저장소의 일괄작업 표준).
    무엇을 할지는 시작할 때 정해 두고 부품이 같은 일을 고른 것마다 시킨다.
  */
  const pending = useRef<{ action: BulkAction; section: string | null }>({ action: 'stop', section: null })
  const runner = useBulkAction({
    run: async (id) => {
      const res = await fetch(`/api/crm/pricebook/items/${id}/action`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: data.product.id, action: pending.current.action, section: pending.current.section }),
      })
      const r = await readResponse(res, '바꾸지 못했어요.')
      if (!r.ok) throw new Error(r.message ?? '바꾸지 못했어요.')
    },
    labelOf: (id) => items.find((i) => i.id === id)?.name ?? id,
    fallbackMessage: '바꾸지 못했어요. 잠시 후 다시 시도해 주세요.',
    onDone: () => { setSelected(new Set()); onSaved() },
  })
  const bulk = async (action: BulkAction, ids: string[], section?: string) => {
    if (ids.length === 0) return
    setError(null)
    setNote(null)
    pending.current = { action, section: section ?? null }
    await runner.start(ids)
  }
  useEffect(() => {
    const r = runner.result
    if (!r) return
    setNote(PRICEBOOK.bulkDone(r.ok))
    if (r.failed.length > 0) setError(r.failed.map((f) => `${f.label}: ${f.message}`).join(' / '))
  }, [runner.result])
  const working = busy || runner.busy

  const picked = [...selected]

  return (
    <div className={styles.wrap}>
      <div className={styles.itemsBar}>
        <input
          className={`input-field ${styles.search}`}
          type="search"
          value={q}
          placeholder={PRICEBOOK.itemSearch}
          aria-label={PRICEBOOK.itemSearch}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className={styles.boardCheck}>
          <input type="checkbox" checked={hideStopped} onChange={(e) => setHideStopped(e.target.checked)} /> {PRICEBOOK.hideStopped}
        </label>
        <NbButton onClick={() => setEditing('new')} disabled={working}><Plus size={14} /> {PRICEBOOK.newItem}</NbButton>
      </div>

      {picked.length > 0 && (
        <div className={styles.bulkBar} role="toolbar" aria-label={selectedCount(picked.length)}>
          <b>{selectedCount(picked.length)}</b>
          <NbButton variant="ghost" disabled={working} onClick={() => void bulk('stop', picked)}><PauseCircle size={14} /> {PRICEBOOK.stopped}</NbButton>
          <NbButton variant="ghost" disabled={working} onClick={() => void bulk('resume', picked)}><PlayCircle size={14} /> {PRICEBOOK.resume}</NbButton>
          <NbButton variant="ghost" disabled={working} onClick={() => void bulk('confirm', picked)}><Check size={14} /> {PRICEBOOK.confirm}</NbButton>
          <NbButton variant="ghost" disabled={working} onClick={() => void bulk('duplicate', picked)}><Copy size={14} /> {PRICEBOOK.duplicate}</NbButton>
          <select className="input-field" aria-label={PRICEBOOK.moveTo} value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
            <option value="">{PRICEBOOK.moveTo}</option>
            {sections.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <NbButton variant="ghost" disabled={working || !moveTo} onClick={() => void bulk('move', picked, moveTo)}>{working ? progress(ACTION.apply) : ACTION.apply}</NbButton>
          <NbButton variant="ghost" onClick={() => setSelected(new Set())} aria-label={ACTION.clear}><X size={14} /> {ACTION.clear}</NbButton>
        </div>
      )}

      <FormErrorBanner message={error} />
      {note && <p className={styles.small} role="status">{note}</p>}

      {items.length === 0 ? (
        <EmptyState title="품목이 아직 없어요" description="가격표 파일을 올리거나 품목을 더하세요." action={{ label: PRICEBOOK.newItem, onClick: () => setEditing('new') }} />
      ) : searching ? (
        <>
          <p className={styles.small}>{PRICEBOOK.searching}</p>
          <ul className={styles.ruleList}>
            {shown.map((r) => (
              <li key={r.id} className={styles.ruleItem}>
                <label className={styles.boardCheck}>
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`${r.name} ${ACTION.select}`} />
                  <span>{r.name} <span className={styles.small}>{r.section ?? '기타'}</span></span>
                  {!r.isActive && <NbBadge status="note">{PRICEBOOK.stopped}</NbBadge>}
                </label>
                <span><Sensitive>{r.basis === 'RATIO' ? `${Number(r.ratioPct ?? 0)}%` : won(r.unitPriceMinor)}</Sensitive></span>
                <NbButton variant="ghost" onClick={() => setEditing(r)}>{ACTION.edit}</NbButton>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ItemsBoard
          items={shown}
          sections={sections}
          selected={selected}
          busy={working}
          onToggle={toggle}
          onToggleSection={toggleMany}
          onArrange={(next) => {
            // 숨긴 판매 중지 품목도 순서에 남겨 둔다 — 보이는 것만 보내면 숨긴 품목의 자리가 사라진다
            const hidden = items.filter((i) => !next.some((n) => n.id === i.id))
            void saveOrder(arrange([...next, ...hidden], sections))
          }}
          onEdit={(r) => setEditing(r)}
          onDuplicate={(r) => void bulk('duplicate', [r.id])}
        />
      )}

      {editing && (
        <ItemEditModal
          productId={data.product.id}
          item={editing === 'new' ? null : editing}
          sections={sections.length ? sections : data.product.sections.map((x) => x.name)}
          position={editing === 'new' ? data.items.length : editing.position}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onSaved() }}
        />
      )}
    </div>
  )
}
