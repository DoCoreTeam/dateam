'use client'

// 조항 편집기 — 템플릿과 계약서가 같은 부품을 쓴다 (P0132)
//
// 조항마다 제목과 본문이 따로 있다. 본문을 한 덩어리로 두면 「제7조만 고쳤다」를
// 버전 비교가 말할 수 없다(lib/crm/domain/contract-body.ts).
// 「칸 넣기」는 마지막으로 손댄 조항의 커서 자리에 {{칸 이름}} 을 넣는다.

import dynamic from 'next/dynamic'
import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { CONTRACT_FIELDS, fieldToken } from '@/lib/crm/domain/contract-fields'
import { CONTRACT_TEMPLATE } from '@/lib/terms/contract-doc'
import styles from './contract.module.css'

const TiptapEditor = dynamic(() => import('@/components/ui/TiptapEditor'), { ssr: false })

export interface EditableClause {
  id: string
  title: string
  html: string
  origin?: 'template' | 'manual' | 'ai'
}

interface ClauseEditorProps {
  clauses: EditableClause[]
  onChange: (next: EditableClause[]) => void
  /** 칸 넣기를 보일지 — 계약서 본문은 이미 채운 글이라 칸을 안 넣는다 */
  allowFields?: boolean
  disabled?: boolean
}

function nextId(list: EditableClause[]): string {
  const used = new Set(list.map((c) => c.id))
  let n = list.length + 1
  while (used.has(`c${n}`)) n++
  return `c${n}`
}

export default function ClauseEditor({ clauses, onChange, allowFields = true, disabled = false }: ClauseEditorProps) {
  const [focusId, setFocusId] = useState<string | null>(clauses[0]?.id ?? null)
  const [insert, setInsert] = useState<{ id: string; text: string; seq: number } | null>(null)

  const patch = (id: string, p: Partial<EditableClause>) =>
    onChange(clauses.map((c) => (c.id === id ? { ...c, ...p } : c)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= clauses.length) return
    const next = [...clauses]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  const add = () => {
    const c = { id: nextId(clauses), title: '', html: '<p></p>', origin: 'manual' as const }
    onChange([...clauses, c])
    setFocusId(c.id)
  }
  const insertField = (label: string) => {
    const target = focusId ?? clauses[clauses.length - 1]?.id
    if (!label || !target) return
    setInsert({ id: target, text: fieldToken(label), seq: (insert?.seq ?? 0) + 1 })
  }

  return (
    <div className={styles.clauses}>
      <div className={styles.clauseBar}>
        {allowFields && (
          <label className={styles.fieldPick}>
            <span className="label">{CONTRACT_TEMPLATE.insertField}</span>
            <select
              className="input-field" value="" disabled={disabled || clauses.length === 0}
              onChange={(e) => insertField(e.target.value)}
              aria-label={CONTRACT_TEMPLATE.insertField}
            >
              <option value="">{CONTRACT_TEMPLATE.pickField}</option>
              {CONTRACT_FIELDS.map((f) => <option key={f.key} value={f.label}>{f.label}</option>)}
            </select>
          </label>
        )}
        <NbButton variant="ghost" onClick={add} disabled={disabled}><Plus size={14} /> {CONTRACT_TEMPLATE.addClause}</NbButton>
      </div>
      {allowFields && <p className={styles.help}>{CONTRACT_TEMPLATE.fieldHelp}</p>}
      <ol className={styles.clauseList}>
        {clauses.map((c, i) => (
          <li key={c.id} className={styles.clause} onFocusCapture={() => setFocusId(c.id)}>
            <div className={styles.clauseHead}>
              <input
                className="input-field" value={c.title} disabled={disabled}
                placeholder={CONTRACT_TEMPLATE.clauseTitlePlaceholder}
                aria-label={CONTRACT_TEMPLATE.clauseTitle}
                onChange={(e) => patch(c.id, { title: e.target.value })}
              />
              <button type="button" className={styles.iconBtn} onClick={() => move(i, -1)} disabled={disabled || i === 0} aria-label={CONTRACT_TEMPLATE.moveUp}><ArrowUp size={14} /></button>
              <button type="button" className={styles.iconBtn} onClick={() => move(i, 1)} disabled={disabled || i === clauses.length - 1} aria-label={CONTRACT_TEMPLATE.moveDown}><ArrowDown size={14} /></button>
              <button type="button" className={styles.iconBtn} onClick={() => onChange(clauses.filter((x) => x.id !== c.id))} disabled={disabled} aria-label={CONTRACT_TEMPLATE.removeClause}><Trash2 size={14} /></button>
            </div>
            <TiptapEditor
              value={c.html} enableTable minHeight={72}
              onChange={(html) => patch(c.id, { html })}
              insertRequest={insert && insert.id === c.id ? { text: insert.text, seq: insert.seq } : null}
            />
          </li>
        ))}
      </ol>
    </div>
  )
}
