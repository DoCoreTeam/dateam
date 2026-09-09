'use client'

/**
 * 영업 리포트 · 지표 탭
 *
 * **주소가 진실이다**(§2-6 (1)). 기간·지표·행축·열축·조건이 전부 주소에 있으므로
 * 새로고침해도 같은 화면이고, 링크를 주면 받는 사람이 **같은 숫자**를 본다.
 * 투자사 보고에서 이게 안 되면 「그 표 다시 뽑아 줘」가 매달 반복된다.
 *
 * 카드는 **누르면 동작한다**(§2-3-1 (1)). 사용자 지시:
 * *"목표나 설정되지 않은 값은 카드를 누르면 바로 설정이 가능하고 보여주고 있는 숫자에
 *  대해서 필터링이 된다거나 카드 클릭에 대한 펑션은 다 포함 되어야 함"*
 *   값이 있는 카드 → 그 지표로 교차표를 연다
 *   목표가 없는 카드 → 목표 설정을 연다
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import type { ListQuery } from '@/lib/ui/list-query'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import Sensitive from '@/components/crm/Sensitive'
import { formatAmount } from '../deals/amount'
import { ACTION, failedTo } from '@/lib/terms'
import { REPORT, UNIT_LABEL, NO_TARGET, NO_TARGET_ACTION, basisLine, dimensionThin, DIMENSION_EMPTY, CLOSE_STATE_LABEL, CLOSE_STATE_HINT, REPORT as R } from '@/lib/terms/report'
import { periodLabel, parsePeriodKey, formatPeriodKey, periodOfToday, type Period, type PeriodKind, type TargetSpec, INDEX_MAX, findTarget } from '@/lib/crm/domain/target'
import { computeDerived } from '@/lib/crm/domain/derived'
import { canMove, type CloseStateKey } from '@/lib/crm/domain/close'
import { ALL_KEY, EMPTY_KEY, CELL_SEP, TIME_AXIS_LABEL } from '@/lib/crm/domain/metric-agg'
import { isThin } from '@/lib/crm/domain/dimensions'
import AskBar from './AskBar'
import FillDomains from './FillDomains'
import TargetModal from './TargetModal'
import s from './metrics.module.css'

// ------------------------------------------------------------
// 서버가 주는 모양 — API 와 같은 이름을 쓴다
// ------------------------------------------------------------

interface AxisItem { key: string; label: string }
interface Cell { count: number; byCurrency: Record<string, string> }

interface AggResult {
  metric: string
  label: string
  unit: string
  dateBasis: string
  from: string
  to: string
  rows: AxisItem[]
  cols: AxisItem[]
  cells: Record<string, Cell>
  total: Cell
  notes: { unknownProbability: number; mixedCurrency: boolean; matched: number }
}

interface Payload {
  period: string
  from: string | null
  to: string | null
  todayKey: string
  rows: string | null
  cols: string | null
  metric: string | null
  /** 서버가 **인정한** 조건만 온다. 모르는 축은 조용히 버려진다 */
  filters: { dimension: string; value: string; label: string | null }[]
  cards: AggResult[]
  matrix: AggResult | null
  targets: TargetSpec[]
  close: {
    periodKey: string
    state: CloseStateKey
    revision: number
    confirmedAt: string | null
    snapshot: Record<string, string>
    live: boolean
    closable: boolean
    blockedReason: string | null
  }
  catalog: {
    metrics: { key: string; label: string; hint: string; unit: string; derived?: boolean }[]
    dimensions: { key: string; label: string; hint: string }[]
  }
  notes: {
    truncated: boolean
    dealCount: number
    hiddenPipelines: number
    fill: Record<string, { filled: number; total: number }>
  }
}

// ------------------------------------------------------------
// 값 그리기 — 통화를 합치지 않는다. 합치면 조용히 틀린다
// ------------------------------------------------------------

