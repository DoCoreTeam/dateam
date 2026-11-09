'use client'

// 지급 일정 입력 — 대가 종류마다 정한 칸으로 받아 contract.payment 칸에 넣는다 (P0184 I12a)
//
// **검사는 서버가 한다.** 여기서는 칸을 모양대로 묶어 보내고, 비율 합이나 금액 모양이 틀리면
// 서버(contract-payment.ts)가 거절한 말을 그대로 보인다. 화면이 따로 검사하면 규칙이 두 벌이 된다.
// 금액은 통화 단위로 받아 toMinorAmount 로 최소 단위 정수로 바꾼다 (100배 사고 방지).

import { useState } from 'react'
import { Plus, Trash2, Wallet } from 'lucide-react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { withSubmitGuard } from '@/lib/forms/submit-guard'
import { minorDigits, toMinorAmount } from '../../deals/amount'
import { progress, ACTION } from '@/lib/terms'
import { CONTRACT_PAYMENT, CONTRACT_PAYMENT_EDITOR as T } from '@/lib/terms/contract-doc'
import { contractApi, type ContractJson, type ContractVersionJson, type Outcome, type SaveResult } from './contract-api'
import styles from './contract-modal.module.css'

type Kind = keyof typeof CONTRACT_PAYMENT.kind
type Period = keyof typeof CONTRACT_PAYMENT.period
type Field = 'amount' | 'due' | 'total' | 'period' | 'dueDay' | 'unitPrice' | 'unit' | 'minimum' | 'expires' | 'refund'
  | 'shortfall' | 'rate' | 'basis' | 'points' | 'converted' | 'settlement' | 'subsidy' | 'ownShare' | 'agency'

interface Installment { label: string; percent: string; due: string }

const KINDS = Object.keys(CONTRACT_PAYMENT.kind) as Kind[]
const PERIODS = Object.keys(CONTRACT_PAYMENT.period) as Period[]
const CURRENCIES = ['KRW', 'USD'] as const
const MONEY: ReadonlySet<Field> = new Set(['amount', 'total', 'unitPrice', 'minimum', 'subsidy', 'ownShare', 'converted'])

/** 종류마다 받는 칸 — 서버 스키마(contract-payment.ts PLAN)와 같은 순서 */
const FIELDS: Record<Kind, Field[]> = {
  LUMP: ['amount', 'due'],
  INSTALLMENT: ['total'],
  FIXED: ['amount', 'period', 'dueDay'],
  USAGE: ['unitPrice', 'unit', 'period', 'minimum'],
  PREPAID: ['amount', 'expires', 'refund'],
  COMMITMENT: ['amount', 'period', 'shortfall'],
  COMMISSION: ['rate', 'basis'],
  POINT_CONVERSION: ['points', 'converted', 'settlement'],
  SUBSIDY: ['subsidy', 'ownShare', 'agency'],
}

const L = CONTRACT_PAYMENT
const LABEL: Record<Field, string> = {
  amount: L.colAmount, due: L.colDue, total: L.total, period: L.colPeriod, dueDay: T.dueDay, unitPrice: L.colUnitPrice,
  unit: T.unit, minimum: L.colMinimum, expires: T.expiresAfterMonths, refund: L.colRefund, shortfall: L.colShortfall,
  rate: L.colPercent, basis: L.colBasis, points: L.colPoints, converted: L.colAmount, settlement: L.colSettlement,
  subsidy: L.colSubsidy, ownShare: L.colOwnShare, agency: L.colAgency,
}

/** 최소 단위 정수 → 입력칸 글자 (달러 1080 → 10.80) */
function toMajor(minor: unknown, currency: string): string {
  if (typeof minor !== 'string' || !minor) return ''
  const d = minorDigits(currency)
  if (d === 0) return minor
  const p = minor.padStart(d + 1, '0')
  return `${p.slice(0, -d)}.${p.slice(-d)}`
}

