'use client'

// 검증 — **관문 여덟 줄이 지금 어디까지 왔나**
//
// 「통과」와 「미달」만 보여 주면, 표본이 모자라 아직 못 잰 항목이 나쁜 것으로 읽힌다.
// 그래서 세 상태를 그대로 그린다. 미달은 얼마나 모자란지를 함께 적는다 —
// 그것이 없으면 다음에 무엇을 할지 모른다.
//
// 여기에는 실행 단추가 없다. 백테스트를 돌리는 일은 되돌릴 수 있지만 오래 걸리고,
// 1-B 는 아직 표본을 모으는 중이다. 돌리는 길은 표본이 찬 뒤에 붙인다.

import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import styles from './BacktestPanel.module.css'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import Link from 'next/link'
import { GATE_STATUS_LABEL, GATE_STATUS_COLOR, GATE_HEADLINE_NOT_MEASURED, GATE_HELP, howHref } from '@/lib/trading/gate/labels'
import type { CriterionResult } from '@/lib/trading/overview-shape'
import type { GateEmptyReason } from '@/lib/trading/gate/empty-reason'

const COLUMNS: ColumnDef<CriterionResult>[] = [
  { key: 'label', header: '항목', primary: true, cell: (c) => c.label },
  {
    key: 'status', header: '상태',
    cell: (c) => <span style={{ color: GATE_STATUS_COLOR[c.status] }}>{GATE_STATUS_LABEL[c.status]}</span>,
  },
  {
    key: 'detail', header: '내용',
    /**
     * **못 잰 줄에는 할 일을 같이 적는다** (사용자 지적 2026-09-28
     * 「이것도 없다 그러고」 — 열 줄이 전부 「아직 못 잼」이고 할 일이 한 줄도 없었다).
     * 잰 줄에는 안 붙는다 — 늘 뜨는 안내는 안 읽힌다.
     */
    cell: (c) => (
      <span className={styles.detailCell}>
        <span>{c.detail}</span>
        {c.how && (() => {
          /* 가라고 말한 화면이 있으면 그 자리에서 갈 수 있어야 한다 — 주소는 배치에서 온다 */
          const href = howHref(c.how)
          return href
            ? <Link href={href} className={styles.how}>{c.how}</Link>
            : <span className={styles.how}>{c.how}</span>
        })()}
      </span>
    ),
  },
]

export interface BacktestPanelProps {
  criteria: readonly CriterionResult[]
  passed: boolean
  failedCount: number
  insufficientCount: number
  /**
   * 한 번도 안 돌았으면 왜인지. 돌았으면 null
   * (사용자 개입 2026-09-30 「검증쪽은 뭐가 다 없대 이상하네」)
   */
  empty: GateEmptyReason | null
}

export default function BacktestPanel(props: BacktestPanelProps) {
  /*
    **「모자라다」와 「안 돌았다」는 할 일이 다르다.**

    전에는 둘 다 「표본이 더 모여야 합니다」로 덮여 있었다. 앞의 것은 기다리면 되고
    뒤의 것은 기다려도 안 되는데, 화면이 같은 말을 하니 사람은 계속 기다린다
    (사용자 개입 2026-09-30 「검증쪽은 뭐가 다 없대 이상하네」).
  */
  const headline = props.empty
    ? props.empty.headline
    : props.passed
      ? '관문을 통과했습니다'
      : props.failedCount > 0
        ? `${props.failedCount}개 항목이 미달입니다`
        : GATE_HEADLINE_NOT_MEASURED

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        검증 관문
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-1)' }}>
        {headline}
      </p>
      {/* 지금 무엇을 가졌고 무엇이 있어야 도나. 셋을 세어서 적는다 */}
      {props.empty && (
        <div className={styles.empty}>
          <p className={styles.emptyFacts}>{props.empty.facts.join(' · ')}</p>
          <p className={styles.emptyNext}>{props.empty.next}</p>
        </div>
      )}
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        {GATE_HELP}
      </p>
      <ListSurface
        rows={[...props.criteria]}
        columns={COLUMNS}
        query={STATIC_LIST_QUERY}
        rowKey={(c) => c.id}
        empty={{
          title: '아직 검증을 돌리지 않았습니다',
          description: '봉이 쌓이면 여기에 관문 판정이 뜹니다',
        }}
      />
    </section>
  )
}