function cellText(cell: Cell | undefined, unit: string): string {
  if (!cell) return '—'
  if (unit !== 'money') return `${cell.count.toLocaleString('ko-KR')}${UNIT_LABEL[unit as 'count'] ?? ''}`
  const parts = Object.entries(cell.byCurrency)
    .filter(([, v]) => v !== '0')
    .map(([cur, v]) => formatAmount(v, cur) ?? `${v} ${cur}`)
  if (parts.length > 0) return parts.join(' · ')
  // **0 원이라고 말한다.** 「—」로 그리면 «모른다»와 «없다»가 같아 보이는데,
  // 조건을 걸었더니 그 조건의 수주가 없다는 것은 **아는 사실**이다
  return formatAmount('0', 'KRW') ?? '0'
}

/**
 * 카드가 목표와 견줄 수 있게 하나의 값으로 접는다 — 원화만 본다(섞이면 화면이 먼저 말한다).
 *
 * **해당하는 딜이 없으면 0 이다.** null 로 넘기면 달성률·부족분·배수가 전부 「모름」이 되는데,
 * 조건을 걸었더니 그 조건의 수주가 없다는 것은 **아는 사실**이다
 * (실측: 단계 조건을 걸면 수주가 「0원」인데 달성률만 「—」였다).
 * null 은 «집계 자체가 없을 때»만이다.
 */
function primaryValue(cell: Cell | undefined, unit: string): string | null {
  if (!cell) return null
  if (unit !== 'money') return String(cell.count)
  return cell.byCurrency.KRW ?? Object.values(cell.byCurrency)[0] ?? '0'
}


/** 파생값 한 칸 — 단위가 셋(원·배·%)이라 그리는 법이 다르다. 없으면 「—」가 아니라 이유를 말한다 */
function derivedText(d: { unit: string; value: number | string | null; missing: string[] } | null): string {
  if (!d) return '—'
  if (d.value === null) return d.missing[0] ?? '—'
  if (d.unit === 'money') return formatAmount(String(d.value), 'KRW') ?? String(d.value)
  if (d.unit === 'percent') return `${d.value}%`
  if (d.unit === 'times') return `${d.value}배`
  return String(d.value)
}

const MATRIX_QUERY: ListQuery = {
  q: '', sort: { key: '_row', dir: 'asc' }, filters: {},
  view: 'table', size: 100, mode: 'pages', page: 1,
}

/**
 * 지표 묶음 — **뜻이 같은 것끼리 모은다.**
 *
 * 카드를 한 줄로 늘어놓으면 「아직 안 판 것」과 「이미 끝난 것」과 「밀린 것」이
 * 같은 무게로 읽힌다. 영업이 숫자로 대화할 때는 그 셋을 다른 말로 쓴다.
 */
const GROUPS: { key: string; label: string; hint: string; metrics: string[]; risk?: boolean }[] = [
  { key: 'open', label: '아직 안 판 것', hint: '이번 기간에 끝날 예정인 딜', metrics: ['open_pipeline', 'weighted', 'new_deals'] },
  { key: 'done', label: '판 것', hint: '이번 기간에 끝난 딜', metrics: ['bookings', 'won_count', 'lost_count'] },
  { key: 'risk', label: '봐야 할 것', hint: '예상의 신뢰도를 깎는 딜', metrics: ['overdue', 'stalled'], risk: true },
]

/** 마감이 갈 수 있는 곳 — 갈 수 있는 것만 버튼으로 낸다 */
const CLOSE_NEXT: CloseStateKey[] = ['reviewing', 'confirmed', 'draft']

/** 주역 패널에 서는 파생 넷 — 목표가 있어야 뜻이 생긴다 */
const HERO_STATS = [
  { key: 'shortfall' }, { key: 'needed_new' }, { key: 'coverage' }, { key: 'pace' },
] as const

