'use client'

// 신호 — **사람이 한 일을 우리에게 알리는 자리**
//
// 단추 셋은 전부 「내가 이렇게 했다」이고, 우리가 대신 하는 것은 하나도 없다(C1 · M1).
// 「지금 주문」 같은 단추를 하나 두면 그 단추는 언젠가 진짜로 주문한다.
//
// 지나간 신호에는 단추를 안 그린다. 남겨 두면 사람은 눌러도 되는 줄 알고,
// 눌렀는데 거절당하면 화면이 고장난 것으로 읽는다.

import { useEffect, useState, useTransition } from 'react'
import ListSurface from '@/components/ui/list/ListSurface'
import RowActions from '@/components/ui/list/RowActions'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { ACK_LABEL, type AckAction } from '@/lib/trading/signal/ack-policy'
import {
  DIRECTION_LABEL, signalResultLabel, formatIndexPrice, formatProbability,
} from '@/lib/trading/signal-labels'
import { isSignalActionable, type SignalRow } from '@/lib/trading/overview-shape'
import { recordSignalOpened, submitSignalAck } from './actions'

interface Props {
  rows: readonly SignalRow[]
  validMinutes: number
  /** 알림이 켜져 있나. 꺼져 있으면 왜 안 오는지를 화면이 말한다 */
  notifyEnabled: boolean
}

export default function SignalPanel({ rows, validMinutes, notifyEnabled }: Props) {
  const [message, setMessage] = useState<string | null>(null)
  const [stopText, setStopText] = useState<Record<string, string>>({})
  const [pending, startTransition] = useTransition()

  // 화면에 뜬 순간이 열람 시각이다. 아직 안 열린 것만 적는다
  const unopened = rows.filter((r) => !r.openedAt).map((r) => r.id).join(',')
  useEffect(() => {
    if (!unopened) return
    for (const id of unopened.split(',')) void recordSignalOpened(id)
  }, [unopened])

  function press(row: SignalRow, action: AckAction) {
    startTransition(async () => {
      const result = await submitSignalAck(row.id, action, stopText[row.id])
      setMessage(result.ok ? null : result.userMessage)
    })
  }

  const now = new Date()

  const columns: ColumnDef<SignalRow>[] = [
    {
      key: 'barCloseAt', header: '봉 마감', primary: true,
      cell: (r) => formatKstDateTimeExact(r.barCloseAt),
    },
    { key: 'direction', header: '방향', cell: (r) => DIRECTION_LABEL[r.direction] },
    {
      key: 'prices', header: '기준 · 손절 · 목표',
      cell: (r) => `${formatIndexPrice(r.referencePrice)} · ${formatIndexPrice(r.stopPrice)} · ${formatIndexPrice(r.targetPrice)}`,
    },
    { key: 'prob', header: '보정 확률', cell: (r) => formatProbability(r.calibratedProb) },
    {
      key: 'reportedStop', header: '사용자 입력 손절',
      cell: (r) => (r.userReportedStop === null ? '없음' : formatIndexPrice(r.userReportedStop)),
    },
    { key: 'result', header: '결과', cell: (r) => signalResultLabel(r.result) },
    {
      key: 'stop', header: '손절 알리기',
      cell: (r) => {
        if (!isSignalActionable(r, now, validMinutes)) return null
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--space-1)', alignItems: 'center' }}>
            <input
              className="input-field"
              style={{ width: '6rem' }}
              inputMode="decimal"
              aria-label="손절가"
              value={stopText[r.id] ?? ''}
              onChange={(e) => setStopText((prev) => ({ ...prev, [r.id]: e.target.value }))}
            />
            <button
              type="button" className="btn btn-sm" disabled={pending}
              onClick={() => press(r, 'stop_reported')}
            >
              {ACK_LABEL.stop_reported}
            </button>
          </span>
        )
      },
    },
    {
      key: 'actions', header: '확인', noLabel: true,
      cell: (r) => {
        if (!isSignalActionable(r, now, validMinutes)) return null
        return (
          <RowActions inline={2} subject={`${formatKstDateTimeExact(r.barCloseAt)} 신호`}>
            <button
              type="button" className="btn btn-sm" disabled={pending}
              onClick={() => press(r, 'ordered')}
            >
              {ACK_LABEL.ordered}
            </button>
            <button
              type="button" className="btn btn-sm" disabled={pending}
              onClick={() => press(r, 'skipped')}
            >
              {ACK_LABEL.skipped}
            </button>
          </RowActions>
        )
      },
    },
  ]

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        신호
      </h2>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        {notifyEnabled
          ? '주문은 직접 하시고 여기에 무엇을 하셨는지만 알려 주세요. 시스템은 주문하지 않습니다'
          : '알림이 꺼져 있습니다. 검증 관문을 지난 뒤에 켤 수 있고, 그때까지는 기록만 남습니다'}
      </p>
      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--nb-danger)', margin: 0, marginBottom: 'var(--space-3)' }}>
          {message}
        </p>
      )}
      <ListSurface
        rows={[...rows]}
        columns={columns}
        query={STATIC_LIST_QUERY}
        rowKey={(r) => r.id}
        empty={{
          title: '아직 나간 신호가 없습니다',
          description: '안전 게이트와 신호 규칙을 모두 지난 판단만 여기에 뜹니다',
        }}
      />
    </section>
  )
}
