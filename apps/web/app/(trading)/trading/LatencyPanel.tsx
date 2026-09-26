'use client'

// 지연 — **어디가 늦은지를 나눠 본다** (§14.2)
//
// 「신호에서 체결까지 4분」만 알면 고칠 곳을 못 찾는다. 서버가 늦은 것과
// 사람이 화면을 늦게 본 것과 보고도 망설인 것과 주문이 안 채워진 것은 고치는 방법이 다르다.
//
// 못 잰 건수를 같이 보여 준다. 안 보여 주면 표본 두 건으로 낸 중앙값이
// 스무 건으로 낸 값과 화면에서 똑같아 보인다.

import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import type { LatencyRow } from '@/lib/trading/overview-shape'

function seconds(value: number | null): string {
  if (value === null) return '못 잼'
  return `${value.toFixed(1)}초`
}

const COLUMNS: ColumnDef<LatencyRow>[] = [
  { key: 'label', header: '구간', primary: true, cell: (r) => r.label },
  { key: 'median', header: '중앙값', align: 'right', cell: (r) => seconds(r.medianSeconds) },
  { key: 'p90', header: '90%', align: 'right', cell: (r) => seconds(r.p90Seconds) },
  { key: 'p95', header: '95%', align: 'right', cell: (r) => seconds(r.p95Seconds) },
  {
    key: 'measured', header: '잰 건수', align: 'right',
    cell: (r) => (r.unmeasured > 0 ? `${r.measured}건 · 못 잼 ${r.unmeasured}건` : `${r.measured}건`),
  },
]

export default function LatencyPanel({ rows }: { rows: readonly LatencyRow[] }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        지연
      </h2>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        결과가 정해진 신호만 셉니다. 시각이 하나라도 비면 그 구간은 못 잰 것으로 둡니다
      </p>
      <ListSurface
        rows={[...rows]}
        columns={COLUMNS}
        query={STATIC_LIST_QUERY}
        rowKey={(r) => r.segment}
        empty={{
          title: '아직 잴 것이 없습니다',
          description: '신호가 나가고 결과가 정해져야 구간이 잡힙니다',
        }}
      />
    </section>
  )
}
