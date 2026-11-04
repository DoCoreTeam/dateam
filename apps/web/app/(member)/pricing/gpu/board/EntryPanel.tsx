'use client'

// 견적과 시세를 정해진 칸으로 여러 줄 넣는 창 — 칸의 뜻과 검사는 lib/gpu/entry.ts 하나가 정한다
// 저장은 POST /api/pricing/gpu/entries 하나, 관리자는 바로 확정 일반 회원은 확정 대기 (서버가 역할로 가른다)
// 화면에서도 같은 검사를 먼저 돌려 빨간 칸을 보여 주지만, 서버가 다시 검사한다

import { useMemo, useState, type ClipboardEvent } from 'react'
import { kstTodayKey } from '@/lib/datetime/kst'
import { termLabel } from '@/lib/gpu/term'
import {
  ENTRY_BASES, ENTRY_CURRENCIES, ENTRY_KINDS, ENTRY_PERIODS, ENTRY_TERMS, MAX_ENTRY_ROWS,
  parsePastedEntries, validateEntries, type EntryError, type EntryField,
} from '@/lib/gpu/entry'
import type { Board } from '@/lib/gpu/board'
import { BOARD_COPY as C } from '@/lib/gpu/board-copy'
import SlidePanel from '@/components/ui/SlidePanel'
import WaitProgress from '@/components/ui/WaitProgress'
import RecordPickerField from '@/components/ui/RecordPicker'
import DateField from '@/components/ui/DateField'
import { productOptions, searchOf } from './productOptions'
import s from './board.module.css'

const ENTRIES_API = '/api/pricing/gpu/entries'
const PANEL_WIDTH_PX = 1320

interface Draft {
  key: number
  kind: string
  vendor: string
  product_id: string
  amount: string
  currency: string
  basis: string
  period: string
  term: string
  received_on: string
  source: string
}

interface SaveResult {
  confirmed: number
  pending: number
  lines: Array<{ line: number; status: 'confirmed' | 'pending'; reason?: string }>
}

let nextKey = 1
function blankDraft(today: string): Draft {
  return { key: nextKey++, kind: 'quote', vendor: '', product_id: '', amount: '', currency: 'KRW', basis: 'per_gpu', period: 'hour', term: 'on_demand', received_on: today, source: '' }
}

function toPayload(d: Draft): Record<EntryField, unknown> {
  const amount = d.amount.replace(/,/g, '').trim()
  return {
    kind: d.kind, vendor: d.vendor, product_id: d.product_id, amount: amount === '' ? '' : Number(amount),
    currency: d.currency, basis: d.basis, period: d.period, term: d.term, received_on: d.received_on, source: d.source,
  }
}

function fromPasted(raw: Record<string, unknown>, today: string): Draft {
  const base = blankDraft(today)
  const str = (v: unknown, fallback: string) => (v == null || v === '' ? fallback : String(v))
  return {
    ...base,
    kind: str(raw.kind, base.kind), vendor: str(raw.vendor, ''), product_id: str(raw.product_id, ''),
    amount: str(raw.amount, ''), currency: str(raw.currency, base.currency), basis: str(raw.basis, base.basis),
    period: str(raw.period, base.period), term: str(raw.term, base.term), received_on: str(raw.received_on, today),
    source: str(raw.source, ''),
  }
}

function errorText(errors: EntryError[], line: number, field: EntryField): string | null {
  const e = errors.find((x) => x.line === line && x.field === field)
  return e ? `${fieldName(field)} ${C.errorCode[e.code]}` : null
}

function fieldName(f: EntryField): string {
  return {
    kind: C.fieldKind, vendor: C.fieldVendor, product_id: C.fieldProduct, amount: C.fieldAmount, currency: C.fieldCurrency,
    basis: C.fieldBasis, period: C.fieldPeriod, term: C.fieldTerm, received_on: C.fieldReceived, source: C.fieldSource,
  }[f]
}

