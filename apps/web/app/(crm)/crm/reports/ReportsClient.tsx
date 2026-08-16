'use client'

// 리포트 v1 (dacrm T1-12)
//
// 이 화면이 하지 말아야 할 것부터 정한다.
//   · 통화를 합치지 않는다 — 원과 달러를 더한 숫자는 아무 뜻도 없다
//   · 금액 미정을 0원으로 세지 않는다 — 대신 몇 건인지 말한다
//   · 끝난 딜이 없을 때 "성사율 0%"라고 쓰지 않는다 — 그건 "다 실패했다"로 읽힌다
//
// 리포트의 숫자는 틀려도 화면이 안 깨진다. 그래서 **무엇을 세지 않았는지**를
// 숫자 옆에 같이 써야 사람이 그 숫자를 믿을지 말지 정할 수 있다.

import { useCallback, useEffect, useState } from 'react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { formatAmount } from '../deals/amount'
import styles from './reports.module.css'

interface CurrencySum { currency: string; totalMinor: string }

/** 어디서 막히나 — 표본이 얇으면 숫자 대신 "모른다"가 온다 */
interface StageDuration {
  stageId: string
  stageName: string
  samples: number
  medianDays: number | null
  maxDays: number | null
  standing: number
  insufficient: boolean
}
/** 확률을 곱한 예상 매출 — 근거가 없으면 숫자를 내지 않는다 */
interface StageForecast {
  stageId: string
  stageName: string
  openCount: number
  pipeline: CurrencySum[]
  winRate: number | null
  sample: number
  weighted: CurrencySum[]
}
interface Forecast {
  pipelineId: string
  pipelineName: string
  stages: StageForecast[]
  weightedTotal: CurrencySum[]
  unknownTotal: CurrencySum[]
  unpriced: number
  summary: string
}
interface Velocity {
  pipelineId: string
  pipelineName: string
  stages: StageDuration[]
  summary: string
}
interface StageSum {
  stageId: string
  stageName: string
  count: number
  byCurrency: CurrencySum[]
  unpriced: number
}
interface PipelineReport {
  pipelineId: string
  pipelineName: string
  stages: StageSum[]
  openCount: number
  wonCount: number
  lostCount: number
  winRate: number | null
  byCurrency: CurrencySum[]
  unpriced: number
}

/**
 * 통화별로 줄을 나눠 쓴다 — 합치지 않는다는 사실이 화면에 보여야 한다.
 *
 * 건수가 0이면 "금액 미정"이 아니라 **그냥 없는 것**이다.
 * 0건 칸에 "금액 미정"이라고 쓰면 "딜은 있는데 금액을 안 정했다"로 읽힌다(실브라우저에서 잡았다).
 * 미정 건수는 바로 아래 줄이 이미 말하므로 여기서는 되풀이하지 않는다.
 */
function Money({ sums, count }: { sums: CurrencySum[]; count: number }) {
  if (count === 0) return <span className={styles.none}>—</span>
  if (sums.length === 0) return <span className={styles.none}>—</span>
  return (
    <span className={styles.money}>
      {sums.map((s) => (
        <span key={s.currency} className={styles.moneyLine}>
          {formatAmount(s.totalMinor, s.currency) ?? `${s.totalMinor} ${s.currency}`}
        </span>
      ))}
    </span>
  )
}

