'use client'

// 기록 — 누가 언제 무엇을 바꿨나 (dacrm)
//
// **이 화면이 답하는 것 하나**: "이 값 어디서 왔지?"
//
// AI 가 값을 채우는 시스템이라 이 질문은 언젠가 반드시 나온다.
// 그때 답할 수 없으면 사람은 CRM 의 모든 숫자를 의심하게 되고,
// 의심받는 데이터는 안 쓰는 데이터가 된다.
//
// 그래서 기본은 **전부 최근순**이고, 사람/AI 를 갈라 볼 수 있다 —
// "AI 가 뭘 했는지"가 가장 자주 묻는 질문이기 때문이다.

import { useCallback, useEffect, useState } from 'react'
import { History, Bot, User } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { TARGET_LABEL } from '@/lib/crm/services/audit-view'
import styles from './audit.module.css'

interface Change { field: string; from: string; to: string }
interface Entry {
  id: string
  actorType: string
  actorName: string
  action: string
  summary: string
  targetType: string
  targetId: string
  changes: Change[]
  createdAt: string
}

const WHO = [
  { id: 'all', label: '전부' },
  { id: 'HUMAN', label: '사람이 한 것' },
  { id: 'AI', label: 'AI가 한 것' },
] as const

/** 어디로 가면 그 대상을 볼 수 있나 — 없는 대상은 링크를 만들지 않는다 */
const HREF: Record<string, string> = {
  company: '/crm/companies', person: '/crm/people',
  deal: '/crm/deals', meeting: '/crm/meetings',
}

export default function AuditClient() {
  const [items, setItems] = useState<Entry[]>([])
  const [who, setWho] = useState<string>('all')
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextCursor: string | null, append: boolean) => {
    if (append) setMore(true)
    else setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ limit: '50' })
      if (who !== 'all') sp.set('actorType', who)
      if (nextCursor) sp.set('cursor', nextCursor)
      const res = await fetch(`/api/crm/audit?${sp}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '기록을 불러오지 못했습니다.'); return }
      setItems((cur) => (append ? [...cur, ...(body.items ?? [])] : (body.items ?? [])))
      setCursor(body.nextCursor ?? null)
    } catch {
      setError('기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
      setMore(false)
    }
  }, [who])

  useEffect(() => { void load(null, false) }, [load])

  if (loading && items.length === 0) return <AXDotLoader />
  if (error && items.length === 0) return <ErrorState message={error} onRetry={() => void load(null, false)} />

  return (
    <>
      <div className={styles.toolbar}>
        <SegmentedTabs
          tabs={WHO.map((w) => ({ id: w.id, label: w.label }))}
          ariaLabel="누가 한 것"
          activeId={who}
          onSelect={setWho}
        />
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="아직 기록이 없어요"
          description="회사·인물·딜을 만들거나 바꾸면 누가 언제 무엇을 했는지 여기 남습니다."
          icon={<History size={28} />}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((e) => (
            <li key={e.id} className={styles.item}>
              <div className={styles.head}>
                <span className={e.actorType === 'AI' ? styles.ai : styles.human}>
                  {e.actorType === 'AI' ? <Bot size={13} aria-hidden /> : <User size={13} aria-hidden />}
                  {e.actorName}
                </span>
                <span className={styles.summary}>{e.summary}</span>
                <NbBadge>{TARGET_LABEL[e.targetType] ?? e.targetType}</NbBadge>
                {HREF[e.targetType] && (
                  <a className={styles.link} href={`${HREF[e.targetType]}/${e.targetId}`}>열기</a>
                )}
                <time className={styles.at} dateTime={e.createdAt}>
                  {formatKstDateTimeShort(e.createdAt)}
                </time>
              </div>

              {e.changes.length > 0 && (
                <ul className={styles.changes}>
                  {e.changes.map((c) => (
                    <li key={c.field} className={styles.change}>
                      <span className={styles.field}>{c.field}</span>
                      <span className={styles.from}>{c.from}</span>
                      <span className={styles.arrow} aria-hidden>→</span>
                      <span className={styles.to}>{c.to}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {cursor && (
        <div className={styles.foot}>
          <NbButton variant="ghost" onClick={() => void load(cursor, true)} disabled={more}>
            {more ? '불러오는 중…' : '더 보기'}
          </NbButton>
        </div>
      )}
    </>
  )
}
