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
import { DIRECTION_LABEL, formatIndexPrice, formatProbability } from '@/lib/trading/signal-labels'
import { UNKNOWN_TEXT, seoulTimeText } from '@/lib/trading/position-labels'
import styles from './ChartPanel.module.css'

interface Props {
  chart: ChartSeries
  /** 최근 신호. 맨 앞이 가장 최근이다 */
  signals: readonly SignalRow[]
  /** 신호가 없는 이유 — 마지막 실행이 어디까지 갔나 */
  emitProgress: { step: number; total: number; reason: string } | null
}

/** 기대값은 평균표가 정한다. 없으면 없다고 말한다 — 0 은 「본전이 기대된다」는 사실이다 */
function evText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return UNKNOWN_TEXT
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`
}

export default function ChartPanel({ chart, signals, emitProgress }: Props) {
  const latest = signals[0] ?? null
  return (
    <section className={`card ${styles.panel}`}>
      <div className={styles.chartSide}>
        <h2 className={styles.title}>가격과 신호</h2>
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
        {latest
          ? (
            <>
              <strong className={`${styles.call} ${latest.direction === 'long' ? styles.long : styles.short}`}>
                {DIRECTION_LABEL[latest.direction]}
              </strong>
              <dl className={styles.facts}>
                <div className={styles.fact}>
                  <dt>확률</dt>
                  <dd>{formatProbability(latest.calibratedProb)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>기대값</dt>
                  <dd>{evText(latest.netExpectedValueR)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>기준가</dt>
                  <dd>{formatIndexPrice(latest.referencePrice)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>손절</dt>
                  <dd>{formatIndexPrice(latest.stopPrice)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>목표</dt>
                  <dd>{formatIndexPrice(latest.targetPrice)}</dd>
                </div>
                <div className={styles.fact}>
                  <dt>시각</dt>
                  <dd>{seoulTimeText(latest.barCloseAt)}</dd>
                </div>
              </dl>
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
          <R.Tooltip
            formatter={(v: unknown, name: string) => [String(v), name]}
            labelFormatter={(l: string) => l}
          />
          <R.Bar dataKey="band" shape={<Candle />} isAnimationActive={false} />
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
                value: DIRECTION_LABEL[m.direction],
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