/** 축을 안 골랐을 때의 이름 — 고르는 칸과 표 머리가 **같은 말**을 써야 한다 */
const AXIS_NONE = { rows: '합계만', cols: '값 하나' } as const

const PERIOD_KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'YEAR', label: '연간' },
  { kind: 'HALF', label: '반기' },
  { kind: 'QUARTER', label: '분기' },
  { kind: 'MONTH', label: '월간' },
]

/**
 * 시간 축은 쪼개는 기준 목록에 없다 — 축에는 설 수 있으므로 여기서 더한다.
 * **이름은 여기서 짓지 않는다**(§0-2) — 도우미와 같은 표를 읽어야 같은 말을 쓴다.
 */
const TIME_AXES = Object.entries(TIME_AXIS_LABEL).map(([key, label]) => ({ key, label }))

export default function MetricsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const [closeErr, setCloseErr] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  // 주소를 그대로 서버에 넘긴다 — 화면이 조건을 따로 들고 있지 않으니 어긋날 자리가 없다
  const queryString = useMemo(() => {
    const keep = new URLSearchParams()
    sp.forEach((v, k) => {
      if (k === 'period' || k === 'metric' || k === 'rows' || k === 'cols' || k.startsWith('f.')) {
        if (v) keep.set(k, v)
      }
    })
    return keep.toString()
  }, [sp])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    fetch(`/api/crm/metrics${queryString ? `?${queryString}` : ''}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!alive) return
        // 오류 봉투는 `{error:{code,message,details}}` 다. 객체를 그대로 넣으면
        // 화면이 「Objects are not valid as a React child」로 통째로 죽는다(실측)
        if (!res.ok) { setError(json?.error?.message ?? '리포트를 불러오지 못했습니다.'); return }
        setData(json as Payload)
      })
      .catch(() => { if (alive) setError('리포트를 불러오지 못했습니다.') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [queryString, reload])

  /**
   * 조건을 **통째로** 바꾼다 — 도우미 전용.
   *
   * 부분 갱신(`set`)을 쓰면 이전에 걸린 조건이 남아, 새 물음의 답에 옛 조건이
   * 섞인다. 사람은 새로 물었다고 생각하는데 화면은 두 물음을 겹쳐 보여 준다.
   */
  const replaceAll = useCallback((params: Record<string, string>) => {
    const next = new URLSearchParams()
    const tab = sp.get('tab')
    if (tab) next.set('tab', tab)
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v)
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, sp])

  /** 마감 상태를 옮긴다 — 확정은 되돌릴 수 없으므로 서버가 한 번 더 막는다 */
  const moveClose = useCallback(async (to: CloseStateKey) => {
    setClosing(true); setCloseErr(null)
    try {
      const res = await fetch('/api/crm/metrics', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ close: { period: sp.get('period') ?? undefined, state: to } }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) { setCloseErr(json?.error?.message ?? failedTo('마감', '바꾸지')); return }
      setReload((n) => n + 1)
    } catch {
      setCloseErr(failedTo('마감', '바꾸지'))
    } finally {
      setClosing(false)
    }
  }, [sp])

  const set = useCallback((patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    router.replace(`${pathname}?${next.toString()}`, { scroll: false })
  }, [router, pathname, sp])

  const period: Period = parsePeriodKey(sp.get('period'), periodOfToday('YEAR', data?.todayKey ?? '2026-01-01'))
  const activeMetric = data?.metric ?? null

  if (loading && !data) return <SkelList rows={6} />
  if (error) return <ErrorState message={error} onRetry={() => set({})} />
  if (!data) return <EmptyState title="리포트가 아직 없어요" description="딜을 만들면 여기에 숫자가 섭니다" />

  // 목표와 실적을 견줄 재료 — 카드 값에서 뽑는다
  const values: Record<string, string | null> = {}
  for (const c of data.cards) values[c.metric] = primaryValue(c.total, c.unit)
  const bookingTarget = findTarget(data.targets, { period, scope: { kind: 'ALL' }, metric: 'bookings' })
  const derivedInput = {
    values,
    target: bookingTarget?.value ?? null,
    elapsed: elapsedOf(data.from, data.to, data.todayKey),
  }
  const attainment = computeDerived('attainment', derivedInput)
  const shortfall = computeDerived('shortfall', derivedInput)
  const coverage = computeDerived('coverage', derivedInput)
  const neededNew = computeDerived('needed_new', derivedInput)
  const pace = computeDerived('pace', derivedInput)
  const elapsed = derivedInput.elapsed
  const bookingsCard = data.cards.find((c) => c.metric === 'bookings')

  /**
   * 축 이름. **안 고른 축을 「없음」이라 부르지 않는다** — 「없음」은 값이 비어 있는
   * 줄의 이름이라 뜻이 겹친다. 고르는 칸에 쓰인 말을 그대로 쓴다.
   */
  const dimLabel = (key: string | null, unpicked: string) => {
    if (!key) return unpicked
    return TIME_AXES.find((t) => t.key === key)?.label
      ?? data.catalog.dimensions.find((d) => d.key === key)?.label
      ?? key
  }

  // 교차표 컬럼 — 열축이 없으면 값 한 칸이다
  const matrix = data.matrix
  const columns: ColumnDef<AxisItem>[] = matrix
    ? [
      { key: '_row', header: dimLabel(data.rows, AXIS_NONE.rows), primary: true, cell: (r) => r.label },
      ...matrix.cols.map((c): ColumnDef<AxisItem> => ({
        key: c.key,
        header: c.key === ALL_KEY ? matrix.label : c.label,
        align: 'right',
        cell: (r) => (
          <span className={s.cell}>
            <Sensitive>{cellText(matrix.cells[`${r.key}${CELL_SEP}${c.key}`], matrix.unit)}</Sensitive>
          </span>
        ),
      })),
    ]
    : []

  return (
    <div>
      {/*
        도우미 — 자연어를 조건으로 바꾼다. 결과는 **주소로** 들어가므로
        도우미가 연 화면도 링크로 공유되고 뒤로가기가 된다(화면과 같은 길).
      */}
      <AskBar onRun={(p) => replaceAll(p)} />

      {/* 조건 줄 — 고르는 것만 있다 */}
      <div className={s.bar}>
        <div className={s.field}>
          <label className="label" htmlFor="mx-kind">기간</label>
          <select
            id="mx-kind" className="input-field" value={period.kind}
            onChange={(e) => {
              const kind = e.target.value as PeriodKind
              const max = INDEX_MAX[kind]
              set({ period: formatPeriodKey({ kind, year: period.year, ...(max > 1 ? { index: Math.min(period.index ?? 1, max) } : {}) }) })
            }}
          >
            {PERIOD_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </div>

        <div className={s.field}>
          <label className="label" htmlFor="mx-year">연도</label>
          <select
            id="mx-year" className="input-field" value={period.year}
            onChange={(e) => set({ period: formatPeriodKey({ ...period, year: Number(e.target.value) }) })}
          >
            {Array.from({ length: 5 }, (_, i) => period.year - 2 + i).map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
        </div>

        {INDEX_MAX[period.kind] > 1 && (
          <div className={s.field}>
            <label className="label" htmlFor="mx-index">{period.kind === 'MONTH' ? '월' : period.kind === 'QUARTER' ? '분기' : '반기'}</label>
            <select
              id="mx-index" className="input-field" value={period.index ?? 1}
              onChange={(e) => set({ period: formatPeriodKey({ ...period, index: Number(e.target.value) }) })}
            >
              {Array.from({ length: INDEX_MAX[period.kind] }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}

        <div className={s.field}>
          <label className="label" htmlFor="mx-rows">행 · {REPORT.dimension}</label>
          <select id="mx-rows" className="input-field" value={data.rows ?? ''} onChange={(e) => set({ rows: e.target.value || null })}>
            <option value="">{AXIS_NONE.rows}</option>
            {TIME_AXES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            {data.catalog.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>

        <div className={s.field}>
          <label className="label" htmlFor="mx-cols">열 · {REPORT.dimension}</label>
          <select id="mx-cols" className="input-field" value={data.cols ?? ''} onChange={(e) => set({ cols: e.target.value || null })}>
            <option value="">{AXIS_NONE.cols}</option>
            {TIME_AXES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            {data.catalog.dimensions.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </div>

        <NbButton variant="ghost" onClick={() => { setTargetFor(activeMetric); setModalOpen(true) }}>
          목표 설정
        </NbButton>

        <span className={s.basis}>{periodLabel(period)} · 딜 {data.notes.dealCount.toLocaleString('ko-KR')}건</span>
      </div>

      {/*
        마감 — **시스템이 먼저 닫고 사람이 고친다.**
        딜은 계속 움직여서 「9월 수주」를 10월에 다시 조회하면 다른 숫자가 나온다.
        확정하면 그 시점의 숫자가 박히고, 그 뒤 수정은 수정본으로 새로 만든다.
      */}
      <div className={s.close} data-state={data.close.state}>
        <span className={s.closeState}>{R.close} · {CLOSE_STATE_LABEL[data.close.state]}</span>
        <span className={s.closeHint}>
          {data.close.blockedReason ?? CLOSE_STATE_HINT[data.close.state]}
          {data.close.revision > 0 && ` · 수정본 ${data.close.revision}판`}
        </span>
        {CLOSE_NEXT.filter((n) => canMove(data.close.state, n)).map((n) => (
          <NbButton
            key={n}
            variant="ghost"
            disabled={closing || (n === 'confirmed' && !data.close.closable)}
            onClick={() => void moveClose(n)}
          >
            {closing ? <AXDotLoader /> : `${CLOSE_STATE_LABEL[n]}${n === 'draft' ? '으로' : '으로'}`}
          </NbButton>
        ))}
        {closeErr && <span className={s.err} role="alert">{closeErr}</span>}
      </div>

      {/* 걸린 조건 — 어떻게 푸는지가 보여야 한다 */}
      {/*
        **서버가 인정한 조건만 그린다.** 주소를 화면이 다시 읽으면, 서버가 버린
        `f.없는축=x` 같은 조건을 걸린 것처럼 보여 준다 — 숫자에는 안 걸렸는데
        화면만 걸렸다고 말하는 상태다(실측: 주소를 손으로 고쳐 칩이 떴다).
      */}
      {data.filters.length > 0 && (
        <div className={s.chips}>
          {data.filters.map((f) => (
            <button key={f.dimension} type="button" className={s.chip} onClick={() => set({ [`f.${f.dimension}`]: null })}>
              {dimLabel(f.dimension, AXIS_NONE.rows)} · {f.label ?? (f.value === EMPTY_KEY ? DIMENSION_EMPTY : f.value)} ×
            </button>
          ))}
        </div>
      )}

      {/*
        **주역 패널.** 카드 아홉 개를 같은 크기로 늘어놓으면 「38.2억」과 「0건」이
        같은 무게로 읽힌다 — 그건 보고가 아니라 덤프다. 목표 대비를 가장 크게 두고,
        나머지는 뜻이 같은 것끼리 묶는다(아직 안 판 것 · 판 것 · 위험).
      */}
      <section className={`card ${s.hero}`}>
        <div className={s.heroMain}>
          <span className={s.groupLabel}>{periodLabel(period)} · 수주 목표 대비</span>
          {bookingTarget ? (
            <>
              <span className={s.heroValue}>
                <Sensitive>{attainment?.value !== null && attainment ? `${attainment.value}%` : '—'}</Sensitive>
              </span>
              <span className={s.heroBar}>
                <span
                  className={s.heroBarFill}
                  style={{ width: `${Math.min(100, Math.max(0, Number(attainment?.value ?? 0)))}%` }}
                />
                {elapsed !== null && (
                  <span className={s.heroBarNow} style={{ left: `${Math.min(100, elapsed * 100)}%` }} />
                )}
              </span>
              <span className={s.heroSub}>
                <Sensitive>{cellText(bookingsCard?.total, 'money')}</Sensitive>
                {' / '}
                <Sensitive>{formatAmount(bookingTarget.value, 'KRW') ?? bookingTarget.value}</Sensitive>
                {elapsed !== null && ` · 기간은 ${Math.round(elapsed * 100)}% 지났습니다`}
              </span>
            </>
          ) : (
            <>
              <span className={s.heroAsk}>{NO_TARGET}</span>
              <span className={s.heroSub}>
                목표를 정하면 달성률·부족분·필요 신규·페이스가 여기에 섭니다
              </span>
              <span className={s.heroAction}>
                <NbButton onClick={() => { setTargetFor('bookings'); setModalOpen(true) }}>
                  {NO_TARGET_ACTION}
                </NbButton>
              </span>
            </>
          )}
        </div>

        {bookingTarget && (
          <dl className={s.heroStats}>
            {HERO_STATS.map((h) => {
              const d = h.key === 'shortfall' ? shortfall : h.key === 'coverage' ? coverage : h.key === 'needed_new' ? neededNew : pace
              return (
                <div key={h.key} className={s.heroStat}>
                  <dt className={s.heroStatLabel} title={d?.hint ?? ''}>{d?.label ?? h.key}</dt>
                  <dd className={s.heroStatValue}>
                    <Sensitive>{derivedText(d)}</Sensitive>
                  </dd>
                </div>
              )
            })}
            <div className={s.heroStat}>
              <dt className={s.heroStatLabel}>목표</dt>
              <dd className={s.heroStatValue}>
                <button type="button" className={s.linkBtn} onClick={() => { setTargetFor('bookings'); setModalOpen(true) }}>
                  {ACTION.edit}
                </button>
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* 묶음 — 뜻이 같은 지표끼리. 카드는 전부 눌러서 표를 연다 */}
      {GROUPS.map((g) => {
        const items = g.metrics.map((k) => data.cards.find((c) => c.metric === k)).filter(Boolean) as AggResult[]
        if (items.length === 0) return null
        return (
          <section key={g.key} className={s.group}>
            <h2 className={s.groupLabel}>
              {g.label}
              <span className={s.groupHint}>{g.hint}</span>
            </h2>
            <div className={s.groupGrid}>
              {items.map((c) => {
                const on = activeMetric === c.metric
                const alert = g.risk && c.total.count > 0
                return (
                  <button
                    key={c.metric} type="button"
                    className={`card ${s.card}${on ? ` ${s.cardOn}` : ''}${alert ? ` ${s.cardAlert}` : ''}`}
                    onClick={() => set({ metric: on ? null : c.metric })}
                    aria-pressed={on}
                    title={`${c.label} · ${basisLine(c.dateBasis as 'wonAt')}`}
                  >
                    <span className={s.cardLabel}>{c.label}</span>
                    <span className={s.cardValue}><Sensitive>{cellText(c.total, c.unit)}</Sensitive></span>
                    <span className={s.cardSub}>
                      {basisLine(c.dateBasis as 'wonAt')}
                      {c.unit === 'money' && ` · ${c.notes.matched.toLocaleString('ko-KR')}건`}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}

      {/* 숫자를 그대로 믿으면 안 되는 사정 */}
      <div className={s.notes}>
        {data.notes.truncated && (
          <span className={`${s.note} ${s.noteWarn}`}>딜이 많아 일부만 셌습니다. 기간을 좁혀 주세요</span>
        )}
        {matrix?.notes.unknownProbability ? (
          <span className={`${s.note} ${s.noteWarn}`}>확률을 모르는 딜 {matrix.notes.unknownProbability}건은 가중 예상에서 뺐습니다</span>
        ) : null}
        {matrix?.notes.mixedCurrency && (
          <span className={`${s.note} ${s.noteWarn}`}>통화가 둘 이상이라 합치지 않고 나란히 적습니다</span>
        )}
        {data.notes.hiddenPipelines > 0 && (
          <span className={s.note}>검증용 파이프라인 {data.notes.hiddenPipelines}개는 축에서 숨겼습니다</span>
        )}
        {data.rows && <ThinNote data={data} dimKey={data.rows} onFilled={() => setReload((n) => n + 1)} />}
      </div>

      {/* 교차표 */}
      <div className={s.section}>
        {matrix ? (
          <>
            <div className={s.sectionHead}>
              <h2 className="tape-title">{matrix.label}</h2>
              <span className={s.basis}>
                {dimLabel(data.rows, AXIS_NONE.rows)} × {dimLabel(data.cols, AXIS_NONE.cols)} · 합계 {cellText(matrix.total, matrix.unit)}
              </span>
            </div>
            <ListSurface<AxisItem>
              rows={matrix.rows}
              columns={columns}
              query={MATRIX_QUERY}
              rowKey={(r) => r.key}
              empty={{ title: '이 기간에 해당하는 딜이 없어요', description: '기간이나 조건을 바꿔 보세요' }}
              onRowClick={data.rows ? (r) => set({ [`f.${data.rows}`]: r.key }) : undefined}
            />
          </>
        ) : (
          /*
            **거대한 빈 상자를 두지 않는다.** 아무것도 안 고른 상태가 이 화면의 기본인데,
            그 기본이 화면 절반을 먹으면 «아직 아무것도 없는 화면»으로 읽힌다.
            한 줄로 무엇을 하면 되는지만 말한다.
          */
          <p className={s.hintLine}>
            카드를 누르면 그 지표로 표가 열립니다. 행·열을 골라 쪼개 볼 수 있어요.
          </p>
        )}
      </div>

      {modalOpen && (
        <TargetModal
          period={period}
          metric={targetFor}
          targets={data.targets}
          todayKey={data.todayKey}
          onClose={() => setModalOpen(false)}
          onSaved={(next) => setData({ ...data, targets: next })}
        />
      )}
    </div>
  )
}

/**
 * 축이 얇으면 먼저 말한다 — 「없음 한 줄」을 데이터가 없는 것으로 읽지 않게.
 *
 * **말만 하고 끝내지 않는다.** 기관 종류는 회사 도메인에서 나오고, 도메인은
 * 그 회사 사람의 이메일에서 **규칙으로** 채울 수 있다(AI 0회). 그래서 여기서 바로 채운다.
 */
function ThinNote({ data, dimKey, onFilled }: { data: Payload; dimKey: string; onFilled: () => void }) {
  const f = data.notes.fill[dimKey]
  if (!f || !isThin(f.filled, f.total)) return null
  const label = data.catalog.dimensions.find((d) => d.key === dimKey)?.label ?? dimKey
  return (
    <span className={`${s.note} ${s.noteWarn}`}>
      {dimensionThin(label, f.filled, f.total)}
      {dimKey === 'companyKind' && <FillDomains onFilled={onFilled} />}
    </span>
  )
}

/**
 * 기간이 얼마나 지났나 — 페이스의 재료.
 *
 * 화면이 계산하지만 **판정은 순수 함수가 한다**(`computeDerived`). 여기서는 비율만 낸다.
 */
function elapsedOf(from: string | null, to: string | null, todayKey: string): number | null {
  if (!from || !to) return null
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  const t = Date.parse(`${todayKey}T00:00:00Z`)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(t) || b <= a) return null
  return Math.min(1, Math.max(0, (t - a) / (b - a)))
}
