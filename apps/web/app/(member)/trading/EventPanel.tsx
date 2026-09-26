'use client'

// 이벤트 캘린더 — **등록한 것만 막는다** (§6.6 · SR-05)
//
// 금통위·FOMC·CPI 발표 앞뒤로는 새 신호를 내지 않는다. 그 몇 분 동안 가격이 움직이는
// 이유는 지표가 아니라 발표문이고, 우리 지표는 그것을 모른다.
//
// Release 1 은 사람이 넣는다. 자동 수집은 Release 2 다.
// **안 넣은 이벤트는 안 막힌다** — 그 사실을 화면이 말해야 관리자가 넣는다.

import { useState, useTransition } from 'react'
import { CalendarClock, Trash2 } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { addTradingEvent, removeTradingEvent } from './actions'

export interface EventPanelRow {
  id: string
  name: string
  occursAt: string
}

interface Props {
  rows: EventPanelRow[]
  beforeMinutes: number
  afterMinutes: number
}

export default function EventPanel({ rows, beforeMinutes, afterMinutes }: Props) {
  const [name, setName] = useState('')
  const [at, setAt] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function add() {
    startTransition(async () => {
      const result = await addTradingEvent(name, at)
      setMessage(result.ok ? null : result.userMessage)
      if (result.ok) { setName(''); setAt('') }
    })
  }

  function remove(id: string) {
    startTransition(async () => {
      const result = await removeTradingEvent(id)
      setMessage(result.ok ? null : result.userMessage)
    })
  }

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        <CalendarClock size={16} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        이벤트 캘린더
      </h2>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        등록한 이벤트의 {beforeMinutes}분 전부터 {afterMinutes}분 뒤까지 새 신호를 내지 않습니다.
        등록하지 않은 이벤트는 막히지 않습니다.
      </p>

      <div style={{ display: 'grid', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        <div>
          <label className="label" htmlFor="trading-event-name">이벤트 이름</label>
          <input
            id="trading-event-name"
            className="input-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="금통위"
          />
        </div>
        <div>
          <label className="label" htmlFor="trading-event-at">시각</label>
          <input
            id="trading-event-at"
            className="input-field"
            type="datetime-local"
            value={at}
            onChange={(e) => setAt(e.target.value)}
          />
        </div>
        <button type="button" className="btn" onClick={add} disabled={pending || name.trim() === '' || at === ''}>
          {pending ? '저장하는 중' : '이벤트 추가'}
        </button>
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-2)' }}>
          {message}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={<CalendarClock size={20} />}
          title="등록된 이벤트가 없습니다"
          description="금통위나 CPI 발표처럼 값이 크게 흔들리는 시각을 위에서 추가해 주세요"
        />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--space-1)' }}>
          {rows.map((row) => (
            <li
              key={row.id}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 'var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--text)',
              }}
            >
              <span>
                {row.name}
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  {formatKstDateTimeExact(row.occursAt)}
                </span>
              </span>
              <button
                type="button"
                className="btn-icon"
                onClick={() => remove(row.id)}
                disabled={pending}
                aria-label={`${row.name} 삭제`}
                title={`${row.name} 삭제`}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
