'use client'

// 미팅 목록 (dacrm F2)
//
// 이 화면이 답해야 하는 것: **"지난주에 누구를 만났고 무슨 이야기가 오갔나."**
// 그래서 목록은 최근순이고, 각 줄에 회사·딜이 함께 보인다 —
// 미팅만 나열하면 "이게 어느 건이었지"를 매번 눌러 봐야 한다.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Mic, Plus } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import NbBadge from '@/components/ui/nb/NbBadge'
import AXDotLoader from '@/components/ui/AXDotLoader'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { formatKstDateTimeShort } from '@/lib/datetime/kst'
import styles from './meetings.module.css'

interface Meeting {
  id: string
  title: string
  startedAt: string
  companyId: string | null
  dealId: string | null
  location: string | null
  summaryMd: string | null
}

export default function MeetingsClient() {
  const router = useRouter()
  const [items, setItems] = useState<Meeting[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/meetings')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '미팅을 불러오지 못했습니다.'); return }
      const list: Meeting[] = body.items ?? []
      setItems(list)

      /**
       * 회사·딜 이름을 함께 보여 준다.
       *
       * id 만 있으면 "어느 건이었지"를 매번 눌러 봐야 한다.
       * 이름 조회가 실패해도 목록 자체는 보여야 하므로 따로 부른다.
       */
      const companyIds = Array.from(new Set(list.map((m) => m.companyId).filter(Boolean))) as string[]
      const dealIds = Array.from(new Set(list.map((m) => m.dealId).filter(Boolean))) as string[]
      const map: Record<string, string> = {}
      await Promise.all([
        ...companyIds.map(async (id) => {
          try {
            const r = await fetch(`/api/crm/companies/${id}`)
            if (r.ok) map[id] = (await r.json()).name
          } catch { /* 이름을 못 읽어도 목록은 보인다 */ }
        }),
        ...dealIds.map(async (id) => {
          try {
            const r = await fetch(`/api/crm/deals/${id}`)
            if (r.ok) map[id] = (await r.json()).name
          } catch { /* 같은 이유 */ }
        }),
      ])
      setNames(map)
    } catch {
      setError('미팅을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading && items.length === 0) return <AXDotLoader />
  if (error) return <ErrorState message={error} onRetry={() => void load()} />

  return (
    <>
      <div className={styles.toolbar}>
        {/* 모달이 아니라 캡처 화면으로 간다 — 예전엔 모달에서 저장하면 목록으로 돌아와
            방금 만든 미팅을 눈으로 찾아 다시 클릭해야 내용을 넣을 수 있었다. */}
        <NbButton onClick={() => router.push('/crm/meetings/new')}>
          <Plus size={16} /> 미팅 기록
        </NbButton>
      </div>

      {items.length === 0 ? (
        <EmptyState
          title="기록된 미팅이 아직 없어요"
          description="미팅을 기록하고 전사를 붙여넣으면, AI가 누가 나왔고 무엇이 걸림돌인지 뽑아 인박스로 보냅니다."
          icon={<Mic size={28} />}
          action={{ label: '미팅 기록하기', href: '/crm/meetings/new' }}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((m) => (
            <li key={m.id} className={styles.item}>
              <Link href={`/crm/meetings/${m.id}`} className={styles.itemMain}>
                <span className={styles.itemTitle}>{m.title}</span>
                <span className={styles.itemMeta}>
                  {formatKstDateTimeShort(m.startedAt)}
                  {m.companyId && names[m.companyId] && ` · ${names[m.companyId]}`}
                  {m.location && ` · ${m.location}`}
                </span>
              </Link>
              {m.summaryMd
                ? <NbBadge status="done">정리됨</NbBadge>
                : <NbBadge status="planned">전사 대기</NbBadge>}
            </li>
          ))}
        </ul>
      )}

    </>
  )
}
