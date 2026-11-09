'use client'

// 계약 모듈 고치기 창 — 넣을 조항과 켜는 조건 (P0184 I11)
//
// 조건은 줄마다 「칸 · 비교 · 값」이고 모든 줄이 맞아야 켜진다. 판정은 서버의
// conditionHolds 가 한다. 여기서는 그 모양대로 받아 넘기기만 한다.

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbModal from '@/components/ui/nb/NbModal'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import RecordPickerField, { type RecordSearch } from '@/components/ui/RecordPicker'
import { ACTION, progress } from '@/lib/terms'
import { CONTRACT_MODULE_CARD, CONTRACT_MODULE_KIND } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'

export type ModuleKind = keyof typeof CONTRACT_MODULE_KIND
type FieldKind = 'direction' | 'businessTypeKey' | 'value'
type Op = 'in' | 'notIn' | 'truthy'

export interface RuleDraft {
  field: FieldKind
  valueKey: string
  op: Op
  values: string
}

export interface ModuleDraft {
  id: string | null
  key: string
  kind: ModuleKind
  title: string
  clauseKeys: string[]
  rules: RuleDraft[]
  isActive: boolean
  position: number
  version: number
}

export interface ClauseOption {
  key: string
  title: string
}

interface Props {
  draft: ModuleDraft
  clauses: readonly ClauseOption[]
  busy: boolean
  error: string | null
  onChange: (next: ModuleDraft) => void
  onSave: () => void
  onClose: () => void
}

const EMPTY_RULE: RuleDraft = { field: 'direction', valueKey: '', op: 'in', values: '' }

/** 화면 줄을 서버가 받는 조건 모양으로. 줄이 없으면 null(고를 때만) */
export function rulesToCondition(rules: readonly RuleDraft[]): { all: unknown[] } | null {
  if (rules.length === 0) return null
  return {
    all: rules.map((r) => {
      const field = r.field === 'value' ? `value.${r.valueKey.trim()}` : r.field
      if (r.op === 'truthy') return { field, op: r.op }
      return { field, op: r.op, values: r.values.split(',').map((v) => v.trim()).filter(Boolean) }
    }),
  }
}

/** 서버 조건을 화면 줄로 */
export function conditionToRules(cond: { all?: { field: string; op: Op; values?: string[] }[] } | null): RuleDraft[] {
  return (cond?.all ?? []).map((r) => {
    const isValue = r.field.startsWith('value.')
    return {
      field: isValue ? 'value' : (r.field as FieldKind),
      valueKey: isValue ? r.field.slice('value.'.length) : '',
      op: r.op,
      values: (r.values ?? []).join(', '),
    }
  })
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [x] = next.splice(from, 1)
  next.splice(to, 0, x)
  return next
}

