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
import {
  JUDGE_LABEL, JUDGMENT_STATUS_LABEL, leaningLabel, judgmentIssue, failingStreak, streakLine,
} from '@/lib/trading/judgment-labels'
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
    /**
     * **기계 글자를 그대로 안 찍는다** (사용자 지적 2026-09-28 「정상 동작 하고 있는건지
     * 모르겠네」 — `call_failed:jev_http_403` 이 열여섯 줄 찍혀 있었다).
     * 못 알아본 표식은 버리지 않고 원문을 그대로 둔다.
     */
    cell: (r) => {
      const label = JUDGMENT_STATUS_LABEL[r.status] ?? r.status
      const issue = judgmentIssue(r.abstainReason)
      return issue ? `${label} · ${issue.text}` : label
    },
  },
]

export default function JudgmentList({ rows }: { rows: readonly JudgmentRow[] }) {
  /**
   * 같은 실패가 이어지면 **표 위에서 한 줄로** 말한다.
   * 안 세어 주면 사람이 스무 줄을 눈으로 세야 하고, 대개 안 센다.
   */
  const streak = failingStreak(rows)
  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        판단 기록
      </h2>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        보정 전 원점수입니다. 검증 단계를 지나기 전에는 이 값으로 신호를 내지 않습니다
      </p>
      {/* 잘 돌고 있으면 이 줄이 없다 — 늘 뜨는 경고는 안 읽힌다 */}
      {streak && (
        <p
          role="status"
          style={{
            fontSize: 'var(--fs-sm)', margin: 0, marginBottom: 'var(--space-3)',
            color: streak.issue.tone === 'blocked' ? 'var(--danger)' : 'var(--warning)',
            overflowWrap: 'anywhere',
          }}
        >
          {streakLine(streak)}
        </p>
      )}
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
