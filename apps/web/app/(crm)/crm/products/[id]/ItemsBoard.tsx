'use client'

// 품목 판 — 묶음마다 끌어 놓아 순서를 바꾸고, 다른 묶음 칸에 놓으면 그 묶음으로 옮긴다.
//
// 순서는 공용 ReorderList 가 다룬다(손잡이 끌기 + 위아래 단추, 키보드 길). 묶음 사이 옮기기는
// 그 부품이 모르는 일이라, 손잡이를 끌 때 품목 id 를 실어 두고 묶음 칸이 받는다.
// 키보드로는 줄마다 묶음 고르기로 옮긴다 — 끌기만 남기면 마우스 없이는 못 옮긴다.
//
// 저장은 한 번에(순서 창구 한 트랜잭션). 화면은 먼저 바꿔 보이고, 실패하면 되돌리고 사유를 말한다.

import { useMemo, useState, type DragEvent } from 'react'
import { Copy } from 'lucide-react'
import ReorderList from '@/components/ui/ReorderList'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import Sensitive from '@/components/crm/Sensitive'
import { ACTION, PRICEBOOK, ITEM_BASIS_LABEL } from '@/lib/terms'
import type { ItemJson } from './detail-shape'
import { won } from './detail-shape'
import { moveToSection, reorderSection } from '@/lib/crm/ui/price-items-arrange'
import styles from './detail.module.css'

const DRAG_TYPE = 'text/x-price-item'

interface Props {
  items: ItemJson[]
  sections: string[]
  selected: ReadonlySet<string>
  busy: boolean
  onToggle: (id: string) => void
  onToggleSection: (ids: string[], on: boolean) => void
  /** 묶음과 순서를 바꾼 전체 품목 — 부모가 저장한다 */
  onArrange: (next: ItemJson[]) => void
  onEdit: (item: ItemJson) => void
  onDuplicate: (item: ItemJson) => void
}

function priceText(i: ItemJson): string {
  if (i.basis === 'SURVEY') return PRICEBOOK.survey
  if (i.basis === 'RATIO') return `${Number(i.ratioPct ?? 0)}% (${i.ratioOfSection ?? ''})`
  return won(i.unitPriceMinor)
}

const sectionOf = (i: ItemJson) => i.section ?? '기타'

export default function ItemsBoard({ items, sections, selected, busy, onToggle, onToggleSection, onArrange, onEdit, onDuplicate }: Props) {
  const [overSection, setOverSection] = useState<string | null>(null)
  const bySection = useMemo(() => sections.map((s) => ({ name: s, rows: items.filter((i) => sectionOf(i) === s).sort((a, b) => a.position - b.position) })), [items, sections])

  const accepts = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_TYPE)
  const onDrop = (e: DragEvent, section: string) => {
    if (!accepts(e)) return
    const id = e.dataTransfer.getData(DRAG_TYPE)
    setOverSection(null)
    const it = items.find((i) => i.id === id)
    if (!it || sectionOf(it) === section) return
    e.preventDefault()
    onArrange(moveToSection(items, id, section, sections))
  }

  return (
    <div className={styles.board}>
      <p className={styles.small}>{PRICEBOOK.dragHint}</p>
      {bySection.map((sec) => {
        const ids = sec.rows.map((r) => r.id)
        const allOn = ids.length > 0 && ids.every((id) => selected.has(id))
        return (
          <section
            key={sec.name}
            aria-label={sec.name}
            className={`${styles.boardSection} ${overSection === sec.name ? styles.boardOver : ''}`}
            onDragOver={(e) => {
              if (!accepts(e)) return
              e.preventDefault()
              if (overSection !== sec.name) setOverSection(sec.name)
            }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverSection(null) }}
            onDrop={(e) => onDrop(e, sec.name)}
          >
            <header className={styles.boardHead}>
              <label className={styles.boardCheck}>
                <input type="checkbox" checked={allOn} disabled={ids.length === 0} onChange={() => onToggleSection(ids, !allOn)} aria-label={`${sec.name} 전부 ${ACTION.select}`} />
                <b>{sec.name}</b> <span className={styles.small}>{sec.rows.length}</span>
              </label>
              {overSection === sec.name && <span className={styles.small}>{PRICEBOOK.dropHere}</span>}
            </header>
            {sec.rows.length === 0 ? (
              <p className={styles.boardEmpty}>{PRICEBOOK.dropHere}</p>
            ) : (
              <ReorderList
                items={sec.rows}
                getId={(r) => r.id}
                getLabel={(r) => r.name}
                disabled={busy}
                className={styles.boardList}
                itemClassName={styles.boardItem}
                onReorder={(next) => onArrange(reorderSection(items, sec.name, next, sections))}
              >
                {(r, _i, controls) => (
                  <div
                    className={`${styles.boardRow} ${r.isActive ? '' : styles.boardStopped}`}
                    onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, r.id); e.dataTransfer.effectAllowed = 'move' }}
                  >
                    <div className={styles.boardControls}>{controls}</div>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => onToggle(r.id)} aria-label={`${r.name} ${ACTION.select}`} />
                    <button type="button" className={styles.boardName} onClick={() => onEdit(r)}>
                      {r.name}
                      {!r.isActive && <> <NbBadge status="note">{PRICEBOOK.stopped}</NbBadge></>}
                      {r.needsReview && <> <NbBadge status="note">{PRICEBOOK.needsReview}</NbBadge></>}
                      {r.remark && <span className={styles.small}>{r.remark}</span>}
                    </button>
                    <span className={styles.boardPrice}><Sensitive>{priceText(r)}</Sensitive></span>
                    <span className={styles.small}>{`${ITEM_BASIS_LABEL[r.basis as keyof typeof ITEM_BASIS_LABEL] ?? r.basis}${r.unit ? ` · ${r.unit}` : ''}`}</span>
                    <select
                      className={`input-field ${styles.boardSelect}`}
                      aria-label={`${r.name} ${PRICEBOOK.moveTo}`}
                      value={sectionOf(r)}
                      disabled={busy}
                      onChange={(e) => onArrange(moveToSection(items, r.id, e.target.value, sections))}
                    >
                      {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <NbButton variant="ghost" onClick={() => onDuplicate(r)} disabled={busy} aria-label={`${r.name} ${PRICEBOOK.duplicate}`}>
                      <Copy size={14} /> {PRICEBOOK.duplicate}
                    </NbButton>
                  </div>
                )}
              </ReorderList>
            )}
          </section>
        )
      })}
    </div>
  )
}
