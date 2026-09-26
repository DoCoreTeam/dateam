'use client'

// AI 운영자 — **무엇을 봤고 무엇을 할 수 있나**
//
// 개입 수준을 항목마다 보여 주는 이유: 하나로 두면 안전한 일 하나를 맡기려고
// 위험한 일까지 열게 된다. 자동이 기본인 항목이 있으면 그 사실을 먼저 말한다 —
// 아무도 안 고른 값으로 AI 가 일하는 것은 「하기로 정한 것」이 아니다.

import { useState, useTransition } from 'react'
import { Moon, MoonStar } from 'lucide-react'
import ListSurface from '@/components/ui/list/ListSurface'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { CHECK_STATUS_LABEL } from '@/lib/trading/operator-labels'
import type { OperatorSummary, HealthRow } from '@/lib/trading/overview-shape'
import { setNightSignalEnabled } from './actions'

const COLUMNS: ColumnDef<HealthRow>[] = [
  { key: 'checkId', header: '점검', primary: true, cell: (r) => r.checkId },
  { key: 'status', header: '상태', cell: (r) => CHECK_STATUS_LABEL[r.status] ?? r.status },
  { key: 'userMessage', header: '내용', cell: (r) => r.userMessage },
  { key: 'reason', header: '근거', cell: (r) => r.reason },
]

export default function OperatorPanel({ operator }: { operator: OperatorSummary }) {
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function toggleNight(next: boolean) {
    startTransition(async () => {
      const r = await setNightSignalEnabled(next)
      setMessage(r.userMessage)
    })
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        AI 운영자
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        {operator.enabled
          ? `손볼 것 ${operator.attention}건`
          : '꺼져 있습니다. 점검과 브리핑이 돌지 않습니다'}
      </p>

      {operator.autoByDefault && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-2)' }}>
          기본값이 자동인 항목이 있습니다. 아무도 고르지 않은 값으로 AI 가 일합니다
        </p>
      )}
      {operator.levelsOutOfSync && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-2)' }}>
          설정에 있는 개입 항목과 화면에 그리는 항목 수가 다릅니다. 안 그린 항목은 고칠 수 없습니다
        </p>
      )}

      <dl style={{ display: 'grid', gap: 'var(--space-2)', margin: 0, marginBottom: 'var(--space-4)' }}>
        {operator.levels.map((l) => (
          <div key={l.key} style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
            <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{l.item}</dt>
            <dd style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text)' }}>{l.label}</dd>
          </div>
        ))}
      </dl>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
        <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{operator.night.hint}</span>
        {operator.night.enabled ? (
          <button type="button" className="btn btn-sm" disabled={pending} onClick={() => toggleNight(false)}>
            <Moon size={14} /> 야간 신호 끄기
          </button>
        ) : (
          <button
            type="button" className="btn btn-sm"
            disabled={pending || !operator.night.canEnable}
            title={operator.night.canEnable ? undefined : operator.night.hint}
            onClick={() => toggleNight(true)}
          >
            <MoonStar size={14} /> 야간 신호 켜기
          </button>
        )}
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-3)' }}>
          {message}
        </p>
      )}

      <ListSurface
        rows={[...operator.checks]}
        columns={COLUMNS}
        query={STATIC_LIST_QUERY}
        rowKey={(r) => r.checkId}
        empty={{
          title: '오늘 점검 기록이 없습니다',
          description: 'AI 운영자를 켜면 매분 점검하고 하루 한 번 브리핑합니다',
        }}
      />
    </section>
  )
}
