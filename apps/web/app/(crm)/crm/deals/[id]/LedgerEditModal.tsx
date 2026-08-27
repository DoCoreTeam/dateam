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
import ErrorState from '@/components/ui/ErrorState'
import EmptyState from '@/components/ui/EmptyState'
import { ACTION, failedTo, progress } from '@/lib/terms'
import { formatMinor } from '@/lib/crm/domain/money'
import { readApiError } from '@/lib/crm/api/read-error'
import styles from './ledger.module.css'

/** 재원 네 갈래는 고정이다 — 사용자가 종류를 만들지 않는다 */
const FUNDING_ROWS = [
  { type: 'NATIONAL', label: '국비', agency: true },
  { type: 'LOCAL', label: '지방비', agency: true },
  { type: 'OWN_CASH', label: '자부담 현금', agency: false },
  { type: 'IN_KIND', label: '자부담 현물', agency: false },
] as const

const IN_KIND_KINDS = [
  { value: 'LABOR', label: '인건비' },
  { value: 'EQUIPMENT', label: '장비사용료' },
  { value: 'MATERIAL', label: '연구재료' },
  { value: 'FACILITY', label: '시설' },
] as const

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
    if (!res.ok) throw new Error(readApiError(body, failedTo('장부', '저장하지')))
    return body as Record<string, unknown>
  }

  async function addRow() {
    if (!draft.name.trim()) { setError('현물 이름을 입력해 주세요.'); return }
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
      setError(e instanceof Error ? e.message : failedTo('현물', '추가하지'))
    } finally { setBusy(null) }
  }

  async function removeRow(id: string) {
    setBusy(id); setError(null)
    try {
      const body = await call(`/api/crm/deals/${dealId}/ledger/in-kind/${id}`, { method: 'DELETE' })
      setRows((body.inKind as LedgerEditRow[]) ?? [])
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : failedTo('현물', '삭제하지'))
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
      setError(e instanceof Error ? e.message : failedTo('재원 구성', '저장하지'))
    } finally { setBusy(null) }
  }

  return (
    <NbModal title="장부 수정" onClose={onClose} maxWidth={720}>
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
        <h3 className={styles.sectionTitle}>금액 기준</h3>
        <p className={styles.note}>
          국가 과제 사업비는 보통 부가세가 포함된 금액입니다.
          「포함」을 고르면 공급가액과 세액을 그 금액에서 나눠 계산합니다.
        </p>
        <div className={styles.formRow}>
          <label className="label" htmlFor="tax-basis">부가세</label>
          <select
            id="tax-basis"
            className="input-field"
            value={basis}
            onChange={(e) => setBasis(e.target.value === 'GROSS' ? 'GROSS' : 'NET')}
          >
            <option value="NET">별도 — 이 금액이 공급가액입니다</option>
            <option value="GROSS">포함 — 이 금액에 부가세가 들어 있습니다</option>
          </select>
          <input
            className="input-field" inputMode="decimal" aria-label="부가세율(%)"
            value={rate} onChange={(e) => setRate(e.target.value)}
          />
        </div>
        <div className={styles.formRow}>
          <label className="label" htmlFor="amt-budget">예산</label>
          <input
            id="amt-budget" className="input-field" inputMode="numeric" placeholder="고객이 말한 금액"
            value={budget} onChange={(e) => setBudget(e.target.value.trim() === '' ? '' : fmt(toMinor(e.target.value)))}
          />
        </div>
        <div className={styles.formRow}>
          <label className="label" htmlFor="amt-contract">계약</label>
          <input
            id="amt-contract" className="input-field" inputMode="numeric" placeholder="도장 찍은 금액"
            value={contract} onChange={(e) => setContract(e.target.value.trim() === '' ? '' : fmt(toMinor(e.target.value)))}
          />
        </div>
        <p className={styles.note}>
          수주 매출은 계약 &gt; 견적 &gt; 예산 중 가장 확실한 것을 씁니다.
          견적 금액은 대표 견적에서 와야 해서 여기서 고치지 않습니다.
        </p>
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>재원 구성</h3>
        <p className={styles.note}>
          국가 과제에서만 씁니다. 비워 두면 재원 구성을 쓰지 않는 딜로 봅니다.
        </p>
        {FUNDING_ROWS.map((r) => (
          <div key={r.type} className={styles.formRow}>
            <label className="label" htmlFor={`amt-${r.type}`}>{r.label}</label>
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
                placeholder="부처·지자체"
                aria-label={`${r.label} 부처·지자체`}
                value={agencies[r.type] ?? ''}
                onChange={(e) => setAgencies((m) => ({ ...m, [r.type]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </section>

      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>현물 명세</h3>
        <p className={styles.note}>
          숫자 한 칸으로 두면 다음 달에 그 금액이 무엇이었는지 아무도 모릅니다.
          정산 서류에 그대로 쓰이는 환산 근거를 함께 적어 주세요.
        </p>

        {rows.length === 0 ? (
          <EmptyState title="현물이 아직 없어요" description="아래에서 한 줄씩 더하면 여기에 쌓입니다." />
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
            aria-label="현물 종류"
            value={draft.kind}
            onChange={(e) => setDraft((d) => ({ ...d, kind: e.target.value }))}
          >
            {IN_KIND_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <input
            className="input-field"
            placeholder="이름 (예: 연구원 3명)"
            aria-label="현물 이름"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          />
          <input
            className="input-field"
            inputMode="numeric"
            placeholder="평가액"
            aria-label="현물 평가액"
            value={draft.value}
            onChange={(e) => setDraft((d) => ({ ...d, value: fmt(toMinor(e.target.value)) }))}
          />
        </div>
        <div className={styles.formRow}>
          <input
            className="input-field"
            placeholder="환산 근거 (예: 연봉 × 참여율 × 기간)"
            aria-label="환산 근거"
            value={draft.basisNote}
            onChange={(e) => setDraft((d) => ({ ...d, basisNote: e.target.value }))}
          />
          <input
            className="input-field" type="date" aria-label="현물 시작일"
            value={draft.startDate}
            onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))}
          />
          <input
            className="input-field" type="date" aria-label="현물 종료일"
            value={draft.endDate}
            onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))}
          />
          <NbButton variant="ghost" disabled={busy === 'add'} onClick={() => void addRow()}>
            {busy === 'add' ? progress('추가') : <><Plus size={16} /> 현물 추가</>}
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
