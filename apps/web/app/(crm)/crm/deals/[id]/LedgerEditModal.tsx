'use client'

/**
 * 장부 편집 — 재원 구성과 현물 명세.
 *
 * **왜 모달인가**: 정보 열은 읽는 곳이고 입력 폼은 아니다(§2-3-2 L-1).
 * 그렇다고 행동 레일에 두면 «지금 할 일»과 섞인다 — 이건 레코드 자체의 속성이라
 * 「수정」으로 여는 자리가 맞다.
 *
 * **재원은 통째로 저장한다**: 재원은 «구성»이라 합이 사업비와 맞아야 뜻이 있다.
 * 한 줄만 바꾸면 그 순간 합이 틀어지고, 그 상태를 저장할 이유가 없다.
 *
 * **현물은 한 줄씩**: 명세는 «무엇을 뺐나»의 기록이라 줄마다 독립적이다.
 */

import { useState } from 'react'
import { Trash2, Plus } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import DateField from '@/components/ui/DateField'
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import {
  ACTION, LEDGER, AMOUNT_LABEL, AMOUNT_HINT, FUNDING_LABEL, FUNDING_AGENCY_HINT,
  IN_KIND_LABEL, TAX_BASIS_LABEL,
  createLabel, failedTo, progress, basisPlaceholder,
  type FundingKey, type InKindKindKey,
} from '@/lib/terms'
import { formatMinor } from '@/lib/crm/domain/money'
import { readApiError } from '@/lib/crm/api/read-error'
import styles from './ledger.module.css'

/**
 * 재원 네 갈래는 고정이다 — 사용자가 종류를 만들지 않는다.
 * **말은 여기서 짓지 않는다**(§0-2) — 용어집이 정한 라벨만 순서대로 세운다.
 */
const FUNDING_ROWS: readonly { type: FundingKey; agency: boolean }[] = [
  { type: 'NATIONAL', agency: true },
  { type: 'LOCAL', agency: true },
  { type: 'OWN_CASH', agency: false },
  { type: 'IN_KIND', agency: false },
]

const IN_KIND_KINDS: readonly InKindKindKey[] = ['LABOR', 'EQUIPMENT', 'MATERIAL', 'FACILITY']

export interface LedgerEditRow {
  id: string
  kind: string
  kindLabel: string
  name: string
  valueMinor: string
  basisNote: string | null
  startDate: string | null
  endDate: string | null
}

export interface LedgerEditFunding {
  sourceType: string
  amountMinor: string
  agencyName: string | null
}

interface Props {
  dealId: string
  funding: LedgerEditFunding[]
  inKind: LedgerEditRow[]
  taxBasis: 'NET' | 'GROSS'
  taxRatePct: string
  budgetMinor: string | null
  contractMinor: string | null
  onClose: () => void
  onSaved: () => void
}

/** 화면 입력은 사람이 치는 문자열이다 — 콤마를 지우고 숫자만 남긴다 */
function toMinor(v: string): string {
  const n = v.replace(/[^\d]/g, '')
  return n === '' ? '0' : n
}

function fmt(minor: string): string {
  try { return formatMinor(BigInt(minor)) } catch { return '0' }
}

/** 「현물」은 개체가 아니라 재원의 한 갈래다 — 개체 표에 넣지 않고 그 라벨을 쓴다 */
const addInKindLabel = createLabel(FUNDING_LABEL.IN_KIND)
const emptyInKind = `${FUNDING_LABEL.IN_KIND}이 아직 없어요`

