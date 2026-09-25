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
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { GATE_STATUS_LABEL, GATE_STATUS_COLOR } from '@/lib/trading/gate/labels'
import type { CriterionResult } from '@/lib/trading/overview-shape'

const COLUMNS: ColumnDef<CriterionResult>[] = [
  { key: 'label', header: '항목', primary: true, cell: (c) => c.label },
  {
    key: 'status', header: '상태',
    cell: (c) => <span style={{ color: GATE_STATUS_COLOR[c.status] }}>{GATE_STATUS_LABEL[c.status]}</span>,
  },
  { key: 'detail', header: '내용', cell: (c) => c.detail },
]

export interface BacktestPanelProps {
  criteria: readonly CriterionResult[]
  passed: boolean
  failedCount: number
  insufficientCount: number
}

export default function BacktestPanel(props: BacktestPanelProps) {
  const headline = props.passed
    ? '관문을 통과했습니다'
    : props.failedCount > 0
      ? `${props.failedCount}개 항목이 미달입니다`
      : '아직 잴 수 없습니다. 표본이 더 모여야 합니다'

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        검증 관문
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-1)' }}>
        {headline}
      </p>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        여덟 줄을 전부 넘어야 알림 단계로 넘어갑니다. 「아직 못 잼」은 나쁜 것이 아니라 표본이 모자란 것입니다
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