function DraftRow({ d, line, errors, labelOf, search, busy, onChange, onRemove }: {
  d: Draft; line: number; errors: EntryError[]; labelOf: Map<string, string>; search: ReturnType<typeof searchOf>
  busy: boolean; onChange: (patch: Partial<Draft>) => void; onRemove: () => void
}) {
  const bad = (f: EntryField) => (errors.some((e) => e.line === line && e.field === f) ? s.eBad : '')
  const msg = ENTRY_FIELD_ORDER.map((f) => errorText(errors, line, f)).filter(Boolean).join(' · ')
  return (
    <div className={s.eRow} role="row" aria-label={`${line}`}>
      <span className={s.eLine}>{line}</span>
      <select className={`input-field ${bad('kind')}`} aria-label={C.fieldKind} value={d.kind} disabled={busy} onChange={(e) => onChange({ kind: e.target.value })}>
        {ENTRY_KINDS.map((k) => <option key={k} value={k}>{C.kindLabel[k]}</option>)}
      </select>
      <input className={`input-field ${bad('vendor')}`} aria-label={C.fieldVendor} value={d.vendor} disabled={busy} list="gpu-entry-vendors"
        onChange={(e) => onChange({ vendor: e.target.value })} />
      <div className={bad('product_id')}>
        <RecordPickerField noun={C.fieldProduct} value={d.product_id} valueName={labelOf.get(d.product_id)} disabled={busy}
          search={search} onChange={(opt) => onChange({ product_id: opt?.id ?? '' })} />
      </div>
      <input className={`input-field ${s.eNum} ${bad('amount')}`} aria-label={C.fieldAmount} inputMode="decimal" value={d.amount} disabled={busy}
        onChange={(e) => onChange({ amount: e.target.value })} />
      <select className={`input-field ${bad('currency')}`} aria-label={C.fieldCurrency} value={d.currency} disabled={busy} onChange={(e) => onChange({ currency: e.target.value })}>
        {ENTRY_CURRENCIES.map((c) => <option key={c} value={c}>{C.currencyLabel[c]}</option>)}
      </select>
      <select className={`input-field ${bad('basis')}`} aria-label={C.fieldBasis} value={d.basis} disabled={busy} onChange={(e) => onChange({ basis: e.target.value })}>
        {ENTRY_BASES.map((b) => <option key={b} value={b}>{C.basisLabel[b]}</option>)}
      </select>
      <select className={`input-field ${bad('period')}`} aria-label={C.fieldPeriod} value={d.period} disabled={busy} onChange={(e) => onChange({ period: e.target.value })}>
        {ENTRY_PERIODS.map((p) => <option key={p} value={p}>{C.periodLabel[p]}</option>)}
      </select>
      <select className={`input-field ${bad('term')}`} aria-label={C.fieldTerm} value={d.term} disabled={busy} onChange={(e) => onChange({ term: e.target.value })}>
        {ENTRY_TERMS.map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}
      </select>
      <DateField hideToday className={bad('received_on')} aria-label={C.fieldReceived} value={d.received_on} disabled={busy}
        onValueChange={(v) => onChange({ received_on: v })} />
      <input className={`input-field ${bad('source')}`} aria-label={C.fieldSource} value={d.source} disabled={busy}
        onChange={(e) => onChange({ source: e.target.value })} />
      <button type="button" className="btn-ghost" aria-label={C.entryRemoveRow} disabled={busy} onClick={onRemove}>×</button>
      {msg && <p role="alert" className={`${s.pError} ${s.eMsg}`}>{msg}</p>}
    </div>
  )
}

const ENTRY_FIELD_ORDER: EntryField[] = ['kind', 'vendor', 'product_id', 'amount', 'currency', 'basis', 'period', 'term', 'received_on', 'source']

