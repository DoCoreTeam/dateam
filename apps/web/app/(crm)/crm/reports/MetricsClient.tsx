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
import Sensitive from '@/components/crm/Sensitive'
import { formatAmount } from '../deals/amount'
import { REPORT, UNIT_LABEL, NO_TARGET, NO_TARGET_ACTION, basisLine, dimensionThin, DATE_BASIS_HINT, DIMENSION_EMPTY } from '@/lib/terms/report'
import { periodLabel, parsePeriodKey, formatPeriodKey, periodOfToday, type Period, type PeriodKind, type TargetSpec, INDEX_MAX, findTarget } from '@/lib/crm/domain/target'
import { computeDerived } from '@/lib/crm/domain/derived'
import { ALL_KEY, EMPTY_KEY, CELL_SEP } from '@/lib/crm/domain/metric-agg'
import { isThin } from '@/lib/crm/domain/dimensions'
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

const MATRIX_QUERY: ListQuery = {
  q: '', sort: { key: '_row', dir: 'asc' }, filters: {},
  view: 'table', size: 100, mode: 'pages', page: 1,
}

/** 축을 안 골랐을 때의 이름 — 고르는 칸과 표 머리가 **같은 말**을 써야 한다 */
const AXIS_NONE = { rows: '합계만', cols: '값 하나' } as const

const PERIOD_KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: 'YEAR', label: '연간' },
  { kind: 'HALF', label: '반기' },
  { kind: 'QUARTER', label: '분기' },
  { kind: 'MONTH', label: '월간' },
]

/** 시간 축은 쪼개는 기준 목록에 없다 — 축에는 설 수 있으므로 여기서 더한다 */
const TIME_AXES = [
  { key: 'month', label: '월' },
  { key: 'quarter', label: '분기' },
  { key: 'half', label: '반기' },
  { key: 'year', label: '연' },
]

export default function MetricsClient() {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [targetFor, setTargetFor] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

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
  }, [queryString])

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

      {/* 카드 — 누르면 그 지표로 표가 열린다 */}
      <div className="responsive-grid-cols-4">
        {data.cards.map((c) => {
          const on = activeMetric === c.metric
          return (
            <button
              key={c.metric} type="button"
              className={`card ${s.card}${on ? ` ${s.cardOn}` : ''}`}
              onClick={() => set({ metric: on ? null : c.metric })}
              aria-pressed={on}
              title={c.label}
            >
              <span className={s.cardLabel}>{c.label}</span>
              <span className={s.cardValue}><Sensitive>{cellText(c.total, c.unit)}</Sensitive></span>
              <span className={s.cardSub}>{basisLine(c.dateBasis as 'wonAt')} · {c.notes.matched.toLocaleString('ko-KR')}건</span>
            </button>
          )
        })}

        {/* 목표 카드 — 없으면 0 이 아니라 「설정하기」다 */}
        <button
          type="button"
          className={`card ${s.card}`}
          onClick={() => { setTargetFor('bookings'); setModalOpen(true) }}
        >
          <span className={s.cardLabel}>수주 목표 · 달성률</span>
          {bookingTarget ? (
            <>
              <span className={s.cardValue}>
                <Sensitive>{attainment?.value !== null && attainment ? `${attainment.value}%` : '—'}</Sensitive>
              </span>
              <span className={s.cardBar}>
                <span
                  className={s.cardBarFill}
                  style={{ width: `${Math.min(100, Math.max(0, Number(attainment?.value ?? 0)))}%` }}
                />
              </span>
              <span className={s.cardSub}>
                목표 <Sensitive>{formatAmount(bookingTarget.value, 'KRW') ?? bookingTarget.value}</Sensitive>
              </span>
            </>
          ) : (
            <>
              <span className={s.cardAsk}>{NO_TARGET}</span>
              <span className={s.cardSub}>{NO_TARGET_ACTION}</span>
            </>
          )}
        </button>

        {bookingTarget && (
          <div className={`card ${s.card}`} style={{ cursor: 'default' }}>
            <span className={s.cardLabel}>부족분 · 파이프라인 배수</span>
            <span className={s.cardValue}>
              <Sensitive>{shortfall?.value ? (formatAmount(String(shortfall.value), 'KRW') ?? String(shortfall.value)) : '—'}</Sensitive>
            </span>
            <span className={s.cardSub}>
              배수 {coverage?.value !== null && coverage ? `${coverage.value}배` : '—'}
            </span>
          </div>
        )}
      </div>

      {/* 숫자를 그대로 믿으면 안 되는 사정 */}
      <div className={s.notes}>
        <span className={s.note}>{DATE_BASIS_HINT[(matrix?.dateBasis ?? 'wonAt') as 'wonAt']}</span>
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
        {data.rows && thinNote(data, data.rows)}
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
          <EmptyState
            title="볼 지표를 골라 주세요"
            description="위 카드를 누르면 그 지표로 표가 열립니다"
          />
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

/** 축이 얇으면 먼저 말한다 — 「없음 한 줄」을 데이터가 없는 것으로 읽지 않게 */
function thinNote(data: Payload, key: string) {
  const f = data.notes.fill[key]
  if (!f || !isThin(f.filled, f.total)) return null
  const label = data.catalog.dimensions.find((d) => d.key === key)?.label ?? key
  return <span className={`${s.note} ${s.noteWarn}`}>{dimensionThin(label, f.filled, f.total)}</span>
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
