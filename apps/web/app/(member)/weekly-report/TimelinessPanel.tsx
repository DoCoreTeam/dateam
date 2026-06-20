'use client'

import { Clock } from 'lucide-react'
import { TIMELINESS_COLORS, TIMELINESS_KEYS } from '@/lib/tokens/status-colors'
import { formatKst, formatDelay, type MemberTimeliness } from '@/lib/weekly-report/timeliness'

interface Props {
  members: MemberTimeliness[]
}

function Badge({ m }: { m: MemberTimeliness }) {
  const c = TIMELINESS_COLORS[m.status]
  const tip =
    `최초 ${formatKst(m.firstAt)} · 최종 ${formatKst(m.lastAt)} · 취합 ${formatKst(m.confirmedAt)}` +
    (m.delayMinutes > 0 ? ` · 지연 ${formatDelay(m.delayMinutes)}` : '')
  return (
    <span
      title={tip}
      style={{
        fontSize: 'var(--fs-2xs)', fontWeight: 700, color: c.color,
        background: c.bg, border: `var(--hairline) solid ${c.border}`,
        padding: '0.1rem 0.4rem', borderRadius: 'var(--radius)', whiteSpace: 'nowrap',
      }}
    >
      {c.label}{m.delayMinutes > 0 ? ` · ${formatDelay(m.delayMinutes)}` : ''}
    </span>
  )
}

/** 부서 멤버별 주간보고 적시성(작성시각·지연) 패널. 표시 SSOT = lib/weekly-report/timeliness. */
export default function TimelinessPanel({ members }: Props) {
  if (members.length === 0) return null

  // 상태별 카운트 요약
  const counts = members.reduce<Record<string, number>>((acc, m) => {
    acc[m.status] = (acc[m.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div style={{ border: 'var(--border-w-2) solid var(--border-color)', borderRadius: 'var(--radius)', padding: 'var(--space-4)', marginBottom: 'var(--space-3)', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
        <Clock size={14} color="var(--brand)" />
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text)' }}>작성 적시성</span>
        <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          {TIMELINESS_KEYS.filter((k) => counts[k]).map((k) => (
            <span key={k} style={{ fontSize: 'var(--fs-2xs)', color: TIMELINESS_COLORS[k].color, fontWeight: 700 }}>
              {TIMELINESS_COLORS[k].label} {counts[k]}
            </span>
          ))}
        </span>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {members.map((m) => (
          <li key={m.userId} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', minHeight: 28 }}>
            <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
              <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-faint)' }}>{formatKst(m.lastAt)}</span>
              <Badge m={m} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
