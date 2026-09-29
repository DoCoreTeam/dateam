'use client'

// app/(trading)/trading/ChartPanel.tsx — 가격과 지금 예측
//
// 사용자 지적 2026-09-28: 「차트 보이고 예측한 답은 어디서 보는 거야? 그게 메인이어야
// 될 텐데 그리고 실시간으로 보여지는 화면 형태여야」
//
// 그래서 이 자리가 현황의 **맨 위**다. 가격이 어디로 갔는지와 우리가 어디서 무엇을
// 말했는지가 한 그림에 있고, 가장 최근 예측이 그 옆에 큰 글자로 선다.
//
// 그릴 것이 없으면 **빈 차트를 안 그린다.** 빈 차트는 「값이 0」으로 읽히고,
// 실제로는 봉이 한 줄도 안 들어온 것이다 — 둘은 할 일이 완전히 다르다.
//
// recharts 는 무겁다. 첫 화면 비용에 안 얹으려고 **그릴 것이 있을 때만** 잘라서 불러온다.

import { useEffect, useState } from 'react'
import { CandlestickChart, HelpCircle } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import type { ChartSeries, SignalRow } from '@/lib/trading/overview-shape'
import { pickNowCall, callAgeLabel, chartTitle, planForCall } from '@/lib/trading/chart/series'
import type { CallPlan } from '@/lib/trading/chart/series'
import { LEANING_LABEL, JUDGE_LABEL } from '@/lib/trading/judgment-labels'
import {
  formatIndexPrice, formatProbability, formatMinutes, formatDistance,
  PLAN_LABEL, PLAN_SOURCE_LABEL,
} from '@/lib/trading/signal-labels'
import { UNKNOWN_TEXT, seoulTimeText } from '@/lib/trading/position-labels'
import styles from './ChartPanel.module.css'

interface Props {
  chart: ChartSeries
  /** 최근 신호. 맨 앞이 가장 최근이다 */
  signals: readonly SignalRow[]
  /** 신호가 없는 이유 — 마지막 실행이 어디까지 갔나 */
  emitProgress: { step: number; total: number; reason: string } | null
}

/**
 * 봉 하나를 사람 말로 — 시가·고가·저가·종가와 그 봉에서 난 판단.
 *
 * **기계 이름을 안 찍는다.** recharts 기본 도움말은 `dataKey` 를 그대로 보여 주므로
 * `band : 1092.28,1093.3` 이 된다. 읽는 사람은 그것이 무엇인지 알 길이 없다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function BarTip({ active, payload, calls }: any) {
  const row = payload?.[0]?.payload as
    | { at: string; label: string; open: number; high: number; low: number; close: number }
    | undefined
  if (!active || !row) return null
  const mine = (calls as ChartSeries['calls']).filter((c) => c.barAt === row.at)
  const up = row.close >= row.open
  return (
    <div className={styles.tip}>
      <strong className={styles.tipTime}>{row.label}</strong>
      <dl className={styles.tipRows}>
        {([['시가', row.open], ['고가', row.high], ['저가', row.low], ['종가', row.close]] as const).map(
          ([name, value]) => (
            <div key={name} className={styles.tipRow}>
              <dt>{name}</dt>
              <dd className={name === '종가' ? (up ? styles.long : styles.short) : undefined}>
                {formatIndexPrice(value)}
              </dd>
            </div>
          ),
        )}
      </dl>
      {/* 그 봉에서 난 판단도 같이 — 표식만 보고 무엇을 판단했는지 몰랐다 */}
      {mine.map((c) => (
        <span key={c.judgmentId} className={styles.tipCall}>
          {`${JUDGE_LABEL[c.judge] ?? c.judge} · ${LEANING_LABEL[c.direction]} ${formatProbability(c.prob)}`}
        </span>
      ))}
    </div>
  )
}

/**
 * 그 봉의 종가. 판단에는 가격이 없으므로 **그 봉 위에** 찍는다 —
 * 없는 값을 지어내지 않고 같은 봉의 값을 쓴다
 */
function priceAt(chart: ChartSeries, barAt: string): number | undefined {
  return chart.bars.find((b) => b.at === barAt)?.close
}

/** 이 답이 어디서 왔나. 신호와 판단은 무게가 다르다 */
const SIGNAL_SOURCE = '관문을 지난 신호'
const JUDGMENT_SOURCE = '판단 기록'
const NOT_A_SIGNAL = '아직 신호로는 안 나갔습니다'

