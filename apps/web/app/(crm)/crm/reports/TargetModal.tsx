'use client'

/**
 * 목표 설정 — **고르는 것만 있고 적는 것은 값 하나뿐이다.**
 *
 * 왜(사용자 지시 2026-09-09): *"목표를 기간부터 입력폼으로 하면 정형화가 안된다
 * 기간 대상 지표 이런건 다 정형화가 가능한거니 선택하게 해야 한다"*
 * 기간을 손으로 적게 하면 「2026 상반기」·「26년 1H」·「2026-H1」이 한 표에 섞이고,
 * 그때부터 달성률은 어느 목표를 쓸지 모른다.
 *
 * 단위도 고르지 않는다 — **지표가 정한다.** 사람이 고르면 「수주 · 건」 같은 줄이 생긴다.
 */

import { useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION, failedTo } from '@/lib/terms'
import { minorDigits } from '../deals/amount'
import { UNIT_LABEL, REPORT, NO_TARGET } from '@/lib/terms/report'
import {
  type Period, type TargetSpec, type PeriodKind,
  periodLabel, formatPeriodKey, INDEX_MAX, YEAR_MIN, YEAR_MAX,
  validateTarget, targetKey, shouldOfferNextYear, nextYearOf,
} from '@/lib/crm/domain/target'
import { targetableMetrics, metricOf } from '@/lib/crm/domain/metrics'
import s from './metrics.module.css'

const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'YEAR', label: '연간' },
  { kind: 'HALF', label: '반기' },
  { kind: 'QUARTER', label: '분기' },
  { kind: 'MONTH', label: '월간' },
]

interface Props {
  /** 지금 보고 있는 기간 — 열자마자 그 기간이 골라져 있어야 한다 */
  period: Period
  /** 카드를 눌러 들어온 경우 그 지표가 골라져 있다 */
  metric?: string | null
  targets: TargetSpec[]
  todayKey: string
  onClose: () => void
  onSaved: (next: TargetSpec[]) => void
}

/** 사람이 적은 것에서 숫자만 남긴다 — 「1,000만」도 받아들이되 뜻은 숫자가 정한다 */
function digitsOf(raw: string): string {
  return raw.replace(/[^0-9]/g, '')
}

/**
 * 사람이 적은 값 → 저장값.
 *
 * **통화의 소수 자릿수를 그냥 두 자리로 가정하지 않는다.** 원은 소수 단위가 없어서
 * 딜의 금액 칸도 「원」 그대로 들어 있다. 무턱대고 `00` 을 붙이면 목표가 **100배**가
 * 되고, 달성률·부족분·배수가 전부 조용히 틀린다(실측: 10억을 넣었더니 1,000억으로 섰다).
 * 자릿수는 `minorDigits` 한 곳이 정한다 — 여기서 다시 정하지 않는다.
 */
const TARGET_CURRENCY = 'KRW'

function toStored(raw: string, unit: string): string {
  const digits = digitsOf(raw)
  if (!digits) return ''
  if (unit !== 'money') return digits
  return digits + '0'.repeat(minorDigits(TARGET_CURRENCY))
}

/** 저장값 → 사람이 읽는 수 */
function fromStored(v: string, unit: string): string {
  if (unit !== 'money') return v
  const d = minorDigits(TARGET_CURRENCY)
  if (d === 0) return v
  return v.length > d ? v.slice(0, -d) : '0'
}

