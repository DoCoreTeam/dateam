'use client'

// 이 딜/회사에 무슨 이야기가 오갔나 (dacrm)
//
// **왜 이 부품이 생겼나**: 미팅을 만들 때 회사·딜을 고르게 해 놓고,
// 정작 **딜 상세에서 그 미팅을 볼 수 없었다.** 연결해 놓고 못 보면 연결한 적 없는 것과 같다.
//
// 딜을 여는 사람이 가장 자주 하는 질문이 "지난번에 뭐라고 했지?"인데,
// 그 답이 미팅에 있는데 화면에 없었다.
//
// 두 화면(딜·회사)이 같은 것을 물으므로 부품 하나를 함께 쓴다 —
// 각자 만들면 한쪽만 고치게 된다.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Mic } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './meeting-panel.module.css'

interface Meeting {
  id: string
  title: string
  startedAt: string
  location: string | null
  summaryMd: string | null
}

/** 딜에 붙은 것만 볼지, 회사 전체를 볼지 — 부르는 화면이 정한다 */
export interface MeetingPanelScope {
  dealId?: string
  companyId?: string
}

export default function MeetingPanel({ scope }: { scope: MeetingPanelScope }) {
  const [items, setItems] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { dealId, companyId } = scope

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ limit: '10' })
      if (dealId) sp.set('dealId', dealId)
      else if (companyId) sp.set('companyId', companyId)

      const res = await fetch(`/api/crm/meetings?${sp}`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '미팅을 불러오지 못했습니다.'); return }
      setItems(body.items ?? [])
    } catch {
      setError('미팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [dealId, companyId])

  useEffect(() => { void load() }, [load])

  if (loading && items.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  if (items.length === 0) {
    return (
      <EmptyState
        title="아직 기록된 미팅이 없어요"
        description="미팅을 기록하고 전사를 붙여넣으면 AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 줍니다."
        icon={<Mic size={24} />}
        action={{ label: '미팅 기록하기', href: '/crm/meetings' }}
      />
    )
  }

  return (
    <ul className={styles.list}>
      {items.map((m) => (
        <li key={m.id} className={styles.item}>
          <Link href={`/crm/meetings/${m.id}`} className={styles.main}>
            <span className={styles.title}>{m.title}</span>
            <span className={styles.meta}>
              {formatKstDateTimeShort(m.startedAt)}
              {m.location && ` · ${m.location}`}
            </span>
          </Link>
          {m.summaryMd
            ? <NbBadge status="done">정리됨</NbBadge>
            : <NbBadge status="planned">전사 대기</NbBadge>}
        </li>
      ))}
    </ul>
  )
}
