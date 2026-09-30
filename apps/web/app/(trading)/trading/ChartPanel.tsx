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

import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { CandlestickChart, HelpCircle } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { SkelCard } from '@/components/ui/LoadingSkeleton'
import type { ChartSeries, SignalRow } from '@/lib/trading/overview-shape'
import { pickNowCall, callAgeLabel, chartTitle, planForCall, zoomWindow, defaultWindow } from '@/lib/trading/chart/series'
import {
  buildDisplayBars, isForming, isChartTimeframe,
  CHART_TIMEFRAMES, DEFAULT_CHART_TIMEFRAME, type ChartTimeframe, type DisplayBar,
} from '@/lib/trading/chart/forming'
import { liveWindowAt } from '@/lib/trading/live-window'
import type { CallPlan } from '@/lib/trading/chart/series'
import { LEANING_LABEL, JUDGE_LABEL } from '@/lib/trading/judgment-labels'
import {
  formatIndexPrice, formatProbability, formatMinutes, formatDistance,
  deadlineLeftText, PLAN_LABEL, PLAN_SOURCE_LABEL,
} from '@/lib/trading/signal-labels'
import { UNKNOWN_TEXT, seoulTimeText } from '@/lib/trading/position-labels'
import styles from './ChartPanel.module.css'

interface Props {
  chart: ChartSeries
  /** 최근 신호. 맨 앞이 가장 최근이다 */
  signals: readonly SignalRow[]
  /** 신호가 없는 이유 — 마지막 실행이 어디까지 갔나 */
  emitProgress: { step: number; total: number; reason: string } | null
  /** 마지막으로 받은 현재가. 형성 중인 봉이 이 값으로 모양을 바꾼다 */
  lastPrice: { price: number; observedAt: string } | null
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

/** 고른 봉 단위를 화면이 기억한다. 설정이 아니라 보는 사람 취향이다 */
const TF_KEY = 'trading.chart.tf'

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
  /*
    **시각은 화면이 잰다.** 서버가 「2분 남음」을 글자로 내려보내면 그 글자는 찍힌 순간에
    멈추고, 탭을 열어 둔 채 십 분이 지나도 「2분 남음」이다 (이 파일이 `callAge` 를
    화면에서 재는 이유와 같다). 첫 렌더에는 안 그린다 — 서버가 그린 것과 달라지면
    하이드레이션이 어긋난다.
  */
  const [left, setLeft] = useState<string>('')
  const [exitAt, setExitAt] = useState<string | null>(null)
  const deadline = plan.entryDeadlineAt
  const holdMinutes = plan.timeExitMinutes
  useEffect(() => {
    const tick = (): void => {
      const now = new Date()
      setLeft(deadlineLeftText(deadline, now))
      setExitAt(holdMinutes > 0 ? new Date(now.getTime() + holdMinutes * 60_000).toISOString() : null)
    }
    tick()
    // 분 단위로 보여 주므로 20초면 충분하다. 1초마다 고쳐 그릴 값이 아니다
    const id = setInterval(tick, 20_000)
    return () => clearInterval(id)
  }, [deadline, holdMinutes])

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
        **언제까지가 둘이고, 둘 다 시각이다.**

