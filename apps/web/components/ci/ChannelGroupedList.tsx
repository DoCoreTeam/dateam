'use client'

// components/ci/ChannelGroupedList.tsx — 채널 기준 그룹핑 목록
//
// 콘텐츠는 채널에 귀속된다. "어느 채널의 무엇이 잘 됐나"를 보려면
// 채널로 묶어 보는 시야가 필요하다. 평평한 목록만으로는 채널 간 비교가 안 된다.

import Link from 'next/link'
import type { CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from './ContentCard'

export interface ChannelGroup {
  channelId: string | null
  channelName: string
  items: CiContentListItem[]
  /** 이 채널에서 배수가 가장 높은 콘텐츠의 문장 */
  topOutlierText: string | null
}

/** 채널별로 묶고, 배수가 높은 채널이 위로 오게 정렬한다. */
export function groupByChannel(items: readonly CiContentListItem[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>()

  for (const item of items) {
    const key = item.channelId ?? '__none__'
    const group = map.get(key) ?? {
      channelId: item.channelId,
      channelName: item.channelName ?? '채널 미확인',
      items: [],
      topOutlierText: null,
    }
    group.items.push(item)
    if (!group.topOutlierText && item.outlierText) group.topOutlierText = item.outlierText
    map.set(key, group)
  }

  return Array.from(map.values()).sort((a, b) => {
    // 배수가 잡힌 채널을 먼저, 그다음 건수 많은 순
    const aHas = a.topOutlierText ? 1 : 0
    const bHas = b.topOutlierText ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    return b.items.length - a.items.length
  })
}

interface Props {
  items: CiContentListItem[]
  onOpen?: (id: string) => void
  onNextStep?: (id: string) => void
  onAddToBoard?: (id: string) => void
}

export default function ChannelGroupedList({ items, onOpen, onNextStep, onAddToBoard }: Props) {
  const groups = groupByChannel(items)

  return (
    <>
      {groups.map((g) => (
        <section key={g.channelId ?? 'none'} style={{ marginBottom: 'var(--space-8)' }}>
          <div
            style={{
              display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)',
              flexWrap: 'wrap', marginBottom: 'var(--space-3)',
              paddingBottom: 'var(--space-2)',
              borderBottom: 'var(--border-w-2) solid var(--border-color)',
            }}
          >
            <h3 style={{ fontSize: 'var(--fs-md)', fontWeight: 700, margin: 0 }}>
              {g.channelId ? (
                <Link href={`/ci/channels/${g.channelId}`} style={{ color: 'var(--text)' }}>
                  {g.channelName}
                </Link>
              ) : g.channelName}
            </h3>
            <span className="ci-count">{g.items.length}</span>
            {g.topOutlierText && (
              <span className="ci-status ci-status-ok">최고 {g.topOutlierText}</span>
            )}
          </div>

          <div className="ci-card-grid">
            {g.items.map((item) => (
              <ContentCard
                key={item.id}
                item={item}
                onOpen={onOpen}
                onNextStep={onNextStep}
                onAddToBoard={onAddToBoard}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}
