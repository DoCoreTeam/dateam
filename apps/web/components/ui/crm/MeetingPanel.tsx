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
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mic } from 'lucide-react'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import NbBadge from '@/components/ui/nb/NbBadge'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import { startMeeting, meetingHref } from '@/lib/crm/ui/start-meeting'
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
  /** 인물 상세 — 「이 사람과 한 회의」. 참석자로 이어진 미팅만 본다 */
  personId?: string
}

export default function MeetingPanel({ scope }: { scope: MeetingPanelScope }) {
  const router = useRouter()
  const [items, setItems] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)

  const { dealId, companyId, personId } = scope

  /**
   * **누르면 바로 작업대다.** 보던 딜·회사를 물려서 미팅을 만들고 곧장 그리로 간다.
   *
   * 예전엔 `/crm/meetings/new?dealId=…` 로 보내 제목·시각을 한 번 더 물었다.
   * 회의 중에 화면이 두 번 갈아엎히면 사용자는 기록을 놓친다(사용자 지시 2026-08-24).
   * 딜·회사는 여기서 이미 아는 값이라 물을 이유가 없다.
   */
  const begin = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      const created = await startMeeting({ dealId, companyId })
      router.push(meetingHref(created.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '미팅을 만들지 못했습니다.')
      setStarting(false)
    }
  }, [router, dealId, companyId])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const sp = new URLSearchParams({ limit: '10' })
      if (personId) sp.set('personId', personId)
      else if (dealId) sp.set('dealId', dealId)
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
  }, [dealId, companyId, personId])

  useEffect(() => { void load() }, [load])

  if (loading && items.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  if (items.length === 0) {
    /**
     * 인물 화면에서는 여기서 미팅을 열지 않는다 — 사람만으로는 어느 회사·딜의 회의인지 정할 수 없다.
     * 대신 **왜 비어 있는지**를 말해 준다. 「없다」와 「아직 안 이었다」는 다른 사실이다.
     */
    if (personId) {
      return (
        <EmptyState
          title="이 사람과 한 회의가 아직 없어요"
          description="회의노트 참석자에 이 사람을 이어 두면 여기에 쌓입니다."
          icon={<Mic size={24} />}
        />
      )
    }
    return (
      <EmptyState
        title="아직 기록된 미팅이 없어요"
        description="미팅을 기록하고 전사를 붙여넣으면 AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 줍니다."
        icon={<Mic size={24} />}
        /* 보던 딜·회사를 물려 바로 작업대를 연다 — 중간에 묻는 화면이 없다 */
        action={{ label: starting ? '여는 중…' : '미팅 기록하기', onClick: () => void begin() }}
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
