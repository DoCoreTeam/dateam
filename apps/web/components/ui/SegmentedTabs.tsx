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

import { Suspense, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

export interface SegmentedTab {
  id: string
  label: string
  /** 라벨 아래 한 줄 보조설명 — 선택지가 헷갈리는 탭에서 쓴다(예: 공급사 견적 = "우리 매입가") */
  sub?: string
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

/**
 * useSearchParams()는 정적 프리렌더에서 CSR bailout을 일으킨다 — 쓰는 페이지는
 * **Suspense 경계 안**에 있어야 하고, 없으면 `next build`가 그 페이지에서 통째로 실패한다.
 *
 * 실제 사고: v0.7.455에서 /develop(공개 문서 화면)의 탭을 이 부품으로 통일했는데,
 * /develop은 인증이 없어 정적 프리렌더 대상이라 빌드가 깨졌다.
 * dev 서버는 멀쩡했고 tsc·테스트·design:check도 전부 초록이라 이틀간 드러나지 않았다.
 *
 * 경계를 **부품 안에** 둔다 — 쓰는 쪽이 매번 기억해야 하는 규칙은 반드시 빠뜨린다.
 */
export default function SegmentedTabs(props: Props) {
  const skin = SKIN[props.variant ?? 'segment']
  return (
    <Suspense fallback={<div className={skin.list} role="tablist" aria-label={props.ariaLabel} aria-busy="true" />}>
      <SegmentedTabsInner {...props} />
    </Suspense>
  )
}

function SegmentedTabsInner({
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

  // 제어형(activeId)에서 활성 탭이 목록에 없으면 **아무 탭도 활성이 아니다.**
  // tabs[0]으로 떨어뜨리면 탭이 거짓말을 한다 — GPU 화면이 ?tab=cockpit일 때
  // 내용은 '가격 결정'인데 첫 탭 '통합 입력'에 불이 들어와 있었다(실측).
  const current = tabs.find(isCurrent) ?? (isNav || activeId !== undefined ? undefined : tabs[0])
  // 활성 탭이 없어도 키보드로는 탭 줄에 들어올 수 있어야 한다(roving tabindex).
  const focusableId = current?.id ?? tabs[0]?.id

  // 이동형(라우트 탭)은 **네비게이션 랜드마크**로 감싼다.
  // v0.7.445에서 WorkTabBar의 <nav aria-label="업무 탭">를 이 부품으로 통일하면서
  // 랜드마크가 사라졌고, 스크린리더가 "업무 탭 네비게이션"으로 안내하지 못하게 됐다.
  // (E2E 17건이 그때부터 실패하고 있었는데 CI가 E2E를 안 돌아 사흘간 안 보였다 — v0.7.475)
  // role="tab"은 그대로 둔다: 이미 그 역할에 기대는 화면·검사가 있고, 랜드마크만 되돌리면 충분하다.
  const list = (
    <>
      {/* 이동형은 nav가 이름을 갖는다 — 여기 tablist를 또 씌우면 링크가 탭으로 읽힌다 */}
      <div className={skin.list} role={isNav ? undefined : 'tablist'} aria-label={isNav ? undefined : ariaLabel}>
        {tabs.map((t, i) => {
          const active = t === current
          const cls = `${skin.item}${active ? ' is-active' : ''}${t.sub ? ' has-sub' : ''}`
          const inner = (
            <>
              {t.icon && <span className="seg-tab-icon">{t.icon}</span>}
              {t.sub ? <span className="seg-tab-label">{t.label}</span> : t.label}
              {t.sub && <span className="seg-tab-sub">{t.sub}</span>}
            </>
          )

          const tab = t.href ? (
            // 이동형은 **링크다.** role="tab"을 달면 스크린리더가 "탭 1/3"이라고 읽는데
            // 실제로는 페이지가 통째로 바뀐다(연결된 tabpanel도 없다).
            // 현재 위치는 aria-current="page"로 알린다 — 링크의 표준 방식이다.
            <Link
              key={t.id}
              href={t.href}
              prefetch={false}
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
              tabIndex={t.id === focusableId ? 0 : -1}
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

  return isNav ? <nav aria-label={ariaLabel}>{list}</nav> : list
}
