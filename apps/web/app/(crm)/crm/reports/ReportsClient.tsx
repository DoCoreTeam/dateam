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

  return (
    <div className={styles.wrap}>
      {items.map((p) => (
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
        </section>
      ))}
    </div>
  )
}