export default function ContractModuleEditor({ draft, clauses, busy, error, onChange, onSave, onClose }: Props) {
  const titleOf = new Map(clauses.map((c) => [c.key, c.title]))
  const unpicked = clauses.filter((c) => !draft.clauseKeys.includes(c.key))
  // 조항 목록은 카드가 통째로 받아 둔다(상한 없음) — 그 안에서 거르면 빠지는 것이 없다
  const searchClauses: RecordSearch = async (query) => {
    const q = query.trim().toLowerCase()
    return unpicked
      .filter((c) => !q || c.key.includes(q) || c.title.toLowerCase().includes(q))
      .map((c) => ({ id: c.key, name: c.title, hint: c.key }))
  }
  const setRule = (i: number, patch: Partial<RuleDraft>) =>
    onChange({ ...draft, rules: draft.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  return (
    <NbModal
      title={draft.id ? CONTRACT_MODULE_CARD.editTitle : CONTRACT_MODULE_CARD.create}
      onClose={() => !busy && onClose()}
      maxWidth={760}
      footer={
        <div className={styles.foot}>
          <span />
          <span className={styles.itemActions}>
            <NbButton variant="ghost" onClick={onClose} disabled={busy}>{ACTION.cancel}</NbButton>
            <NbButton onClick={onSave} disabled={busy}>{busy ? progress(ACTION.save) : ACTION.save}</NbButton>
          </span>
        </div>
      }
    >
      <div className={styles.form}>
        <FormErrorBanner message={error} />
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-key">{CONTRACT_MODULE_CARD.key}</label>
            <input id="cm-key" className="input-field" value={draft.key} disabled={Boolean(draft.id)}
              placeholder={CONTRACT_MODULE_CARD.keyPlaceholder} onChange={(e) => onChange({ ...draft, key: e.target.value })} />
            <p className={styles.desc}>{CONTRACT_MODULE_CARD.keyHelp}</p>
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-kind">{CONTRACT_MODULE_CARD.kind}</label>
            <select id="cm-kind" className="input-field" value={draft.kind} disabled={Boolean(draft.id)}
              onChange={(e) => onChange({ ...draft, kind: e.target.value as ModuleKind })}>
              {(Object.keys(CONTRACT_MODULE_KIND) as ModuleKind[]).map((k) => (
                <option key={k} value={k}>{CONTRACT_MODULE_KIND[k]}</option>
              ))}
            </select>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-title">{CONTRACT_MODULE_CARD.title}</label>
            <input id="cm-title" className="input-field" value={draft.title}
              placeholder={CONTRACT_MODULE_CARD.titlePlaceholder} onChange={(e) => onChange({ ...draft, title: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className="label" htmlFor="cm-pos">{CONTRACT_MODULE_CARD.position}</label>
            <input id="cm-pos" className="input-field" type="number" min={0} max={9999} value={draft.position}
              onChange={(e) => onChange({ ...draft, position: Number(e.target.value) || 0 })} />
          </div>
        </div>
        <label className="label">
          <input type="checkbox" checked={draft.isActive} onChange={(e) => onChange({ ...draft, isActive: e.target.checked })} />{' '}
          {CONTRACT_MODULE_CARD.active}
        </label>

        <fieldset className={styles.field}>
          <legend className="label">{CONTRACT_MODULE_CARD.clauses}</legend>
          <p className={styles.desc}>{CONTRACT_MODULE_CARD.clausesHelp}</p>
          {clauses.length === 0 && <p className={styles.desc}>{CONTRACT_MODULE_CARD.noClauses}</p>}
          <ol className={styles.list}>
            {draft.clauseKeys.map((k, i) => (
              <li key={k} className={styles.item}>
                <span className={styles.itemMain}>
                  <span className={styles.itemName}>{titleOf.get(k) ?? k}</span>
                  <span className={styles.itemMeta}><span className={styles.tag}>{k}</span></span>
                </span>
                <span className={styles.itemActions}>
                  <button type="button" className={styles.iconBtn} disabled={i === 0} aria-label={`${k} ${CONTRACT_MODULE_CARD.moveUp}`}
                    onClick={() => onChange({ ...draft, clauseKeys: move(draft.clauseKeys, i, i - 1) })}><ArrowUp size={14} /></button>
                  <button type="button" className={styles.iconBtn} disabled={i === draft.clauseKeys.length - 1} aria-label={`${k} ${CONTRACT_MODULE_CARD.moveDown}`}
                    onClick={() => onChange({ ...draft, clauseKeys: move(draft.clauseKeys, i, i + 1) })}><ArrowDown size={14} /></button>
                  <button type="button" className={styles.iconBtn} aria-label={`${k} ${ACTION.delete}`}
                    onClick={() => onChange({ ...draft, clauseKeys: draft.clauseKeys.filter((x) => x !== k) })}><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
          </ol>
          {unpicked.length > 0 && (
            <RecordPickerField
              noun={CONTRACT_MODULE_CARD.clauseNoun} value="" placeholder={CONTRACT_MODULE_CARD.addClause}
              search={searchClauses}
              onChange={(opt) => opt && onChange({ ...draft, clauseKeys: [...draft.clauseKeys, opt.id] })}
            />
          )}
        </fieldset>

        <fieldset className={styles.field}>
          <legend className="label">{CONTRACT_MODULE_CARD.condition}</legend>
          <p className={styles.desc}>{draft.rules.length === 0 ? CONTRACT_MODULE_CARD.conditionNone : CONTRACT_MODULE_CARD.conditionHelp}</p>
          {draft.rules.map((r, i) => (
            <div key={i} className={styles.ruleRow}>
              <select className="input-field" aria-label={CONTRACT_MODULE_CARD.condition} value={r.field}
                onChange={(e) => setRule(i, { field: e.target.value as FieldKind })}>
                {(Object.keys(CONTRACT_MODULE_CARD.field) as FieldKind[]).map((f) => (
                  <option key={f} value={f}>{CONTRACT_MODULE_CARD.field[f]}</option>
                ))}
              </select>
              {r.field === 'value' && (
                <input className="input-field" aria-label={CONTRACT_MODULE_CARD.valueKey} value={r.valueKey}
                  placeholder={CONTRACT_MODULE_CARD.valueKeyPlaceholder} onChange={(e) => setRule(i, { valueKey: e.target.value })} />
              )}
              <select className="input-field" aria-label={CONTRACT_MODULE_CARD.condition} value={r.op}
                onChange={(e) => setRule(i, { op: e.target.value as Op })}>
                {(Object.keys(CONTRACT_MODULE_CARD.op) as Op[]).map((o) => (
                  <option key={o} value={o}>{CONTRACT_MODULE_CARD.op[o]}</option>
                ))}
              </select>
              {r.op !== 'truthy' && (
                <input className="input-field" aria-label={CONTRACT_MODULE_CARD.values} value={r.values}
                  placeholder={CONTRACT_MODULE_CARD.valuesPlaceholder} onChange={(e) => setRule(i, { values: e.target.value })} />
              )}
              <button type="button" className={styles.iconBtn} aria-label={CONTRACT_MODULE_CARD.removeRule}
                onClick={() => onChange({ ...draft, rules: draft.rules.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
            </div>
          ))}
          <span>
            <NbButton variant="ghost" onClick={() => onChange({ ...draft, rules: [...draft.rules, { ...EMPTY_RULE }] })}>
              <Plus size={14} /> {CONTRACT_MODULE_CARD.addRule}
            </NbButton>
          </span>
        </fieldset>
      </div>
    </NbModal>
  )
}