/** 기대값은 평균표가 정한다. 없으면 없다고 말한다 — 0 은 「본전이 기대된다」는 사실이다 */
function evText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN_TEXT
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
}

/**
 * 주문 계획 — **얼마에 들어가고 얼마에 끊고 얼마에 나오나**
 *
 * 사용자 지적 2026-09-29: 「내가 지금 주문을 어떻게 해야 하는지 모르겠어」.
 * 방향과 점수만으로는 주문을 못 낸다. 값은 전부 `planForCall` 이 만든 것이고
 * 이 자리에서 식을 다시 적지 않는다(M4).
 */
function PlanBlock({ plan }: { plan: CallPlan }) {
  const rows: { name: string; value: string; hint?: string }[] = [
    { name: PLAN_LABEL.reference, value: formatIndexPrice(plan.referencePrice) },
    {
      name: PLAN_LABEL.chase,
      // 신호 행에는 안 남는 값이다. 없으면 없다고 말하고 기준가로 채우지 않는다
      value: formatIndexPrice(plan.chaseLimitPrice),
      hint: plan.chaseLimitPrice === null ? undefined : '여기를 넘으면 안 따라갑니다',
    },
    {
      name: PLAN_LABEL.stop,
      value: formatIndexPrice(plan.stopPrice),
      hint: formatDistance(plan.referencePrice, plan.stopPrice),
    },
    {
      name: PLAN_LABEL.target,
      value: formatIndexPrice(plan.targetPrice),
      hint: formatDistance(plan.referencePrice, plan.targetPrice),
    },
  ]
  return (
    <div className={styles.plan}>
      {/* 기록인지 예고인지를 먼저 말한다 — 예고를 지시로 읽으면 사람이 그대로 주문한다 */}
      <p className={styles.planSource}>{PLAN_SOURCE_LABEL[plan.from]}</p>
      <dl className={styles.facts}>
        {rows.map((r) => (
          <div key={r.name} className={styles.fact}>
            <dt>{r.name}</dt>
            <dd>
              {r.value}
              {r.hint && <span className={styles.age}> · {r.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
      {/*
        **언제까지가 둘이다.** 들어갈 수 있는 동안과 들어간 뒤 들고 있는 동안은
        다른 시계다. 한 글자로 뭉치면 「10분 뒤에 나오라는 건가」가 된다
      */}
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.validFor}</dt>
          <dd>{formatMinutes(plan.validMinutes)}<span className={styles.age}> · 그 안에 못 들어가면 버립니다</span></dd>
        </div>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.holdFor}</dt>
          <dd>{formatMinutes(plan.timeExitMinutes)}<span className={styles.age}> · 들어간 뒤부터 셉니다</span></dd>
        </div>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.sessionExit}</dt>
          <dd>{plan.sameDayExitAt ? seoulTimeText(plan.sameDayExitAt) : UNKNOWN_TEXT}</dd>
        </div>
      </dl>
    </div>
  )
}

export default function ChartPanel({ chart, signals, emitProgress }: Props) {
  /**
   * **있는 것을 먼저 보여 준다.** 신호가 0건이어도 판단은 매분 쌓인다 —
   * 그것을 안 보고 「판단이 한 번도 안 돌았습니다」라고 하면 화면이 거짓말을 한다
   * (사용자 지적 2026-09-28: 판단 기록엔 숏 90% 가 줄줄이 있었다).
   */
  const call = pickNowCall({ signals, calls: chart.calls })
  /**
   * 그 답대로 주문한다면 얼마인가. **관망이거나 지표를 못 구했으면 null 이고**,
   * 그때는 왜 없는지를 `chart.planBlocked` 가 말한다 — 빈 칸은 「계획 없음」으로 읽힌다.
   */
  const plan = call ? planForCall(call, chart) : null
  /*
    **나이는 화면이 잰다.** 서버에서 재서 글자로 내려보내면 그 글자는 찍힌 순간에 멈추고,
    탭을 열어 둔 채 한 시간이 지나도 「1분 전」이다. 첫 렌더에는 안 그린다 —
    서버가 그린 것과 달라지면 하이드레이션이 어긋난다.
  */
  const [callAge, setCallAge] = useState<string | null>(null)
  /*
    `call` 전체가 아니라 **시각 하나만** 본다. `pickNowCall` 이 매 렌더마다 새 객체를
    만들어서, 객체를 의존성에 두면 30초 시계가 렌더마다 풀렸다 다시 걸린다.
  */
  const callAt = call?.at ?? null
  useEffect(() => {
    if (!callAt) { setCallAge(null); return }
    const tick = () => setCallAge(callAgeLabel(callAt, new Date()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [callAt])

  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.chartSide}>
        {/* 제목이 실제로 그리는 것을 말한다 — 신호가 0건인데 「신호」라고 적지 않는다 */}
        <h2 className={styles.title}>{chartTitle({ signalCount: signals.length, callCount: chart.calls.length })}</h2>
        {chart.bars.length === 0
          ? (
            <EmptyState
              icon={<CandlestickChart size={28} />}
              title="가격 봉이 아직 없습니다"
              description={chart.blocked?.text}
            />
          )
          : <PriceChart chart={chart} />}
      </div>

      <div className={styles.callSide}>
        <h2 className={styles.title}>지금 예측</h2>
        {call
          ? (
            <>
              <strong className={`${styles.call} ${call.direction === 'long' ? styles.long : call.direction === 'short' ? styles.short : styles.hold}`}>
                {LEANING_LABEL[call.direction]}
              </strong>
              {/* 신호인지 판단인지를 말한다 — 신호는 관문을 다 지난 것이라 무게가 다르다 */}
              <span className={styles.source}>
                {call.from === 'signal'
                  ? SIGNAL_SOURCE
                  : `${JUDGE_LABEL[call.judge ?? ''] ?? call.judge ?? ''} · ${JUDGMENT_SOURCE}`}
              </span>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>{call.from === 'signal' ? '확률' : '원점수'}</dt>
                  <dd>{formatProbability(call.prob)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>시각</dt>
                  {/* 언제 것인지까지 말한다 — 시각만 있으면 어제 것이 오늘 것으로 읽힌다 */}
                  <dd>{seoulTimeText(call.at)}{callAge && <span className={styles.age}> · {callAge}</span>}</dd>
                </div>
                {call.from === 'signal' && (
                  <div className={styles.fact}>
                    <dt>기대값</dt>
                    <dd>{evText(call.evR)}</dd>
                  </div>
                )}
              </dl>
              {/*
                **계획은 신호에만 있는 것이 아니다.** 전에는 이 네 줄이 신호일 때만
                떴고, 신호가 0건인 판에서는 화면에 숫자가 하나도 없었다 —
                방향과 점수만 보고는 주문을 못 낸다 (사용자 지적 2026-09-29).
              */}
              {plan
                ? <PlanBlock plan={plan} />
                : (
                  <p className={styles.planSource}>
                    {call.direction === 'hold'
                      ? '관망이라 주문할 것이 없습니다'
                      : chart.planBlocked ?? '계획을 세우지 못했습니다'}
                  </p>
                )}
              {/* 판단은 아직 신호가 아니다 — 왜 안 나갔는지를 같은 자리에서 말한다 */}
              {call.from === 'judgment' && (
                <span className={styles.notYet}>
                  {emitProgress
                    ? `${NOT_A_SIGNAL} · ${emitProgress.total}단계 중 ${emitProgress.step}단계에서 멈췄습니다`
                    : NOT_A_SIGNAL}
                </span>
              )}
            </>
          )
          : (
            <EmptyState
              icon={<HelpCircle size={28} />}
              title="아직 판단이 없습니다"
              description={emitProgress
                ? `마지막 실행은 ${emitProgress.total}단계 중 ${emitProgress.step}단계에서 멈췄습니다`
                : chart.blocked?.text ?? '판단이 한 번도 안 돌았습니다'}
            />
          )}
      </div>
    </section>
  )
}

/* ── 그림 ─────────────────────────────────────────────── */

type Recharts = typeof import('recharts')

/**
 * 봉 하나. `Bar` 에 [저가, 고가] 를 주면 recharts 가 그 구간을 사각형으로 잡아 주므로,
 * 그 안에서 시가와 종가 자리를 되짚어 몸통을 그린다 — 축 셈을 여기서 또 하지 않는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Candle(props: any) {
  const { x, y, width, height, payload } = props as {
    x: number; y: number; width: number; height: number
    payload: { open: number; high: number; low: number; close: number }
  }
  const { open, high, low, close } = payload
  const span = high - low
  const toY = (price: number): number => (span === 0 ? y + height / 2 : y + ((high - price) / span) * height)
  const up = close >= open
  const bodyTop = toY(Math.max(open, close))
  const bodyBottom = toY(Math.min(open, close))
  const cx = x + width / 2
  const bodyWidth = Math.max(1, width * 0.6)
  return (
    <g className={up ? styles.up : styles.down}>
      <line x1={cx} x2={cx} y1={y} y2={y + height} strokeWidth={1} />
      <rect
        x={cx - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={Math.max(1, bodyBottom - bodyTop)}
      />
    </g>
  )
}

function PriceChart({ chart }: { chart: ChartSeries }) {
  /**
   * **그릴 것이 있을 때만 불러온다.** 현황을 처음 여는 비용에 차트 묶음을 얹지 않는다 —
   * 봉이 0건인 날에는 이 코드가 아예 안 내려간다.
   */
  const [R, setR] = useState<Recharts | null>(null)
  useEffect(() => {
    let alive = true
    void import('recharts').then((mod) => { if (alive) setR(mod) })
    return () => { alive = false }
  }, [])

  if (!R) return <div className={styles.loadingChart}><SkelCard lines={4} /></div>

  const rows = chart.bars.map((b) => ({
    at: b.at,
    label: seoulTimeText(b.at),
    open: b.open, high: b.high, low: b.low, close: b.close,
    band: [b.low, b.high] as [number, number],
  }))
  const marks = chart.marks

  return (
    <div className={styles.chartBox}>
      <R.ResponsiveContainer width="100%" height="100%">
        <R.ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <R.CartesianGrid strokeDasharray="3 3" stroke="var(--border-light)" />
          <R.XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={32} stroke="var(--text-faint)" />
          <R.YAxis
            domain={chart.domain ?? ['auto', 'auto']}
            tick={{ fontSize: 11 }}
            width={56}
            stroke="var(--text-faint)"
            tickFormatter={(v: number) => v.toFixed(1)}
          />
          {/*
            **도움말을 우리가 그린다.** 기본 도움말은 `dataKey` 를 그대로 찍어
            `band : 1092.28,1093.3` 처럼 나온다 — 사람이 읽으라고 만든 이름이 아니다
            (사용자 지적 2026-09-28 「이거 설명도 없고」).
          */}
          <R.Tooltip content={<BarTip calls={chart.calls} />} />
          <R.Bar dataKey="band" shape={<Candle />} isAnimationActive={false} />
          {/*
            **판단 표식은 신호보다 작고 연하다.** 신호는 관문을 다 지난 것이고
            판단은 그 앞이라, 같은 크기로 찍으면 둘이 같은 무게로 읽힌다
          */}
          {chart.calls.filter((c) => c.direction !== 'hold').map((c) => (
            <R.ReferenceDot
              key={c.judgmentId}
              x={seoulTimeText(c.barAt)}
              y={priceAt(chart, c.barAt)}
              r={3}
              fill={c.direction === 'long' ? 'var(--danger)' : 'var(--accent)'}
              fillOpacity={0.45}
              stroke="none"
            />
          ))}
          {marks.map((m) => (
            <R.ReferenceDot
              key={m.signalId}
              x={seoulTimeText(m.barAt)}
              y={m.price}
              r={6}
              /**
               * 색을 **속성으로** 준다. recharts 는 원에 자기 `fill` 을 박으므로
               * 바깥 `<g>` 의 class 로는 안 물든다 — 그러면 표식이 흰 동그라미가 되고
               * 봉 위에서 사라진다 (실측 2026-09-28)
               */
              fill={m.direction === 'long' ? 'var(--danger)' : 'var(--accent)'}
              stroke="var(--surface-bg)"
              strokeWidth={2}
              label={{
                value: LEANING_LABEL[m.direction],
                position: m.direction === 'long' ? 'top' : 'bottom',
                // 표식에서 띄운다 — 붙으면 글자가 봉과 겹쳐 둘 다 안 읽힌다
                offset: 10,
                fontSize: 11,
                fontWeight: 700,
                fill: m.direction === 'long' ? 'var(--danger)' : 'var(--accent)',
              }}
            />
          ))}
        </R.ComposedChart>
      </R.ResponsiveContainer>
    </div>
  )
}