export default function TargetModal({ period, metric, targets, todayKey, onClose, onSaved }: Props) {
  const [kind, setKind] = useState<PeriodKind>(period.kind)
  const [year, setYear] = useState(period.year)
  const [index, setIndex] = useState(period.index ?? 1)
  const [metricKey, setMetricKey] = useState(metric && metricOf(metric) ? metric : 'bookings')
  const [amount, setAmount] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const decl = metricOf(metricKey)
  const unit = decl?.unit ?? 'money'
  const max = INDEX_MAX[kind]
  const draftPeriod: Period = { kind, year, ...(max > 1 ? { index: Math.min(index, max) } : {}) }
  const offerNext = shouldOfferNextYear(todayKey)
  const nextYear = nextYearOf(todayKey)

  async function save() {
    setErr(null)
    const value = toStored(amount, unit)
    if (!value) { setErr('값을 넣어 주세요'); return }
    const draft = {
      id: targetKey({ period: draftPeriod, scope: { kind: 'ALL' as const }, metric: metricKey }),
      period: draftPeriod,
      scope: { kind: 'ALL' as const },
      metric: metricKey,
      value,
      unit,
    }
    // 화면에서 먼저 걸러 낸다 — 서버도 같은 함수로 다시 본다(둘 다 필요하다)
    let spec: TargetSpec
    try {
      spec = validateTarget(draft)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '값을 다시 확인해 주세요')
      return
    }
    // 같은 기간·같은 지표는 덮어쓴다 — 두 벌이면 어느 쪽으로 재는지 알 수 없다
    const next = [...targets.filter((t) => t.id !== spec.id), spec]
    setBusy(true)
    try {
      const res = await fetch('/api/crm/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setErr(json?.error?.message ?? failedTo('목표', '저장하지')); return }
      onSaved(json?.targets ?? next)
      onClose()
    } catch {
      setErr(failedTo('목표', '저장하지'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string) {
    const next = targets.filter((t) => t.id !== id)
    setBusy(true)
    try {
      const res = await fetch('/api/crm/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets: next }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setErr(json?.error?.message ?? failedTo('목표', '삭제하지')); return }
      onSaved(json?.targets ?? next)
    } catch {
      setErr(failedTo('목표', '삭제하지'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <NbModal
      title={`${REPORT.metric} 목표`}
      onClose={onClose}
      maxWidth={640}
      footer={
        <div className={s.actions}>
          <NbButton variant="ghost" onClick={onClose}>{ACTION.cancel}</NbButton>
          <NbButton onClick={save} disabled={busy}>{ACTION.save}</NbButton>
        </div>
      }
    >
      <div className={s.form}>
        <p className={s.hint}>
          기간·지표는 고르고, 적는 것은 값 하나입니다. 단위는 지표가 정합니다.
        </p>

        <div className={s.row}>
          <div className={s.field}>
            <label className="label" htmlFor="tg-kind">기간 종류</label>
            <select
              id="tg-kind" className="input-field" value={kind}
              onChange={(e) => setKind(e.target.value as PeriodKind)}
            >
              {KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </div>

          <div className={s.field}>
            <label className="label" htmlFor="tg-year">연도</label>
            <select
              id="tg-year" className="input-field" value={year}
              onChange={(e) => setYear(Number(e.target.value))}
            >
              {Array.from({ length: 6 }, (_, i) => period.year - 1 + i)
                .filter((y) => y >= YEAR_MIN && y <= YEAR_MAX)
                .map((y) => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>

          {max > 1 && (
            <div className={s.field}>
              <label className="label" htmlFor="tg-index">
                {kind === 'HALF' ? '반기' : kind === 'QUARTER' ? '분기' : '월'}
              </label>
              <select
                id="tg-index" className="input-field" value={Math.min(index, max)}
                onChange={(e) => setIndex(Number(e.target.value))}
              >
                {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n}{kind === 'MONTH' ? '월' : kind === 'QUARTER' ? '분기' : '반기'}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {offerNext && (
          <NbButton
            variant="ghost"
            onClick={() => { setKind('YEAR'); setYear(nextYear) }}
          >
            {nextYear}년 목표 정하기
          </NbButton>
        )}

        <div className={s.row}>
          <div className={`${s.field} ${s.fieldWide}`}>
            <label className="label" htmlFor="tg-metric">{REPORT.metric}</label>
            <select
              id="tg-metric" className="input-field" value={metricKey}
              onChange={(e) => setMetricKey(e.target.value)}
            >
              {targetableMetrics().map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
            {decl && <span className={s.hint}>{decl.hint}</span>}
          </div>

          <div className={s.field}>
            <label className="label" htmlFor="tg-value">값 ({UNIT_LABEL[unit]})</label>
            <input
              id="tg-value" className="input-field" inputMode="numeric"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder={unit === 'money' ? '1000000000' : '10'}
            />
          </div>
        </div>

        <div className={s.hint}>
          {periodLabel(draftPeriod)} · {decl?.label ?? metricKey}
          {/* 숫자가 하나도 없으면 「0원」이 아니라 **아직 목표가 아니다** — 0 은 「목표가 0」으로 읽힌다 */}
          {digitsOf(amount)
            ? ` · ${Number(digitsOf(amount)).toLocaleString('ko-KR')}${UNIT_LABEL[unit]}`
            : ` · ${NO_TARGET}`}
        </div>

        {err && <p className={s.err} role="alert">{err}</p>}

        {targets.length > 0 && (
          <div>
            <p className="label">이미 정한 목표 {targets.length}개</p>
            <div className={s.list}>
              {targets.map((t) => (
                <div key={t.id} className={s.item}>
                  <div className={s.itemMain}>
                    <div className={s.itemTitle}>
                      {periodLabel(t.period)} · {metricOf(t.metric)?.label ?? t.metric}
                    </div>
                    <div className={s.itemSub}>
                      {Number(fromStored(t.value, t.unit)).toLocaleString('ko-KR')}{UNIT_LABEL[t.unit]}
                      {' · '}{formatPeriodKey(t.period)}
                    </div>
                  </div>
                  <NbButton variant="ghost" onClick={() => remove(t.id)} disabled={busy}>
                    {ACTION.delete}
                  </NbButton>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </NbModal>
  )
}
