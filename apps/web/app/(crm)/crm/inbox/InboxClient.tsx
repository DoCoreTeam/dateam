'use client'

// 인박스 (dacrm T1-06, 구현명세 §6.1)
//
// 두 탭으로 나눈다: **확인 필요**(PENDING)와 **자동 반영됨**(AUTO_APPLIED).
// 섞어 두면 "내가 확인해야 하는 게 몇 개인지"를 세어야 하고, 그러면 아무도 안 본다.
//
// 자동 반영된 것도 보여 주는 이유(명세 §6.1 마지막 줄): AI 가 사람 확인 없이 바꾼 값이
// 어딘가 조용히 쌓이면 안 된다. 목록으로 남아야 나중에 "왜 이렇게 됐지"에 답할 수 있다.

import { useCallback, useEffect, useState } from 'react'
import { Inbox } from 'lucide-react'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import AXDotLoader from '@/components/ui/AXDotLoader'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import SuggestionCard, { type SuggestionItem } from './SuggestionCard'
import styles from './inbox.module.css'

type Tab = 'PENDING' | 'AUTO_APPLIED'

export default function InboxClient() {
  const [tab, setTab] = useState<Tab>('PENDING')
  const [items, setItems] = useState<SuggestionItem[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/crm/suggestions?status=${tab}&limit=50`)
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '제안을 불러오지 못했습니다.'); return }
      const list: SuggestionItem[] = body.items ?? []
      setItems(list)

      // 대상 이름을 함께 보여 준다 — id 만 있으면 무엇에 대한 제안인지 알 수 없다.
      // 같은 레코드를 가리키는 제안이 여러 개일 수 있으므로 id 로 한 번만 부른다.
      const targets: { type: string; id: string }[] = []
      const seen = new Set<string>()
      for (const s of list) {
        if (!s.targetId || seen.has(s.targetId)) continue
        seen.add(s.targetId)
        targets.push({ type: s.targetType, id: s.targetId })
      }
      const found: Record<string, string> = {}
      await Promise.all(targets.map(async ({ type, id }) => {
        const path = type === 'company' ? 'companies' : type === 'person' ? 'people' : 'deals'
        const r = await fetch(`/api/crm/${path}/${id}`)
        if (r.ok) found[id] = (await r.json())?.name ?? ''
      }))
      setNames(found)
    } catch {
      setError('제안을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [tab])

  useEffect(() => { void load() }, [load])

  return (
    <>
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <SegmentedTabs
          tabs={[
            { id: 'PENDING', label: '확인 필요' },
            { id: 'AUTO_APPLIED', label: '자동 반영됨' },
          ]}
          ariaLabel="제안 보기"
          activeId={tab}
          onSelect={(id) => setTab(id as Tab)}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : loading && items.length === 0 ? (
        <AXDotLoader />
      ) : items.length === 0 ? (
        <EmptyState
          title={tab === 'PENDING' ? '확인할 제안이 아직 없어요' : '자동으로 반영된 것이 없어요'}
          description={tab === 'PENDING'
            ? '미팅을 기록하거나 텍스트를 붙여 넣으면 AI가 회사·인물·딜 후보를 여기로 올립니다.'
            : '설정에서 자동 반영을 켠 필드만 사람 확인 없이 반영됩니다.'}
          icon={<Inbox size={28} />}
          action={{ label: '딜 보러 가기', href: '/crm/deals' }}
        />
      ) : (
        <ul className={styles.list}>
          {items.map((s) => (
            <SuggestionCard
              key={s.id}
              item={s}
              targetName={s.targetId ? names[s.targetId] : undefined}
              onDone={() => void load()}
            />
          ))}
        </ul>
      )}
    </>
  )
}
