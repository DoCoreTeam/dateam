'use client'

// 변경 이력 — 이 문서에 누가 언제 무엇을 했나 (P0132 I12a)
//
// **감사 기록을 읽기만 한다.** 쓰는 길은 없다 — 고칠 수 있는 기록은 기록이 아니다.
// 기존 창구(/api/crm/audit)를 대상 하나로 좁혀 부른다. 새 창구를 열면 워크스페이스 걸름을
// 그 창구가 또 지켜야 한다.
//
// 견적서와 계약서가 같은 부품을 쓴다. 문장은 audit-view 가 만든다 — 화면이 action 을
// 따로 번역하면 기록 화면과 이 패널이 같은 일을 다른 말로 적는다.

import { useCallback, useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { RecordPanel } from '@/components/ui/crm/RecordLayout'
import { readResponse, describeFetchFailure } from '@/lib/crm/api/read-error'
import { formatKstDateTimeExact } from '@/lib/datetime/kst'
import { failedTo, progress } from '@/lib/terms'
import { DOC_HISTORY } from '@/lib/terms/contract-doc'
import styles from './doc.module.css'

interface Entry {
  id: string
  summary: string
  actorName: string
  createdAt: string
  changes: { field: string; from: string; to: string }[]
}

interface Props {
  /** 감사 기록의 대상 종류 — 견적은 'quote', 계약서는 'contract' */
  targetType: 'quote' | 'contract'
  targetId: string
  /** 바깥에서 미는 「다시 읽어라」. 이 화면에서 무엇을 하면 기록이 하나 늘어난다 */
  reloadKey?: number
}

const PAGE = 20

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'denied' } | { kind: 'ok' }

export default function DocHistoryPanel({ targetType, targetId, reloadKey }: Props) {
  const [items, setItems] = useState<Entry[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [state, setState] = useState<Load>({ kind: 'loading' })
  const [more, setMore] = useState(false)

  const fetchPage = useCallback(async (after: string | null): Promise<{ items: Entry[]; nextCursor: string | null } | Load> => {
    const sp = new URLSearchParams({ targetType, targetId, limit: String(PAGE) })
    if (after) sp.set('cursor', after)
    try {
      const res = await fetch(`/api/crm/audit?${sp}`)
      const out = await readResponse(res, failedTo(DOC_HISTORY.title, '불러오지'))
      // 권한 없음은 오류와 다르다 — 다시 눌러도 같고, 할 일은 요청하는 것이다
      if (out.status === 403) return { kind: 'denied' }
      if (!out.ok) return { kind: 'error', message: out.message ?? failedTo(DOC_HISTORY.title, '불러오지') }
      const body = out.body as { items?: Entry[]; nextCursor?: string | null }
      return { items: body.items ?? [], nextCursor: body.nextCursor ?? null }
    } catch {
      return { kind: 'error', message: describeFetchFailure(DOC_HISTORY.title) }
    }
  }, [targetType, targetId])

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    const page = await fetchPage(null)
    if ('kind' in page) { setState(page); return }
    setItems(page.items)
    setCursor(page.nextCursor)
    setState({ kind: 'ok' })
  }, [fetchPage])

  useEffect(() => { void load() }, [load, reloadKey])

  const loadMore = useCallback(async () => {
    if (!cursor || more) return
    setMore(true)
    const page = await fetchPage(cursor)
    setMore(false)
    if ('kind' in page) { setState(page); return }
    setItems((prev) => [...prev, ...page.items])
    setCursor(page.nextCursor)
  }, [cursor, more, fetchPage])

  return (
    <RecordPanel title={DOC_HISTORY.title}>
      {state.kind === 'loading' && <AXDotLoader />}
      {state.kind === 'error' && <ErrorState message={state.message} onRetry={() => void load()} />}
      {state.kind === 'denied' && <EmptyState icon={<Lock size={20} aria-hidden />} title={DOC_HISTORY.denied} />}
      {state.kind === 'ok' && items.length === 0 && (
        <EmptyState title={DOC_HISTORY.empty} description={DOC_HISTORY.emptyNext} />
      )}
      {state.kind === 'ok' && items.length > 0 && (
        <>
          <ol className={styles.history}>
            {items.map((e) => (
              <li key={e.id} className={styles.historyItem}>
                <div className={styles.historyHead}>
                  <span className={styles.historySummary}>{e.summary}</span>
                  <time className={styles.historyWhen} dateTime={e.createdAt}>{formatKstDateTimeExact(e.createdAt)}</time>
                </div>
                <span className={styles.historyWho}>{e.actorName}</span>
                {e.changes.length > 0 && (
                  <ul className={styles.historyChanges}>
                    {e.changes.map((c, i) => (
                      <li key={`${c.field}-${i}`}>
                        {/* 앞 값이 없는 기록(버전 번호, 메모)은 화살표를 안 그린다 — 「(없음) → 버전 3」은 지운 것처럼 읽힌다 */}
                        {c.from === '' ? `${c.field}: ${c.to}` : `${c.field}: ${c.from} → ${c.to}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
          {cursor && (
            <NbButton variant="ghost" disabled={more} onClick={() => void loadMore()}>
              {more ? progress(DOC_HISTORY.more) : DOC_HISTORY.more}
            </NbButton>
          )}
        </>
      )}
    </RecordPanel>
  )
}
