'use client'

// 판단 기록 — **무엇을 보고 어느 쪽으로 기울었나**
//
// 신호가 아니다. 1-A 는 알림을 안 보내고 기록만 한다(M3) — 보정이 없으면 원점수는
// 확률이 아니라 그냥 숫자이기 때문이다. 그래서 여기에는 「따라가기」 같은 조작이 없다.
// 못 하는 동작의 단추를 그리면 사용자는 눌러 보고 나서야 없다는 것을 안다.

import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { JUDGE_LABEL, JUDGMENT_STATUS_LABEL, leaningLabel } from '@/lib/trading/judgment-labels'
import type { JudgmentRow } from '@/lib/trading/overview-shape'

const COLUMNS: ColumnDef<JudgmentRow>[] = [
  {
    key: 'barCloseAt', header: '봉 마감', primary: true,
    cell: (r) => formatKstDateTimeExact(r.barCloseAt),
  },
  { key: 'judge', header: '판단기', cell: (r) => JUDGE_LABEL[r.judge] ?? r.judge },
  { key: 'triggerId', header: '진입 조건', cell: (r) => r.triggerId ?? '—' },
  { key: 'leaning', header: '기운 쪽', cell: (r) => leaningLabel(r.rawScore) },
  {
    key: 'status', header: '상태',
    cell: (r) => `${JUDGMENT_STATUS_LABEL[r.status] ?? r.status}${r.abstainReason ? ` · ${r.abstainReason}` : ''}`,
  },
]

export default function JudgmentList({ rows }: { rows: readonly JudgmentRow[] }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        판단 기록
      </h2>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        보정 전 원점수입니다. 검증 단계를 지나기 전에는 이 값으로 신호를 내지 않습니다
      </p>
      <ListSurface
        rows={[...rows]}
        columns={COLUMNS}
        query={STATIC_LIST_QUERY}
        rowKey={(r) => r.id}
        empty={{
          title: '아직 기록된 판단이 없습니다',
          description: '진입 조건이 걸린 봉에서만 기록됩니다',
        }}
      />
    </section>
  )
}
