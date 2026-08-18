'use client'

// components/ci/ChannelGroupedList.tsx — 채널 기준 그룹핑 목록
//
// 콘텐츠는 채널에 귀속된다. "어느 채널의 무엇이 잘 됐나"를 보려면
// 채널로 묶어 보는 시야가 필요하다. 평평한 목록만으로는 채널 간 비교가 안 된다.
//
// **묶는 것만으로는 아무것도 줄지 않는다**: 예전엔 모든 그룹을 전부 펼쳐 그려서
// 화면에 놓이는 카드 수가 평평한 목록과 똑같았다. 그래서 기본은 **접힌 상태**다 —
// 머리줄이 이름·건수·최고 배수를 들고 있어 접힌 목록 자체가 채널 색인이 된다.
//
// **그리고 그룹은 서버가 만든다**(v0.7.568): 예전에는 화면이 받은 한 페이지를
// 클라이언트에서 묶었다. 그래서 2페이지에는 그 100건에 우연히 담긴 채널 2곳만 보였고,
// 페이지를 넘길 때마다 채널이 바뀌었다 — 채널이 8곳인데 어느 페이지에서도 8곳을 볼 수 없었다.
// (사용자 지적: "페이지 바꿀 때마다 채널만 달라지고 이게 맞는건가?")
// 표준은 분명하다 — **페이지는 최상위 그룹(채널) 기준으로 나누고, 그룹을 펴면 자식은
// 부모와 같은 페이지에 있다**(AG Grid 서버사이드 모델 · 같은 증상: PrimeNG #15192).
// 그래서 이 부품은 채널 목록만 받고, 게시물은 **펴는 순간** 그 채널에서 직접 불러온다.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { CiContentListItem } from '@/lib/ci/contracts'
import ContentCard from './ContentCard'
import EmptyState from '@/components/ui/EmptyState'
import ErrorState from '@/components/ui/ErrorState'
import { SkelList } from '@/components/ui/LoadingSkeleton'
import s from './channel-grouped-list.module.css'

export interface ChannelGroup {
  channelId: string | null
  channelName: string
  /** 이 채널의 **전체** 게시물 수. 화면에 그린 수가 아니다 */
  itemCount: number
  /** 이 채널에서 배수가 가장 높은 값의 문장 */
  topOutlierText: string | null
  /**
   * 이미 손에 있는 게시물. 있으면 펴도 서버에 묻지 않는다.
   *
   * 왜 두 갈래인가: 트렌드의 떡상은 **고정 30건**을 보여주는 화면이라 페이지가 없다.
   * 거기서는 "이 30건이 어느 채널에서 나왔나"가 묶는 목적이고, 그 30건이 전부다.
   * 수집함은 1,600건이 페이지로 나뉘므로 채널을 서버가 집계해야 한다.
   * 같은 부품이 둘 다 그리되, **이미 받은 것을 다시 묻지는 않는다.**
   */
  items?: CiContentListItem[]
}

/** 손에 든 목록을 채널로 묶는다 — 페이지가 없는 화면(트렌드 떡상)에서 쓴다. */
export function groupByChannel(items: readonly CiContentListItem[]): ChannelGroup[] {
  const map = new Map<string, ChannelGroup>()
  for (const item of items) {
    const key = item.channelId ?? '__none__'
    const g = map.get(key) ?? {
      channelId: item.channelId,
      channelName: item.channelName ?? '채널 미확인',
      itemCount: 0,
      topOutlierText: null,
      items: [] as CiContentListItem[],
    }
    g.items!.push(item)
    g.itemCount = g.items!.length
    if (!g.topOutlierText && item.outlierText) g.topOutlierText = item.outlierText
    map.set(key, g)
  }
  return Array.from(map.values()).sort((a, b) => {
    const aHas = a.topOutlierText ? 1 : 0
    const bHas = b.topOutlierText ? 1 : 0
    if (aHas !== bHas) return bHas - aHas
    return b.itemCount - a.itemCount
  })
}