export default function LedgerEditModal({
  dealId, funding, inKind, taxBasis, taxRatePct, budgetMinor, contractMinor, onClose, onSaved,
}: Props) {
  const [basis, setBasis] = useState<'NET' | 'GROSS'>(taxBasis)
  const [rate, setRate] = useState(taxRatePct)
  const [budget, setBudget] = useState(budgetMinor ? fmt(budgetMinor) : '')
  const [contract, setContract] = useState(contractMinor ? fmt(contractMinor) : '')
  const [amounts, setAmounts] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const r of FUNDING_ROWS) {
      const hit = funding.find((f) => f.sourceType === r.type)
      m[r.type] = hit ? fmt(hit.amountMinor) : ''
    }
    return m
  })
  const [agencies, setAgencies] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {}
    for (const r of FUNDING_ROWS) m[r.type] = funding.find((f) => f.sourceType === r.type)?.agencyName ?? ''
    return m
  })

  const [rows, setRows] = useState<LedgerEditRow[]>(inKind)
  const [draft, setDraft] = useState({ kind: 'LABOR', name: '', value: '', basisNote: '', startDate: '', endDate: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(url: string, init: RequestInit): Promise<Record<string, unknown>> {
    const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json' } })
    const body = await res.json()
    if (!res.ok) throw new Error(readApiError(body, failedTo(LEDGER.title, '저장하지')))
    return body as Record<string, unknown>
  }

  async function addRow() {
    if (!draft.name.trim()) { setError(LEDGER.inKindNameRequired); return }
    setBusy('add'); setError(null)
    try {
      const body = await call(`/api/crm/deals/${dealId}/ledger/in-kind`, {
        method: 'POST',
        body: JSON.stringify({
          kind: draft.kind, name: draft.name, valueMinor: toMinor(draft.value),
          basisNote: draft.basisNote || null,
          startDate: draft.startDate || null, endDate: draft.endDate || null,
        }),
      })
      setRows((body.inKind as LedgerEditRow[]) ?? [])
      setDraft({ kind: 'LABOR', name: '', value: '', basisNote: '', startDate: '', endDate: '' })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo(FUNDING_LABEL.IN_KIND, '추가하지'))
    } finally { setBusy(null) }
  }

  async function removeRow(id: string) {
    setBusy(id); setError(null)
    try {
      const body = await call(`/api/crm/deals/${dealId}/ledger/in-kind/${id}`, { method: 'DELETE' })
      setRows((body.inKind as LedgerEditRow[]) ?? [])
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo(FUNDING_LABEL.IN_KIND, '삭제하지'))
    } finally { setBusy(null) }
  }

  async function saveFunding() {
    setBusy('funding'); setError(null)
    try {
      // 0원 줄은 아예 안 보낸다 — «안 쓰는 재원»과 «0원 재원»은 다른 말이다
      await call(`/api/crm/deals/${dealId}/ledger`, {
        method: 'PATCH',
        body: JSON.stringify({
          taxBasis: basis, taxRatePct: rate,
          budgetNetMinor: budget.trim() === '' ? null : toMinor(budget),
          contractNetMinor: contract.trim() === '' ? null : toMinor(contract),
        }),
      })
      const list = FUNDING_ROWS
        .map((r) => ({ sourceType: r.type, amountMinor: toMinor(amounts[r.type] ?? ''), agencyName: agencies[r.type] || null }))
        .filter((r) => r.amountMinor !== '0')
      await call(`/api/crm/deals/${dealId}/ledger/funding`, { method: 'PUT', body: JSON.stringify({ rows: list }) })
      onSaved()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo(LEDGER.fundingSection, '저장하지'))
    } finally { setBusy(null) }
  }

  return (
    <NbModal title={`${LEDGER.title} ${ACTION.edit}`} onClose={onClose} maxWidth={720}>
      {/*
        오류는 **누른 자리에서 보여야 한다.**
        모달 맨 위에만 두면 아래쪽에서 「현물 추가」를 눌렀을 때 스크롤 밖이라
        사용자에게는 아무 일도 안 일어난 것으로 읽힌다(실브라우저에서 잡았다).
        모달이 스크롤 컨테이너라 sticky 로 따라온다.
      */}
      {error && (
        <div className={styles.alert} role="alert">
          <ErrorState message={error} />
        </div>
      )}

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{LEDGER.amountBasis}</h3>
        <p className={styles.note}>{LEDGER.basisWhy}</p>
        <div className={styles.formRow}>
          <label className="label" htmlFor="tax-basis">{LEDGER.tax}</label>
          <select
            id="tax-basis"
            className="input-field"
            value={basis}
            onChange={(e) => setBasis(e.target.value === 'GROSS' ? 'GROSS' : 'NET')}
          >
            <option value="NET">{TAX_BASIS_LABEL.NET}</option>
            <option value="GROSS">{TAX_BASIS_LABEL.GROSS}</option>
          </select>
          <input
            className="input-field" inputMode="decimal" aria-label={`${LEDGER.tax}율(%)`}
            value={rate} onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div className={styles.formRow}>
          <label className="label" htmlFor="amt-budget">{AMOUNT_LABEL.budget}</label>
          <input
            id="amt-budget" className="input-field" inputMode="numeric" placeholder={AMOUNT_HINT.budget}
            value={budget} onChange={(e) => setBudget(e.target.value.trim() === '' ? '' : fmt(toMinor(e.target.value)))}
          />
        </div>
        <div className={styles.formRow}>
          <label className="label" htmlFor="amt-contract">{AMOUNT_LABEL.contract}</label>
          <input
            id="amt-contract" className="input-field" inputMode="numeric" placeholder={AMOUNT_HINT.contract}
            value={contract} onChange={(e) => setContract(e.target.value.trim() === '' ? '' : fmt(toMinor(e.target.value)))}
          />
        </div>
        <p className={styles.note}>{LEDGER.quotedReadOnlyWhy}</p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{LEDGER.fundingSection}</h3>
        <p className={styles.note}>{LEDGER.fundingWhy}</p>
        {FUNDING_ROWS.map((r) => (
          <div key={r.type} className={styles.formRow}>
            <label className="label" htmlFor={`amt-${r.type}`}>{FUNDING_LABEL[r.type]}</label>
            <input
              id={`amt-${r.type}`}
              className="input-field"
              inputMode="numeric"
              placeholder="0"
              value={amounts[r.type] ?? ''}
              onChange={(e) => setAmounts((m) => ({ ...m, [r.type]: fmt(toMinor(e.target.value)) }))}
            />
            {r.agency && (
              <input
                className="input-field"
                placeholder={FUNDING_AGENCY_HINT}
                aria-label={`${FUNDING_LABEL[r.type]} ${FUNDING_AGENCY_HINT}`}
                value={agencies[r.type] ?? ''}
                onChange={(e) => setAgencies((m) => ({ ...m, [r.type]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{LEDGER.inKindSection}</h3>
        <p className={styles.note}>{LEDGER.inKindWhy}</p>

        {rows.length === 0 ? (
          <EmptyState title={emptyInKind} description={LEDGER.inKindEmptyHint} />
        ) : (
          <div className={styles.rows}>
            {rows.map((k) => (
              <div key={k.id} className={styles.row}>
                <span className={styles.rowLabel}>
                  <span className={styles.rowName}>{k.name}</span>
                  <span className={styles.basis}>{k.kindLabel}{k.basisNote ? ` · ${k.basisNote}` : ''}</span>
                </span>
                <span className={styles.rowValue}>{fmt(k.valueMinor)}원</span>
                <NbButton
                  variant="ghost"
                  aria-label={`${k.name} ${ACTION.delete}`}
                  disabled={busy === k.id}
                  onClick={() => void removeRow(k.id)}
                >
                  {busy === k.id ? progress(ACTION.delete) : <Trash2 size={16} />}
                </NbButton>
              </div>
            ))}
          </div>
        )}

        <div className={styles.formRow}>
          <select
            className="input-field"
            aria-label={`${FUNDING_LABEL.IN_KIND} 종류`}
            value={draft.kind}
            onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
          >
            {IN_KIND_KINDS.map((k) => <option key={k} value={k}>{IN_KIND_LABEL[k]}</option>)}
          </select>
          <input
            className="input-field"
            placeholder={LEDGER.inKindNamePlaceholder}
            aria-label={LEDGER.inKindName}
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <input
            className="input-field"
            inputMode="numeric"
            placeholder={LEDGER.inKindValue}
            aria-label={LEDGER.inKindValue}
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: fmt(toMinor(e.target.value)) }))}
          />
        </div>
        <div className={styles.formRow}>
          <input
            className="input-field"
            placeholder={basisPlaceholder(draft.kind as InKindKindKey)}
            aria-label={LEDGER.inKindBasis}
            value={draft.basisNote}
            onChange={(e) => setDraft((d) => ({ ...d, basisNote: e.target.value }))}
          />
          {/*
            날 <input type="date"> 는 **6자리 연도를 그대로 받는다**(202026 년).
            DateField 는 min/max 와 범위 검사를 함께 들고 온다(§2-1 가드).
          */}
          <DateField
            aria-label={LEDGER.startDate}
            value={draft.startDate}
            onValueChange={(v) => setDraft((d) => ({ ...d, startDate: v }))}
          />
          <DateField
            aria-label={LEDGER.endDate}
            value={draft.endDate}
            onValueChange={(v) => setDraft((d) => ({ ...d, endDate: v }))}
          />
          <NbButton variant="ghost" disabled={busy === 'add'} onClick={() => void addRow()}>
            {busy === 'add' ? progress(ACTION.create) : <><Plus size={16} /> {addInKindLabel}</>}
          </NbButton>
        </div>
      </section>

      {/* 확정은 오른쪽 끝, 취소는 그 왼쪽 (§2-3-2 L-6) */}
      <div className={styles.footer}>
        <NbButton variant="ghost" onClick={onClose}>{ACTION.cancel}</NbButton>
        <NbButton disabled={busy === 'funding'} onClick={() => void saveFunding()}>
          {busy === 'funding' ? progress(ACTION.save) : ACTION.save}
        </NbButton>
      </div>
    </NbModal>
  )
}