        사용자 지적 2026-09-29 「분 이렇게 표시 하지 말고」 — 「진입 유효 10분」은
        언제부터 10분인지 읽는 사람이 판단 시각에 더해야 알 수 있었다. 그 덧셈을 화면이 한다.
        들어갈 수 있는 때와 들어간 뒤 나올 때는 다른 시계라 자리도 따로 둔다.
      */}
      <dl className={styles.facts}>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.entryBy}</dt>
          <dd>
            {plan.entryDeadlineAt ? seoulTimeText(plan.entryDeadlineAt) : UNKNOWN_TEXT}
            {/* 남은 시간은 화면이 센다. 서버가 적어 보내면 탭을 열어 둔 채 굳는다 */}
            {left && <span className={styles.age}> · {left}</span>}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.exitAt}</dt>
          {/*
            들어간 뒤부터 세는 시계라 **지금 들어간다고 볼 때**의 시각이다.
            첫 렌더에는 안 그린다 — 서버가 그린 것과 달라지면 하이드레이션이 어긋난다.
          */}
          <dd>
            {exitAt
              ? <>{seoulTimeText(exitAt)}<span className={styles.age}> · 지금 들어가면</span></>
              : <>{formatMinutes(plan.timeExitMinutes)}<span className={styles.age}> · 들어간 뒤부터</span></>}
          </dd>
        </div>
        <div className={styles.fact}>
          <dt>{PLAN_LABEL.sessionExit}</dt>
          <dd>
            {plan.sameDayExitAt ? seoulTimeText(plan.sameDayExitAt) : UNKNOWN_TEXT}
            <span className={styles.age}> · 늦어도 이때는 정리합니다</span>
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default function ChartPanel({ chart, signals, emitProgress, lastPrice }: Props) {
  /**
   * **있는 것을 먼저 보여 준다.** 신호가 0건이어도 판단은 매분 쌓인다 —
   * 그것을 안 보고 「판단이 한 번도 안 돌았습니다」라고 하면 화면이 거짓말을 한다
   * (사용자 지적 2026-09-28: 판단 기록엔 숏 90% 가 줄줄이 있었다).
   */
  /**
   * **화면 봉 단위.** 통상 HTS 처럼 고르게 둔다.
   *
   * 이것은 **보는 단위**일 뿐이고 시스템은 계속 1분으로 판단한다 — 판단 단위를 바꾸면
   * 그 전 판단과 성적을 못 견주고 보정·기대값표를 다시 쌓아야 한다. 둘을 섞으면 안 된다.
   *
   * 첫 렌더는 기본값이다. 기억한 값을 처음부터 쓰면 서버가 그린 것과 달라져
   * 하이드레이션이 어긋난다.
   */
  const [tf, setTf] = useState<ChartTimeframe>(DEFAULT_CHART_TIMEFRAME)
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(TF_KEY))
    if (isChartTimeframe(saved)) setTf(saved)
  }, [])
  const pickTf = (next: ChartTimeframe): void => {
    setTf(next)
    try { window.localStorage.setItem(TF_KEY, String(next)) } catch { /* 저장 못 해도 화면은 돈다 */ }
  }

  /**
   * 그릴 봉 — 확정 1분봉을 고른 단위로 묶고, 맨 뒤에 형성 중인 봉을 붙인다.
   * **시계를 화면이 쥔다.** 서버 시각으로 만들면 형성 봉이 안 움직인다
   */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    // 값이 안 바뀌어도 「몇 초 지났나」가 바뀌므로 형성 봉 판정을 다시 한다
    const id = setInterval(() => setTick((n) => n + 1), 1_000)
    return () => clearInterval(id)
  }, [])
  const displayBars = useMemo(() => {
    void tick
    const now = new Date()
    return buildDisplayBars({
      bars: chart.bars,
      minutes: tf,
      lastPrice,
      now,
      // 한 단위가 지나도록 값이 안 오면 멈춘 것이다
      staleAfterSeconds: Math.max(60, tf * 60),
      live: liveWindowAt(now).live,
    })
  }, [chart.bars, tf, lastPrice, tick])

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
        <div className={styles.chartHead}>
          <h2 className={styles.title}>{chartTitle({ signalCount: signals.length, callCount: chart.calls.length })}</h2>
          {/*
            **보는 단위지 판단 단위가 아니다.** 시스템은 계속 1분으로 판단한다 —
            그 사실을 옆줄이 말한다. 섞이면 「60분으로 바꿨으니 판단도 60분」으로 읽는다
          */}
          <div className={styles.tfPick} role="group" aria-label="봉 단위">
            {CHART_TIMEFRAMES.map((m) => (
              <button
                key={m}
                type="button"
                className={`${styles.tfBtn} ${m === tf ? styles.tfOn : ''}`}
                aria-pressed={m === tf}
                onClick={() => pickTf(m)}
              >
                {`${m}분`}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.tfNote}>판단은 1분봉으로 합니다. 이 고르기는 보는 단위만 바꿉니다</p>
        {chart.bars.length === 0
          ? (
            <EmptyState
              icon={<CandlestickChart size={28} />}
              title="가격 봉이 아직 없습니다"
              description={chart.blocked?.text}
            />
          )
          : <PriceChart chart={chart} bars={displayBars} minutes={tf} />}
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
    payload: { open: number; high: number; low: number; close: number; forming?: boolean }
  }
  const { open, high, low, close, forming } = payload
  const span = high - low
  const toY = (price: number): number => (span === 0 ? y + height / 2 : y + ((high - price) / span) * height)
  const up = close >= open
  const bodyTop = toY(Math.max(open, close))
  const bodyBottom = toY(Math.min(open, close))
  const cx = x + width / 2
  const bodyWidth = Math.max(1, width * 0.6)
  /**
   * **아직 안 닫힌 봉은 속을 비운다.** 확정 봉과 똑같이 그리면 아직 바뀔 값을
   * 사람이 확정으로 읽는다 (사용자 지시 2026-09-29 「모양이 변하더라고」).
   */
  return (
    <g className={`${up ? styles.up : styles.down} ${forming ? styles.forming : ''}`}>
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

function PriceChart(
  { chart, bars, minutes }: { chart: ChartSeries; bars: DisplayBar[]; minutes: number },
) {
  /**
   * **차트를 끌어서 좌우로 민다** (사용자 지적 2026-09-29 「차트에서 스크롤이 안먹더라」).
   *
   * 실측하니 세로 스크롤은 정상이었다 — 차트 위에서 휠을 굴리면 페이지가 0→600 으로
   * 내려갔다. 없는 것은 **좌우 이동**이었다. 구간 띠의 손잡이를 정확히 집어야만
   * 구간을 바꿀 수 있었고, 그림을 그냥 밀어 보는 길이 없었다.
   *
   * ## 휠은 안 건드린다
   *
   * 휠로 좌우를 밀면 차트 위에서 페이지가 안 내려간다 — 사용자가 말한 그 문제를
   * 우리가 만드는 셈이다. 그래서 **끄는 것(드래그)만** 좌우 이동에 쓴다.
   */
  const barCount = bars.length
  /**
   * **창은 그리는 봉 기준이다.**
   *
   * 실측 2026-09-30: 서버가 준 창(1분봉 420개 기준)을 그대로 쓰다가 5분봉으로 바꾸니
   * 봉이 **0개**로 나왔다 — 묶으면 봉 수가 1/5 이 되는데 창은 300번대를 가리키고 있어
   * 범위 밖이었다. 창은 지금 그리는 봉의 개수로 다시 잡아야 한다.
   */
  const serverWindow = useMemo(() => defaultWindow(bars, 0), [bars])
  /**
   * **첫 렌더부터 창을 들고 시작한다.**
   *
   * 효과(`useEffect`)로 나중에 넣으면 그 사이 한 번은 전체가 그려지고, recharts 는
   * 그때 잡은 범위를 그대로 쓴다 — 실측 2026-09-29: 구간 띠가 서 있는데도 봉 180개가
   * 전부 그려졌다(180→180). 이름을 `view` 로 둔 것은 전역 `window` 를 가리지 않으려는 것이다.
   */
  const [view, setView] = useState<{ startIndex: number; endIndex: number } | null>(() => serverWindow)
  /** 봉 단위를 바꾸면 창을 새로 잡는다 — 개수가 통째로 달라지기 때문 */
  const lastCount = useRef(barCount)
  useEffect(() => {
    if (lastCount.current === barCount) return
    lastCount.current = barCount
    setView(serverWindow)
  }, [barCount, serverWindow])

  /**
   * 한 프레임에 한 번만 다시 그린다. 휠은 초당 수십 번 오고, 매번 상태를 고치면
   * 봉 수백 개짜리 차트가 그만큼 다시 그려진다 (실측 전례: 화면이 먹통에 가까워졌다).
   */
  const frame = useRef<number | null>(null)
  const pending = useRef<{ startIndex: number; endIndex: number } | null>(null)
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current) }, [])
  const queueView = (next: { startIndex: number; endIndex: number }): void => {
    pending.current = next
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (pending.current) setView(pending.current)
    })
  }

  // 새 봉이 들어오면 따라간다 — 단, 사용자가 줌한 뒤에는 그 폭을 지킨다
  useEffect(() => {
    if (!serverWindow) { setView(null); return }
    setView((prev) => {
      if (!prev) return serverWindow
      // 폭은 사용자 것, 오른쪽 끝은 새 봉을 따라간다. 봉 수 안으로 조인다
      const span = Math.min(prev.endIndex - prev.startIndex, Math.max(0, barCount - 1))
      const end = serverWindow.endIndex
      return { startIndex: Math.max(0, end - span), endIndex: end }
    })
  }, [serverWindow, barCount])

  /**
   * **휠로 시간축을 줌한다** — HTS 관례다 (사용자 지시 2026-09-29
   * 「차트 스크롤을 마우스 휠로 할 수 있어야 한다는 말이었어」).
   *
   * 차트 위에서는 페이지가 아니라 차트가 움직인다. 차트 **밖**에서는 그대로 페이지가
   * 내려간다 — `preventDefault` 를 이 상자 안에서만 부른다.
   *
   * 한 프레임에 한 번만 반영한다. 휠은 초당 수십 번 오고, 매번 다시 그리면 무거워진다
   * (실측 전례: 미는 동안 화면이 먹통에 가까워졌다).
   */
  const onWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    if (!view || barCount === 0) return
    e.preventDefault()
    const box = e.currentTarget.getBoundingClientRect()
    // 커서가 창의 어디쯤인가. 그 자리 봉이 제자리에 남는다
    const at = box.width > 0 ? (e.clientX - box.left) / box.width : 0.5
    queueView(zoomWindow(view, barCount, at, e.deltaY > 0 ? -1 : 1))
  }

  /**
   * **끌어서 미는 기능은 없다.** 넣었다가 뺐다 — 누를 때마다 포인터를 붙잡아
   * 화면이 먹통에 가까워졌다(2026-09-29). 좌우로 보는 길은 휠과 구간 띠가 한다.
   */

  /**
   * **그릴 것이 있을 때만 불러온다.** 현황을 처음 여는 비용에 차트 묶음을 얹지 않는다 —
   * 봉이 0건인 날에는 이 코드가 아예 안 내려간다.
   */
  /**
   * 그리는 줄은 봉이 바뀔 때만 다시 만든다. 렌더마다 새로 만들면 미는 동안
   * 수백 개 객체를 초당 수십 번 새로 짓는다(위 프레임 묶기와 같은 이유).
   *
   * **훅은 이른 반환(`if (!R) return`)보다 위에 둔다.** 아래에 두면 첫 렌더에서는
   * 안 불리고 recharts 가 붙은 뒤에만 불려, 훅 수가 렌더마다 달라져 그림이 통째로 죽는다
   * (실측 2026-09-29: 차트가 스켈레톤에서 안 넘어갔다).
   */
  const rows = useMemo(() => bars.map((b) => ({
    at: b.at,
    label: seoulTimeText(b.at),
    open: b.open, high: b.high, low: b.low, close: b.close,
    band: [b.low, b.high] as [number, number],
    /** 아직 안 닫힌 봉인가. 그리는 자리가 이 값으로 속을 비운다 */
    forming: isForming(b),
  })), [bars])

  const [R, setR] = useState<Recharts | null>(null)
  useEffect(() => {
    let alive = true
    void import('recharts').then((mod) => { if (alive) setR(mod) })
    return () => { alive = false }
  }, [])

  if (!R) return <div className={styles.loadingChart}><SkelCard lines={4} /></div>

  const marks = chart.marks

  return (
    <div className={styles.chartWrap}>
      <div className={styles.chartBox} onWheel={onWheel}>
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
            **날이 바뀌는 자리에 선을 긋는다.** 없으면 어제 15:34 다음 칸이 오늘 09:03 이
            되어 밤새 가격이 안 움직인 것처럼 읽힌다 — 실제로는 열일곱 시간이 비어 있다
            (사용자 지적 2026-09-29).

            선은 **회색이다.** 빨강·파랑은 이 그림에서 롱·숏이라 같은 색을 쓰면
            경계가 판단으로 읽힌다.
          */}
          {chart.dayBreaks.map((d) => (
            <R.ReferenceLine
              key={d.at}
              x={seoulTimeText(d.at)}
              stroke="var(--text-faint)"
              strokeDasharray="4 4"
              label={{ value: d.dateLabel, position: 'insideTopLeft', fontSize: 11, fill: 'var(--text-muted)' }}
            />
          ))}
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
          {/*
            **구간 띠.** 처음에는 오늘만 그리고, 띠를 넓히면 어제까지 나온다 —
            되돌릴 길이 없는 창은 갇히는 것이다.

            색은 표식과 달리 **테두리뿐**이다. 신호·판단 표식과 같은 무게로 칠하면
            어느 것이 우리가 말한 것인지 그림에서 안 갈린다.
          */}
          {view && (
            <R.Brush
              dataKey="label"
              height={22}
              travellerWidth={8}
              startIndex={view.startIndex}
              endIndex={view.endIndex}
              onChange={(r: { startIndex?: number; endIndex?: number }) => {
                // 띠를 끌어도 같은 창을 쓴다 — 두 길이 서로 다른 창을 들면 화면이 튄다
                if (r.startIndex === undefined || r.endIndex === undefined) return
                setView({ startIndex: r.startIndex, endIndex: r.endIndex })
              }}
              stroke="var(--text-faint)"
              fill="var(--surface-bg)"
            />
          )}
        </R.ComposedChart>
      </R.ResponsiveContainer>
      </div>
    </div>
  )
}