export default function EntryPanel({ board, isAdmin, onClose, onSaved }: {
  board: Board | undefined; isAdmin: boolean; onClose: () => void; onSaved: () => void
}) {
  const today = kstTodayKey()
  const options = useMemo(() => productOptions(board), [board])
  const labelOf = useMemo(() => new Map(options.map((o) => [o.id, o.label])), [options])
  const search = useMemo(() => searchOf(options), [options])
  const vendors = useMemo(() => [...new Set((board?.rows ?? []).flatMap((r) => r.offers.map((o) => o.vendor)).filter(Boolean))].sort(), [board])
  const [drafts, setDrafts] = useState<Draft[]>(() => [blankDraft(today)])
  const [errors, setErrors] = useState<EntryError[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const [reasons, setReasons] = useState<string[]>([])

  const patch = (key: number, p: Partial<Draft>) => setDrafts((all) => all.map((d) => (d.key === key ? { ...d, ...p } : d)))

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text.trim()) return
    e.preventDefault()
    const rows = parsePastedEntries(text, options).map((r) => fromPasted(r, today))
    if (rows.length === 0) return
    setDrafts((all) => {
      const kept = all.filter((d) => d.vendor || d.product_id || d.amount)
      return [...kept, ...rows].slice(0, MAX_ENTRY_ROWS)
    })
    setErrors([])
    setFailed(null)
    setReasons([])
    setNotice(C.entryPasted(rows.length) + (rows.some((r) => !r.product_id) ? ` · ${C.entryUnreadModel}` : ''))
  }

  const save = async () => {
    const payload = drafts.map(toPayload)
    const local = validateEntries(payload, options, today).errors
    setErrors(local)
    setNotice(null)
    setReasons([])
    setFailed(null)
    if (local.length > 0) {
      setFailed(C.entryInvalid)
      return
    }
    setBusy(true)
    try {
      const res = await fetch(ENTRIES_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: payload }) })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        if (Array.isArray(body?.errors) && body.errors.length > 0) setErrors(body.errors as EntryError[])
        setFailed(res.status === 400 ? C.entryInvalid : C.entryFailed)
        return
      }
      const result = body as SaveResult
      setNotice(C.entryDone(result.confirmed, result.pending))
      setReasons(result.lines.filter((l) => l.reason).map((l) => C.entryPendingReason(l.line, l.reason as string)))
      setDrafts([blankDraft(today)])
      setErrors([])
      onSaved()
    } catch {
      setFailed(C.entryFailed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <SlidePanel isOpen onClose={onClose} title={C.entryTitle} width={PANEL_WIDTH_PX}>
      <p className={s.pHint}>{C.entryHint}</p>
      {!isAdmin && <p className={s.pHint}>{C.entryHintMember}</p>}
      <textarea className={`input-field ${s.ePaste}`} rows={2} placeholder={C.entryPaste} aria-label={C.entryPaste} disabled={busy}
        onPaste={onPaste} />
      <datalist id="gpu-entry-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
      <div role="table" aria-label={C.entryTitle} className={s.eTable}>
        <div className={`${s.eRow} ${s.head}`} role="row">
          <span />
          {ENTRY_FIELD_ORDER.map((f) => <span key={f} role="columnheader">{fieldName(f)}</span>)}
          <span />
        </div>
        {drafts.map((d, i) => (
          <DraftRow key={d.key} d={d} line={i + 1} errors={errors} labelOf={labelOf} search={search} busy={busy}
            onChange={(p) => patch(d.key, p)}
            onRemove={() => setDrafts((all) => (all.length > 1 ? all.filter((x) => x.key !== d.key) : [blankDraft(today)]))} />
        ))}
      </div>
      <div className={`${s.pActions} ${s.gActions}`}>
        <button type="button" className="btn-ghost" disabled={busy || drafts.length >= MAX_ENTRY_ROWS}
          onClick={() => setDrafts((all) => [...all, { ...blankDraft(today), kind: all.at(-1)?.kind ?? 'quote', vendor: all.at(-1)?.vendor ?? '', currency: all.at(-1)?.currency ?? 'KRW' }])}>
          {C.entryAddRow}
        </button>
        <button type="button" className="btn-primary" disabled={busy} onClick={() => void save()}>{C.entrySave(drafts.length)}</button>
      </div>
      {busy && <WaitProgress message={C.entrySaving} />}
      {notice && <p role="status" className={s.pSellLine}>{notice}</p>}
      {reasons.map((r) => <p key={r} role="alert" className={s.pError}>{r}</p>)}
      {failed && <p role="alert" className={s.pError}>{failed}</p>}
    </SlidePanel>
  )
}
