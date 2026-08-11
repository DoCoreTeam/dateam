'use client'

// app/(ci)/ci/channels/[id]/ChannelDetailView.tsx — R03 채널 상세 뷰

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CiChannelListItem, CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from '@/components/ci/ContentCard'
import DetailSheet from '@/components/ci/DetailSheet'
import { EmptyState } from '@/components/ci/states'

interface Props {
  workspaceId: string
  channel: CiChannelListItem
  contents: CiContentListItem[]
}

export default function ChannelDetailView({ workspaceId, channel, contents }: Props) {
  const router = useRouter()
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function toggleMonitor() {
    setBusy(true)
    try {
      await fetch(`/api/ci/channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CI-Workspace': workspaceId },
        body: JSON.stringify({ isMonitored: !channel.isMonitored }),
      })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section
        style={{
          display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center',
          padding: 'var(--space-4)', border: 'var(--border-w-2) solid var(--border-color)',
          borderRadius: 'var(--radius)', background: 'var(--color-surface)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div>
          <p className="ci-basis">구독자</p>
          <p className="ci-metric-big">
            {channel.subscriberCount != null
              ? channel.subscriberCount.toLocaleString('ko-KR')
              : '—'}
          </p>
          {channel.subscriberCount == null && (
            <p className="ci-basis">아직 확보하지 못했습니다</p>
          )}
        </div>
        <div>
          <p className="ci-basis">수집한 게시물</p>
          <p className="ci-metric-big">{contents.length}</p>
        </div>
        <div>
          <p className="ci-basis">규모 구간</p>
          <p style={{ fontWeight: 600 }}>{channel.sizeBand ?? '판정 전'}</p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 'var(--space-2)' }}>
          {channel.ownership === 'tracked' && (
            <button type="button" className="btn-ghost" onClick={toggleMonitor} disabled={busy}>
              {channel.isMonitored ? '모니터링 중지' : '모니터링 시작'}
            </button>
          )}
        </div>
      </section>

      <h2 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 'var(--space-3)' }}>
        게시물
      </h2>

      {contents.length === 0 ? (
        <EmptyState
          title="이 채널에서 수집한 게시물이 없습니다"
          description="채널의 게시물 링크를 수집함에 넣거나, 모니터링을 켜두면 새 게시물이 쌓입니다."
          action={{ label: '수집함으로', href: '/ci/inbox' }}
        />
      ) : (
        <div className="ci-card-grid">
          {contents.map((item) => (
            <ContentCard
              key={item.id}
              item={item}
              onOpen={setOpenId}
              onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
            />
          ))}
        </div>
      )}

      <DetailSheet
        contentId={openId}
        workspaceId={workspaceId}
        onClose={() => setOpenId(null)}
        onNextStep={(id) => router.push(`/ci/pipeline?from=${id}`)}
      />
    </>
  )
}
