'use client'

// 지식 — **지금 시점에 알 수 있는 것만 보인다**
//
// 목록을 갈래마다 따로 두지 않는다. 표가 다섯 개면 사람이 다섯 번 훑어야 하고,
// 실제로 궁금한 것은 「최근에 무엇이 쌓였나」 하나다.
//
// 설정 변경 제안은 여기서 사람이 받아들이거나 물린다. AI 는 올리기만 한다.

import { useState, useTransition } from 'react'
import ListSurface from '@/components/ui/list/ListSurface'
import RowActions from '@/components/ui/list/RowActions'
import type { ColumnDef } from '@/components/ui/list/types'
import { STATIC_LIST_QUERY } from '@/lib/ui/static-list-query'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { KNOWLEDGE_KIND_LABEL } from '@/lib/trading/knowledge-labels'
import type { KnowledgeRow, KnowledgeProgress } from '@/lib/trading/overview-shape'
import { decideSpecCandidate, addTradingSource } from './actions'

interface Props {
  rows: readonly KnowledgeRow[]
  /** 마지막 실행이 지식으로 무엇을 했나. 없으면 「안 일어난다」와 구별이 안 된다 */
  progress: KnowledgeProgress | null
}

export default function KnowledgePanel({ rows, progress }: Props) {
  const [message, setMessage] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [pending, startTransition] = useTransition()

  function decide(row: KnowledgeRow, accept: boolean) {
    startTransition(async () => {
      const r = await decideSpecCandidate(row.id, accept)
      setMessage(r.userMessage ?? (accept ? '받아들였습니다' : '물렸습니다'))
    })
  }

  function addSource() {
    startTransition(async () => {
      const r = await addTradingSource(text)
      setMessage(r.userMessage ?? '자료를 넣었습니다')
      if (r.ok) setText('')
    })
  }

  const columns: ColumnDef<KnowledgeRow>[] = [
    {
      key: 'availableAt', header: '쌓인 때', primary: true,
      cell: (r) => formatKstDateTimeExact(r.availableAt),
    },
    { key: 'kind', header: '갈래', cell: (r) => KNOWLEDGE_KIND_LABEL[r.kind] },
    { key: 'title', header: '제목', cell: (r) => r.title },
    { key: 'detail', header: '내용', cell: (r) => r.detail },
    {
      key: 'actions', header: '결정', noLabel: true,
      cell: (r) => {
        if (!r.needsDecision) return null
        return (
          <RowActions inline={2} subject={r.title}>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide(r, true)}>
              받아들임
            </button>
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => decide(r, false)}>
              물림
            </button>
          </RowActions>
        )
      },
    },
  ]

  return (
    <section className="card">
      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text)', margin: 0, marginBottom: 'var(--space-2)' }}>
        지식
      </h2>
      <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
        지금 시점에 알 수 있는 것만 보입니다. 설정 변경은 사람이 받아들여야 적용되고, 적용은 다음 거래일부터입니다
      </p>

      {progress && (
        <p style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0, marginBottom: 'var(--space-3)' }}>
          마지막 실행: {progress.label} · {progress.outcome}
        </p>
      )}

      {/* 격자로 둔다. flexWrap 을 쓰면 액션 칸 가드가 이 줄을 액션 칸으로 읽는다 */}
      <div
        style={{
          display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto',
          gap: 'var(--space-2)', alignItems: 'start', marginBottom: 'var(--space-3)',
        }}
      >
        <textarea
          className="input-field"
          style={{ minHeight: '3rem' }}
          placeholder="자료를 붙여 넣으면 분석합니다"
          aria-label="자료"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="btn btn-sm" disabled={pending || text.trim() === ''} onClick={addSource}>
          자료 넣기
        </button>
      </div>

      {message && (
        <p role="status" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text)', margin: 0, marginBottom: 'var(--space-3)' }}>
          {message}
        </p>
      )}

      <ListSurface
        rows={[...rows]}
        columns={columns}
        query={STATIC_LIST_QUERY}
        rowKey={(r) => `${r.kind}:${r.id}`}
        empty={{
          title: '아직 쌓인 것이 없습니다',
          description: '자료를 넣거나 거래가 쌓이면 여기에 옵니다',
        }}
      />
    </section>
  )
}
