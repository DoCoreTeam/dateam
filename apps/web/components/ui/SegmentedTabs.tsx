'use client'

// components/ui/SegmentedTabs.tsx — 탭 렌더러 SSOT
//
// 탭을 만드는 방식이 다섯 가지였다: 패널형(SegmentedTabs)·CRM 언더라인(ProjectTabs)·
// 업무 허브 섹션탭(WorkTabBar)·pill 서브탭(WorkSubTabs)·번호 흐름(StageNav).
// 마크업·활성 판정·키보드 규약이 제각각이라 화면마다 탭이 다르게 동작했다.
// 이제 **그리는 곳은 여기 하나**다. 나머지는 데이터/프롭만 넘기는 얇은 어댑터다.
//
// 세 가지 모드 — 탭이 무엇을 하느냐로 갈린다:
//   이동형(href)   : 라우트가 상태다. <Link> + pathname으로 활성 판정.
//   제어형(activeId): 부모가 상태를 쥔다. 버튼 + onSelect.
//   패널형(content) : 이 컴포넌트가 URL 쿼리로 상태를 쥐고 활성 패널만 그린다.
// 숨긴 패널까지 DOM에 두면 폼 id가 중복되고 탭 이동이 무거워진다 — 활성만 그린다.

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export interface SegmentedTab {
  id: string
  label: string
  icon?: ReactNode
  /** 패널형 */
  content?: ReactNode
  /** 이동형 — 있으면 이 탭 묶음은 라우트 탭이 된다 */
  href?: string
  /** 이동형 활성 판정에 함께 볼 경로(병합된 옛 경로 등) */
  match?: string[]
  testId?: string
}

/** 골격은 같고 표면만 다르다 — 새 variant를 늘리기 전에 기존 것으로 되는지 먼저 본다 */
export type SegmentedVariant = 'segment' | 'primary' | 'stage'

const SKIN: Record<SegmentedVariant, { list: string; item: string }> = {
  segment: { list: 'seg-tabs', item: 'seg-tab' },
  primary: { list: 'seg-tabs-primary', item: 'seg-tab-primary' },
  stage: { list: 'seg-tabs-stage', item: 'seg-tab-stage' },
}

interface Props {
  tabs: SegmentedTab[]
  ariaLabel: string
  variant?: SegmentedVariant
  /** 패널형 URL 쿼리 키. 탭도 공유 가능한 상태다(레포 관례) */
  param?: string
  /** 제어형 — 부모가 활성 탭을 소유할 때 */
  activeId?: string
  onSelect?: (id: string) => void
}

export default function SegmentedTabs({
  tabs, ariaLabel, variant = 'segment', param = 'tab', activeId, onSelect,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()

  const fromUrl = searchParams.get(param)
  const initial = tabs.some((t) => t.id === fromUrl) ? (fromUrl as string) : tabs[0]?.id
  const [ownActive, setOwnActive] = useState(initial)

  const isNav = tabs.some((t) => t.href)
  const skin = SKIN[variant]

  function isCurrent(t: SegmentedTab) {
    // 이동형이라도 화면이 활성 탭을 알고 있으면 그게 정답이다.
    // 쿼리로 갈리는 탭(?tab=users)은 pathname이 전부 같아서 경로 비교로는 못 가른다.
    if (activeId !== undefined) return t.id === activeId
    if (t.href) {
      return [t.href, ...(t.match ?? [])]
        .some((p) => pathname === p || pathname.startsWith(p + '/'))
    }
    return t.id === ownActive
  }

  function select(id: string) {
    if (onSelect) return onSelect(id)
    // 전환은 즉시(로컬 상태), URL은 뒤따라 맞춘다.
    // 서버 왕복을 기다리면 탭이 늦게 바뀌어 사용자가 두 번 누른다.
    setOwnActive(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set(param, id)
    router.replace(`?${params}`, { scroll: false })
  }

  /** ←/→ 로 탭 이동 — 탭 위젯의 기본 키보드 규약이다(이동형은 링크 규약을 따른다) */
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    select(next.id)
    document.getElementById(`segtab-${next.id}`)?.focus()
  }

  const current = tabs.find(isCurrent) ?? (isNav ? undefined : tabs[0])

  return (
    <>
      <div className={skin.list} role="tablist" aria-label={ariaLabel}>
        {tabs.map((t, i) => {
          const active = t === current
          const cls = `${skin.item}${active ? ' is-active' : ''}`
          const inner = (
            <>
              {t.icon && <span className="seg-tab-icon">{t.icon}</span>}
              {t.label}
            </>
          )

          const tab = t.href ? (
            <Link
              key={t.id}
              href={t.href}
              prefetch={false}
              role="tab"
              aria-selected={active}
              aria-current={active ? 'page' : undefined}
              className={cls}
              data-testid={t.testId}
            >
              {inner}
            </Link>
          ) : (
            <button
              key={t.id}
              id={`segtab-${t.id}`}
              type="button"
              role="tab"
              className={cls}
              aria-selected={active}
              aria-controls={t.content ? `segpanel-${t.id}` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => select(t.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              data-testid={t.testId}
            >
              {inner}
            </button>
          )

          // 스테이지는 순서가 의미다 — 사이에 화살표를 넣어 흐름으로 읽히게 한다
          if (variant !== 'stage' || i === tabs.length - 1) return tab
          return (
            <span key={t.id} className="seg-stage-step">
              {tab}
              <span className="seg-tab-arrow" aria-hidden="true">→</span>
            </span>
          )
        })}
      </div>

      {current?.content && (
        <div id={`segpanel-${current.id}`} role="tabpanel" aria-labelledby={`segtab-${current.id}`}>
          {current.content}
        </div>
      )}
    </>
  )
}