export default function ReportsClient() {
  const [items, setItems] = useState<PipelineReport[]>([])
  const [velocity, setVelocity] = useState<Velocity[]>([])
  const [forecast, setForecast] = useState<Forecast[]>([])
  /**
   * 안 쓰는 파이프라인을 펼쳐 볼지.
   *
   * **왜 접나**: 딜 0건인 파이프라인이 세로 블록을 통째로 차지하면
   * "0건 · 0건 · 모름"이 화면 대부분을 채우고, 정작 **있는 정보가 안 보인다**.
   * 지우지 않고 접는 이유는 지금 안 쓸 뿐 나중에 쓸 수 있기 때문이다.
   */
  const [showEmpty, setShowEmpty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/reports')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '리포트를 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
      setVelocity(body.velocity ?? [])
      setForecast(body.forecast ?? [])
    } catch {
      setError('리포트를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading && items.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  const empty = items.every((p) => p.openCount === 0 && p.wonCount === 0 && p.lostCount === 0)
  if (empty) {
    return (
      <EmptyState
        title="집계할 딜이 아직 없어요"
        description="딜이 쌓이면 단계별 금액과 성사율이 여기에 나타납니다."
        action={{ label: '딜 보러 가기', href: '/crm/deals' }}
      />
    )
  }

  // 전체가 빈 경우는 위에서 이미 EmptyState 로 끝났다. 여기는 "일부만 비었을 때"다
  const used = items.filter((p) => p.openCount + p.wonCount + p.lostCount > 0)
  const unused = items.filter((p) => p.openCount + p.wonCount + p.lostCount === 0)
  const shown = showEmpty ? [...used, ...unused] : used

  return (
    <div className={styles.wrap}>
      {shown.map((p) => (
        <section key={p.pipelineId} className={`card ${styles.card}`}>
          <div className={styles.head}>
            <h2 className={styles.title}>{p.pipelineName}</h2>
            {/* 성사율은 끝난 딜이 있을 때만 말한다 */}
            {p.winRate === null
              ? <NbBadge status="note">아직 끝난 딜 없음</NbBadge>
              : <NbBadge status={p.winRate >= 50 ? 'done' : 'doing'}>성사율 {p.winRate}%</NbBadge>}
          </div>

          <div className={styles.totals}>
            <div className={styles.total}>
              <span className={styles.totalLabel}>진행 중</span>
              <span className={styles.totalValue}>{p.openCount}건</span>
              <Money sums={p.byCurrency} count={p.openCount} />
              {p.unpriced > 0 && (
                <span className={styles.note}>이 중 {p.unpriced}건은 금액 미정이라 합계에서 빠졌어요</span>
              )}
            </div>
            <div className={styles.total}>
              <span className={styles.totalLabel}>성사</span>
              <span className={styles.totalValue}>{p.wonCount}건</span>
            </div>
            <div className={styles.total}>
              <span className={styles.totalLabel}>실패</span>
              <span className={styles.totalValue}>{p.lostCount}건</span>
            </div>
          </div>

          <ul className={styles.stages}>
            {p.stages.map((s) => (
              <li key={s.stageId} className={styles.stage}>
                <span className={styles.stageName}>{s.stageName}</span>
                <span className={styles.stageCount}>{s.count}건</span>
                <Money sums={s.byCurrency} count={s.count} />
                {s.unpriced > 0 && <span className={styles.note}>금액 미정 {s.unpriced}건</span>}
              </li>
            ))}
          </ul>

          {/*
            어디서 막히나.
            표본이 얇으면 숫자를 내지 않는다 — 딜 3건으로 "평균 12일"을 말하면
            사람은 그걸 사실로 읽고 없는 문제를 고치러 간다.
          */}
          {(() => {
            const v = velocity.find((x) => x.pipelineId === p.pipelineId)
            if (!v) return null
            return (
              <div className={styles.velocity}>
                <h3 className={styles.subTitle}>어디서 오래 머무나</h3>
                <p className={styles.summary}>{v.summary}</p>
                <ul className={styles.durations}>
                  {v.stages.map((d) => (
                    <li key={d.stageId} className={styles.duration}>
                      <span className={styles.stageName}>{d.stageName}</span>
                      {d.insufficient ? (
                        <span className={styles.note}>
                          아직 모름{d.samples > 0 ? ` (지나간 딜 ${d.samples}건)` : ''}
                        </span>
                      ) : (
                        <>
                          <span className={styles.stageCount}>보통 {d.medianDays}일</span>
                          <span className={styles.note}>가장 오래 {d.maxDays}일 · 표본 {d.samples}건</span>
                        </>
                      )}
                      {d.standing > 0 && <span className={styles.note}>지금 {d.standing}건 서 있음</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
          {/*
            얼마나 들어올까.
            파이프라인 총액을 그대로 답하면 거짓말이다 — 리드 10억과 계약 직전 10억은 다르다.
            그렇다고 관례적인 확률(20%·50%·80%)을 박아 넣으면 근거 없는 숫자로
            사람이 채용을 결정한다. 우리가 실제로 겪은 성사율만 쓰고, 모르면 모른다고 쓴다.
          */}
          {(() => {
            const f = forecast.find((x) => x.pipelineId === p.pipelineId)
            if (!f) return null
            return (
              <div className={styles.velocity}>
                <h3 className={styles.subTitle}>얼마나 들어올까</h3>
                <p className={styles.summary}>{f.summary}</p>

                {f.weightedTotal.length > 0 && (
                  <p className={styles.total}>
                    예상 {f.weightedTotal.map((c) => formatAmount(c.totalMinor, c.currency)).join(' · ')}
                  </p>
                )}

                {/* 근거가 부족해 못 센 금액을 숨기지 않는다 — 숨기면 합계가 조용히 작아진다 */}
                {f.unknownTotal.length > 0 && (
                  <p className={styles.note}>
                    근거가 부족한 단계에 {f.unknownTotal.map((c) => formatAmount(c.totalMinor, c.currency)).join(' · ')}가
                    걸려 있어요 (예상에 넣지 않았습니다)
                  </p>
                )}

                <ul className={styles.durations}>
                  {f.stages.map((d) => (
                    <li key={d.stageId} className={styles.duration}>
                      <span className={styles.stageName}>{d.stageName}</span>
                      {d.winRate === null ? (
                        <span className={styles.note}>
                          성사율 아직 모름{d.sample > 0 ? ` (끝난 딜 ${d.sample}건)` : ''}
                        </span>
                      ) : (
                        <>
                          <span className={styles.stageCount}>성사율 {Math.round(d.winRate * 100)}%</span>
                          <span className={styles.note}>
                            표본 {d.sample}건
                            {d.weighted.length > 0 && ` · 예상 ${d.weighted.map((c) => formatAmount(c.totalMinor, c.currency)).join(' · ')}`}
                          </span>
                        </>
                      )}
                      {d.openCount > 0 && <span className={styles.note}>지금 {d.openCount}건</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })()}
        </section>
      ))}
      {/* 접은 것을 숨기지 않는다 — 몇 개를 접었는지는 말한다 */}
      {!showEmpty && unused.length > 0 && (
        <button type="button" className={styles.showEmpty} onClick={() => setShowEmpty(true)}>
          아직 안 쓰는 영업 단계 {unused.length}개 보기
        </button>
      )}
    </div>
  )
}