/** 저장된 칸 값을 입력칸으로 연다. 못 읽으면 빈 일시 지급으로 */
function readSaved(raw: string | undefined): { kind: Kind; currency: string; v: Partial<Record<Field, string>>; rows: Installment[] } {
  const empty = { kind: 'LUMP' as Kind, currency: 'KRW', v: {}, rows: [{ label: '', percent: '', due: '' }, { label: '', percent: '', due: '' }] }
  if (!raw) return empty
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    const cur = String(p.currency ?? 'KRW')
    const money = (k: string) => toMajor(p[k], cur)
    const str = (k: string) => (p[k] === undefined ? '' : String(p[k]))
    const v: Partial<Record<Field, string>> = {
      amount: money(p.kind === 'COMMITMENT' ? 'committedMinor' : 'amountMinor'), due: str('due'), total: money('totalMinor'),
      period: str('period'), dueDay: str('dueDay'), unitPrice: money('unitPriceMinor'), unit: str('unit'), minimum: money('minimumMinor'),
      expires: str('expiresAfterMonths'), refund: str('refund'), shortfall: str('shortfall'), rate: str('ratePercent'), basis: str('basis'),
      points: str('points'), converted: money('convertedMinor'), settlement: str('settlement'), subsidy: money('subsidyMinor'),
      ownShare: money('ownShareMinor'), agency: str('agency'),
    }
    const rows = Array.isArray(p.installments)
      ? (p.installments as { label: string; percent: number; due: string }[]).map((i) => ({ label: i.label, percent: String(i.percent), due: i.due }))
      : empty.rows
    return { kind: (KINDS.includes(p.kind as Kind) ? p.kind : 'LUMP') as Kind, currency: cur, v, rows }
  } catch {
    return empty
  }
}

/** 입력칸 → 서버가 받는 모양. 빈 선택 칸은 빼고 보낸다 */
function toPlan(kind: Kind, currency: string, v: Partial<Record<Field, string>>, rows: Installment[]): Record<string, unknown> {
  const m = (f: Field) => toMinorAmount(v[f] ?? '', currency)
  const n = (f: Field) => Number(v[f])
  const s = (f: Field) => (v[f] ?? '').trim()
  const opt = (key: string, val: unknown, has: boolean) => (has ? { [key]: val } : {})
  const base = { kind, currency }
  switch (kind) {
    case 'LUMP': return { ...base, amountMinor: m('amount'), due: s('due') }
    case 'INSTALLMENT': return { ...base, totalMinor: m('total'), installments: rows.map((r) => ({ label: r.label.trim(), percent: Number(r.percent), due: r.due.trim() })) }
    case 'FIXED': return { ...base, amountMinor: m('amount'), period: s('period') || 'MONTH', dueDay: n('dueDay') }
    case 'USAGE': return { ...base, unitPriceMinor: m('unitPrice'), unit: s('unit'), period: s('period') || 'MONTH', ...opt('minimumMinor', m('minimum'), !!s('minimum')) }
    case 'PREPAID': return { ...base, amountMinor: m('amount'), ...opt('expiresAfterMonths', n('expires'), !!s('expires')), ...opt('refund', s('refund'), !!s('refund')) }
    case 'COMMITMENT': return { ...base, committedMinor: m('amount'), period: s('period') || 'MONTH', shortfall: s('shortfall') }
    case 'COMMISSION': return { ...base, ratePercent: n('rate'), basis: s('basis') }
    case 'POINT_CONVERSION': return { ...base, points: n('points'), convertedMinor: m('converted'), settlement: s('settlement') }
    case 'SUBSIDY': return { ...base, subsidyMinor: m('subsidy'), ownShareMinor: m('ownShare'), agency: s('agency') }
  }
}

interface Props {
  contract: ContractJson
  current: ContractVersionJson
  onClose: () => void
  onSaved: (r: SaveResult) => void
  onFailed: (o: Extract<Outcome<unknown>, { ok: false }>) => void
}

