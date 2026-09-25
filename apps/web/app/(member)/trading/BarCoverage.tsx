'use client'

// 수집 상태 — **모였나 빠졌나를 날마다 한 줄로**
//
// 1-A 가 끝났다는 기준이 「5거래일 결측 없는 수집」이다. 그 판정을 사람이 눈으로
// 세게 만들려면 날마다 「있어야 할 봉 / 있는 봉」이 그대로 보여야 한다.
// 「수집 중」 같은 말로 덮으면 빠진 날이 안 보이고, 안 보이는 결측은 없는 것이 된다.
//
// 목록 표준(ListSurface)을 쓴다. 검색·정렬이 붙을 자리는 아니지만, 표를 직접 짜면
// 모바일 카드 변환과 빈 상태가 이 화면에서만 달라진다.

import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { isDayComplete, missingCount, type DayCoverage } from '@/lib/trading/overview-shape'

const COLUMNS: ColumnDef<DayCoverage>[] = [
  { key: 'tradeDate', header: '거래일', primary: true, cell: (d) => d.tradeDate },
  {
    key: 'expected', header: '있어야 할 봉', align: 'right',
    cell: (d) => (d.unknown ? '—' : d.expected.toLocaleString('ko-KR')),
  },
  {
    key: 'actual', header: '모은 봉', align: 'right',
    cell: (d) => (d.unknown ? '—' : d.actual.toLocaleString('ko-KR')),
  },
  {
    key: 'missing', header: '빠진 봉', align: 'right',
    cell: (d) => {
      if (d.unknown) return <span style={{ color: 'var(--text-muted)' }}>세션 정보 없음</span>
      if (isDayComplete(d)) return <span style={{ color: 'var(--text-muted)' }}>없음</span>
      // 빠진 것만 붉게. 0 을 붉게 칠하면 붉은색이 아무 뜻도 없어진다
      return <span style={{ color: 'var(--nb-danger)' }}>{missingCount(d).toLocaleString('ko-KR')}</span>
    },
  },
]

export default function BarCoverage({ days }: { days: readonly DayCoverage[] }) {
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-3)' }}>
        수집 상태
      </h2>
      <ListSurface
        rows={[...days]}
        columns={COLUMNS}
        query={STATIC_LIST_QUERY}
        rowKey={(d) => d.tradeDate}
        empty={{ title: '아직 모은 봉이 없습니다', description: '크론이 돌기 시작하면 날마다 한 줄씩 쌓입니다' }}
      />
    </section>
  )
}
