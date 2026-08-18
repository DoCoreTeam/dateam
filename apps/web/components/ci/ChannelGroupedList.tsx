'use client'

// components/ci/ChannelGroupedList.tsx — 채널 기준 그룹핑 목록
//
// 콘텐츠는 채널에 귀속된다. "어느 채널의 무엇이 잘 됐나"를 보려면
// 채널로 묶어 보는 시야가 필요하다. 평평한 목록만으로는 채널 간 비교가 안 된다.
//
// **묶는 것만으로는 아무것도 줄지 않는다**: 예전엔 모든 그룹을 전부 펼쳐 그려서
// 화면에 놓이는 카드 수가 평평한 목록과 똑같았다. 채널 10곳 × 게시물 수십 개를
// 다 지나야 다음 채널이 나오니, 정작 "채널이 몇 곳이고 어디가 잘 됐나"를 볼 수가 없었다
// (사용자 지적: "채널별로 접는 것도 필요할 것 같은데 그냥 묶기만 하면 뭐해").
// 그래서 기본은 **접힌 상태**다 — 머리줄이 이름·건수·최고 배수를 들고 있어
// 접힌 목록 자체가 채널 색인이 되고, 볼 채널만 펴면 된다.
// 그룹이 하나뿐이면 접을 이유가 없으므로 그때는 펴 둔다.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from './ContentCard'
import s from './channel-grouped-list.module.css'

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

const groupKey = (g: ChannelGroup) => g.channelId ?? '__none__'

export default function ChannelGroupedList({ items, onOpen, onNextStep, onAddToBoard }: Props) {
  const groups = useMemo(() => groupByChannel(items), [items])

  /**
   * 펴 둔 채널만 담는다 — **접힌 쪽이 기본**이라 여기 없는 채널은 접혀 있다.
   *
   * 왜 "접힌 것"이 아니라 "펴진 것"을 담는가: 필터를 바꾸면 그룹 목록이 통째로 바뀐다.
   * 접힌 쪽을 담으면 새로 들어온 채널이 자동으로 펴져 버려, 접어 둔 뜻이 조용히 뒤집힌다.
   */
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => (groups.length <= 1 ? new Set(groups.map(groupKey)) : new Set()),
  )

  const toggle = (key: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const allOpen = groups.length > 0 && groups.every((g) => openIds.has(groupKey(g)))

  return (
    <>
      {groups.length > 1 && (
        <div className={s.bulkBar}>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setOpenIds(allOpen ? new Set() : new Set(groups.map(groupKey)))}
          >
            {allOpen ? '모두 접기' : `모두 펴기 (${groups.length})`}
          </button>
        </div>
      )}

      {groups.map((g) => {
        const key = groupKey(g)
        const open = openIds.has(key)
        const panelId = `chgrp-${key}`
        return (
          <section key={key} className={s.group}>
            <div className={s.head}>
              <h3 className={s.title}>
                <button
                  type="button"
                  className={s.toggle}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(key)}
                >
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className={`${s.chevron} ${open ? s.chevronOpen : ''}`}
                  />
                  <span className={s.name}>{g.channelName}</span>
                </button>
              </h3>
              <span className="ci-count">{g.items.length}</span>
              {g.topOutlierText && (
                <span className="ci-status ci-status-ok">최고 {g.topOutlierText}</span>
              )}
              {/* 여닫기와 이동은 다른 일이다 — 이름은 여닫고, 채널로 가는 길은 여기 따로 둔다 */}
              {g.channelId && (
                <Link href={`/ci/channels/${g.channelId}`} className={s.openLink}>
                  채널 보기
                </Link>
              )}
            </div>

            {/* 접혀 있으면 카드를 아예 그리지 않는다 — 숨기기만 하면 목록이 길어지는 문제가 그대로다 */}
            {open && (
              <div id={panelId} className={`ci-card-grid ${s.body}`}>
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
            )}
          </section>
        )
      })}
    </>
  )
}