interface Props {
  /** 서버가 만든 채널 목록(한 페이지). 게시물은 들어 있지 않다 */
  groups: ChannelGroup[]
  workspaceId: string
  /**
   * 목록이 걸고 있는 조건(검색·필터·정렬·탭).
   * **자식에도 같은 조건이 걸려야 한다** — 그룹은 검색으로 좁혔는데 펴 보면
   * 그 채널 전부가 나오면 사용자는 검색이 안 먹었다고 읽는다(실측으로 잡음).
   */
  listParams?: Record<string, string>
  onOpen?: (id: string) => void
  onNextStep?: (id: string) => void
  onAddToBoard?: (id: string) => void
}

/** 채널을 펼 때 한 번에 불러올 게시물 수. 더 있으면 '더 보기'로 이어 받는다. */
const EXPAND_PAGE = 24

const groupKey = (g: ChannelGroup) => g.channelId ?? '__none__'

/** 한 채널의 펼침 상태. 게시물은 펴는 순간 받아 온다. */
interface Expanded {
  items: CiContentListItem[]
  loading: boolean
  error: string | null
  /** 더 받을 것이 있으면 다음 오프셋 */
  cursor: string | null
}

export default function ChannelGroupedList({
  groups, workspaceId, listParams, onOpen, onNextStep, onAddToBoard,
}: Props) {
  /**
   * 펴 둔 채널만 담는다 — **접힌 쪽이 기본**이라 여기 없는 채널은 접혀 있다.
   *
   * 왜 "접힌 것"이 아니라 "펴진 것"을 담는가: 필터를 바꾸면 그룹 목록이 통째로 바뀐다.
   * 접힌 쪽을 담으면 새로 들어온 채널이 자동으로 펴져 버려, 접어 둔 뜻이 조용히 뒤집힌다.
   */
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState<Record<string, Expanded>>({})

  // 요청이 겹치지 않게 — 같은 채널을 빠르게 여닫으면 응답이 뒤집혀 도착할 수 있다
  const inFlight = useRef<Set<string>>(new Set())

  const fetchPage = useCallback(async (channelId: string | null, cursor: string | null) => {
    // 채널이 없는 묶음('채널 미확인')은 채널 API로 불러올 수 없다.
    if (!channelId) return
    const key = channelId
    if (inFlight.current.has(key)) return
    inFlight.current.add(key)

    setLoaded((prev) => ({
      ...prev,
      [key]: {
        items: prev[key]?.items ?? [],
        loading: true,
        error: null,
        cursor: prev[key]?.cursor ?? null,
      },
    }))

    try {
      // 목록과 **같은 조회**를 쓴다(SSOT). 채널 전용 경로를 따로 두면 조건이 갈린다.
      const qs = new URLSearchParams({
        ...(listParams ?? {}),
        channelId,
        limit: String(EXPAND_PAGE),
      })
      if (cursor) qs.set('cursor', cursor)
      const res = await fetch(`/api/ci/contents?${qs}`, {
        headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<{
        success: boolean
        data?: CiContentListItem[]
        meta?: { cursor: string | null }
        error?: { message: string }
      }>)

      if (!res.success || !res.data) {
        setLoaded((prev) => ({
          ...prev,
          [key]: {
            items: prev[key]?.items ?? [],
            loading: false,
            // 조용히 비워 두지 않는다 — 빈 그룹은 "게시물이 없다"로 읽힌다
            error: res.error?.message ?? '게시물을 불러오지 못했습니다',
            cursor: prev[key]?.cursor ?? null,
          },
        }))
        return
      }

      setLoaded((prev) => ({
        ...prev,
        [key]: {
          items: cursor ? [...(prev[key]?.items ?? []), ...res.data!] : res.data!,
          loading: false,
          error: null,
          cursor: res.meta?.cursor ?? null,
        },
      }))
    } catch {
      setLoaded((prev) => ({
        ...prev,
        [key]: {
          items: prev[key]?.items ?? [],
          loading: false,
          error: '게시물을 불러오지 못했습니다',
          cursor: prev[key]?.cursor ?? null,
        },
      }))
    } finally {
      inFlight.current.delete(key)
    }
  }, [workspaceId, listParams])

  const toggle = useCallback((g: ChannelGroup) => {
    const key = groupKey(g)
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) { next.delete(key); return next }
      next.add(key)
      // 손에 이미 있으면 묻지 않는다. 없고 안 받아 봤으면 지금 받는다.
      if (!g.items && !loaded[key]) void fetchPage(g.channelId, null)
      return next
    })
  }, [fetchPage, loaded])

  // 그룹이 하나뿐이면 접을 이유가 없다 — 그때는 펴 둔다.
  useEffect(() => {
    if (groups.length !== 1) return
    const g = groups[0]
    const key = groupKey(g)
    setOpenIds((prev) => (prev.has(key) ? prev : new Set([key])))
    if (!g.items && !loaded[key]) void fetchPage(g.channelId, null)
    // 그룹 목록이 바뀔 때만 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  const allOpen = groups.length > 0 && groups.every((g) => openIds.has(groupKey(g)))

  function toggleAll() {
    if (allOpen) { setOpenIds(new Set()); return }
    setOpenIds(new Set(groups.map(groupKey)))
    for (const g of groups) {
      if (!g.items && !loaded[groupKey(g)]) void fetchPage(g.channelId, null)
    }
  }

  return (
    <>
      {groups.length > 1 && (
        <div className={s.bulkBar}>
          <button type="button" className="btn-ghost" onClick={toggleAll}>
            {allOpen ? '모두 접기' : `모두 펴기 (${groups.length})`}
          </button>
        </div>
      )}

      {groups.map((g) => {
        const key = groupKey(g)
        const open = openIds.has(key)
        const panelId = `chgrp-${key}`
        // 손에 든 것이 우선. 없으면 펴면서 받아 온 것.
        const state = g.items
          ? { items: g.items, loading: false, error: null, cursor: null }
          : loaded[key]
        return (
          <section key={key} className={s.group}>
            <div className={s.head}>
              <h3 className={s.title}>
                <button
                  type="button"
                  className={s.toggle}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(g)}
                >
                  <ChevronRight
                    size={16}
                    aria-hidden
                    className={`${s.chevron} ${open ? s.chevronOpen : ''}`}
                  />
                  <span className={s.name}>{g.channelName}</span>
                </button>
              </h3>
              {/* 이 채널의 **전체** 건수다. 예전엔 현재 페이지에 담긴 수라 채널마다 들쭉날쭉했다 */}
              <span className="ci-count">{g.itemCount.toLocaleString()}</span>
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
              <div id={panelId}>
                {state?.error ? (
                  <ErrorState code="INTERNAL" message={state.error} />
                ) : state?.items.length ? (
                  <>
                    <div className={`ci-card-grid ${s.body}`}>
                      {state.items.map((item) => (
                        <ContentCard
                          key={item.id}
                          item={item}
                          onOpen={onOpen}
                          onNextStep={onNextStep}
                          onAddToBoard={onAddToBoard}
                        />
                      ))}
                    </div>
                    {/* 채널 안에서 이어 받는다 — 목록 페이지를 넘기지 않는다.
                        그룹을 펴면 자식은 부모와 같은 페이지에 있어야 한다(표준). */}
                    {state.cursor && (
                      <div className={s.moreBar}>
                        <button
                          type="button"
                          className="btn-ghost"
                          disabled={state.loading}
                          onClick={() => void fetchPage(g.channelId, state.cursor)}
                        >
                          {state.loading
                            ? '불러오는 중…'
                            : `${state.items.length} / ${g.itemCount.toLocaleString()} · 더 보기`}
                        </button>
                      </div>
                    )}
                  </>
                ) : state?.loading ? (
                  <div className={s.body}><SkelList rows={3} /></div>
                ) : (
                  <div className={s.body}>
                    <EmptyState
                      title="이 채널에서 볼 게시물이 없습니다"
                      description="필터를 바꾸면 다시 나타날 수 있습니다."
                    />
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
    </>
  )
}
