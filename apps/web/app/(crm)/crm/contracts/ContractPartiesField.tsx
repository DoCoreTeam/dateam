'use client'

// 계약 당사자 칸 — 만들기 창과 계약 정보 고치기 창이 같은 부품을 쓴다 (P0184 I10)

import { Plus, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { CONTRACT_CREATE_BLANK as T, CONTRACT_KIND_LABEL as K } from '@/lib/terms/contract-doc'
import styles from '@/components/ui/crm/contract/contract.module.css'
import own from './ContractPartiesField.module.css'

export type Direction = keyof typeof K.direction
export type PartyRole = keyof typeof K.partyRole

export interface PartyDraft { role: PartyRole; isSelf: boolean; name: string; bizNo: string }

const ROLES = Object.keys(K.partyRole) as PartyRole[]

const party = (role: PartyRole, isSelf: boolean): PartyDraft => ({ role, isSelf, name: '', bizNo: '' })

/** 방향마다 보통의 당사자 모양 — 고르면 이 모양으로 채우고 사람이 고친다 */
export function partiesFor(direction: Direction): PartyDraft[] {
  switch (direction) {
    case 'SALES': return [party('SUPPLIER', true), party('CUSTOMER', false)]
    case 'PURCHASE': return [party('SUPPLIER', false), party('CUSTOMER', true)]
    case 'CONSORTIUM': return [party('LEAD', true), party('MEMBER', false)]
    case 'BROKERAGE': return [party('BROKER', true), party('SUPPLIER', false), party('CUSTOMER', false)]
    case 'PARTNERSHIP': return [party('PARTNER', true), party('PARTNER', false)]
    case 'CORPORATE': return [party('CUSTOMER', true), party('OTHER', false)]
  }
}

/** 창구가 받는 모양으로 */
export const toPartyInput = (ps: readonly PartyDraft[]) =>
  ps.map((p) => ({ role: p.role, isSelf: p.isSelf, snapshot: { name: p.name, ...(p.bizNo ? { bizNo: p.bizNo } : {}) } }))

/** 창구가 준 당사자 → 칸 */
export const fromPartyRows = (rows: readonly { role: string; isSelf: boolean; snapshot: { name?: string; bizNo?: string } }[]): PartyDraft[] =>
  rows.map((r) => ({ role: r.role as PartyRole, isSelf: r.isSelf, name: r.snapshot?.name ?? '', bizNo: r.snapshot?.bizNo ?? '' }))

interface Props {
  parties: PartyDraft[]
  onChange: (next: PartyDraft[]) => void
}

export default function ContractPartiesField({ parties, onChange }: Props) {
  const patch = (i: number, p: Partial<PartyDraft>) => onChange(parties.map((x, j) => (j === i ? { ...x, ...p } : x)))
  return (
    <fieldset className={styles.field}>
      <legend className="label">{T.parties}</legend>
      <p className={styles.desc}>{T.partyHint}</p>
      <ol className={styles.list}>
        {parties.map((p, i) => (
          <li key={i} className={own.party}>
            <select aria-label={`${i + 1} ${T.partyRole}`} className="input-field" value={p.role} onChange={(e) => patch(i, { role: e.target.value as PartyRole })}>
              {ROLES.map((r) => <option key={r} value={r}>{K.partyRole[r]}</option>)}
            </select>
            <input aria-label={`${i + 1} ${T.partyName}`} className="input-field" value={p.name} placeholder={T.partyName} onChange={(e) => patch(i, { name: e.target.value })} />
            <input aria-label={`${i + 1} ${T.partyBizNo}`} className="input-field" value={p.bizNo} placeholder={T.partyBizNo} onChange={(e) => patch(i, { bizNo: e.target.value })} />
            <label className={`label ${styles.check}`}>
              <input type="checkbox" checked={p.isSelf} onChange={(e) => patch(i, { isSelf: e.target.checked })} />
              <span>{T.partySelf}</span>
            </label>
            <button type="button" className={styles.iconBtn} disabled={parties.length <= 1}
              onClick={() => onChange(parties.filter((_, j) => j !== i))} aria-label={T.removeParty(i + 1)}>
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ol>
      <NbButton variant="ghost" onClick={() => onChange([...parties, party('OTHER', false)])}><Plus size={14} /> {T.addParty}</NbButton>
    </fieldset>
  )
}