export default function ContractPaymentEditor({ contract, current, onClose, onSaved, onFailed }: Props) {
  const saved = readSaved(current.fieldValues['contract.payment']?.value)
  const [kind, setKind] = useState<Kind>(saved.kind)
  const [currency, setCurrency] = useState(saved.currency)
  const [v, setV] = useState<Partial<Record<Field, string>>>(saved.v)
  const [rows, setRows] = useState<Installment[]>(saved.rows)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const percentSum = rows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0)

  async function save(value: string) {
    if (busy) return
    setBusy(true)
    setError(null)
    await withSubmitGuard(async () => {
      const out = await contractApi.save(contract.id, T.failed, { version: contract.version, manual: { 'contract.payment': value } })
      if (out.ok) { onSaved(out.body); return }
      if (out.code === 'CONFLICT') { onFailed(out); return }
      setError(out.message)
    }, { onError: setError, onDone: () => setBusy(false) })
  }

  const setRow = (i: number, patch: Partial<Installment>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <NbModal
      title={T.title}
      onClose={onClose}
      maxWidth={720}
      disableClose={busy}
      footer={(
        <div className={styles.foot}>
          {error && <span className={styles.tagBad} role="alert">{error}</span>}
          <NbButton variant="ghost" disabled={busy} onClick={() => void save('')}>{T.clear}</NbButton>
          <NbButton variant="ghost" disabled={busy} onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton disabled={busy} onClick={() => void save(JSON.stringify(toPlan(kind, currency, v, rows)))}>
            <Wallet size={16} aria-hidden /> {busy ? progress(ACTION.save) : ACTION.save}
          </NbButton>
        </div>
      )}
    >
      <div className={styles.body}>
        <p className={styles.hint}>{T.intro}</p>
        <div className={styles.fields}>
          <label className={styles.field}>
            <span className="label">{T.kind}</span>
            <select className="input-field" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
              {KINDS.map((k) => <option key={k} value={k}>{L.kind[k]}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className="label">{T.currency}</span>
            <select className="input-field" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {FIELDS[kind].map((f) => (
            <label key={f} className={styles.field}>
              <span className="label">{LABEL[f]}</span>
              {f === 'period' ? (
                <select className="input-field" value={v.period || 'MONTH'} onChange={(e) => setV({ ...v, period: e.target.value })}>
                  {PERIODS.map((p) => <option key={p} value={p}>{L.period[p]}</option>)}
                </select>
              ) : (
                <input className="input-field" value={v[f] ?? ''} inputMode={MONEY.has(f) ? 'decimal' : undefined}
                  placeholder={f === 'unit' ? T.unitPlaceholder : undefined} onChange={(e) => setV({ ...v, [f]: e.target.value })} />
              )}
            </label>
          ))}
        </div>
        {FIELDS[kind].some((f) => MONEY.has(f)) && <p className={styles.hint}>{T.amountHelp}</p>}
        {kind === 'INSTALLMENT' && (
          <section className={styles.section} aria-label={L.kind.INSTALLMENT}>
            {rows.map((r, i) => (
              <div key={i} className={styles.installRow}>
                <input className="input-field" aria-label={`${i + 1} ${L.colStage}`} placeholder={L.colStage} value={r.label} onChange={(e) => setRow(i, { label: e.target.value })} />
                <input className="input-field" aria-label={`${i + 1} ${L.colPercent}`} placeholder={L.colPercent} inputMode="decimal" value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} />
                <input className="input-field" aria-label={`${i + 1} ${L.colDue}`} placeholder={L.colDue} value={r.due} onChange={(e) => setRow(i, { due: e.target.value })} />
                <NbButton variant="ghost" disabled={rows.length <= 2} aria-label={T.removeInstallment(i + 1)} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                  <Trash2 size={14} aria-hidden />
                </NbButton>
              </div>
            ))}
            <p className={percentSum === 100 ? styles.hint : styles.tagWarn}>{T.percentNow(Math.round(percentSum * 100) / 100)}</p>
            <span>
              <NbButton variant="ghost" onClick={() => setRows([...rows, { label: '', percent: '', due: '' }])}>
                <Plus size={14} aria-hidden /> {T.addInstallment}
              </NbButton>
            </span>
          </section>
        )}
      </div>
    </NbModal>
  )
}
