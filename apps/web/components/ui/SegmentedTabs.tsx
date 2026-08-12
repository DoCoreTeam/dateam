'use client'

// components/ui/SegmentedTabs.tsx — 공용 탭 (SSOT)
//
// 탭이 화면마다 제각각 인라인으로 만들어져 있었다(.tab-btn·.ci-stage-item·인라인 style 혼재).
// 같은 UI를 다시 만들지 않는다(§2) — 새 탭이 필요하면 이걸 쓴다.
//
// 서버 컴포넌트에서 각 패널을 미리 그려 `content`로 넘길 수 있다(RSC 페이로드로 전달).
// 활성 패널만 렌더한다 — 숨긴 패널까지 DOM에 두면 폼 id가 중복되고 탭 이동이 무거워진다.

import { useState, type ReactNode } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export interface SegmentedTab {
  id: string
  label: string
  icon?: ReactNode
  content: ReactNode
}

interface Props {
  tabs: SegmentedTab[]
  /** URL 쿼리 키. 탭도 공유 가능한 상태다(레포 관례) */
  param?: string
  ariaLabel: string
}

export default function SegmentedTabs({ tabs, param = 'tab', ariaLabel }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const fromUrl = searchParams.get(param)
  const initial = tabs.some((t) => t.id === fromUrl) ? (fromUrl as string) : tabs[0]?.id
  const [active, setActive] = useState(initial)

  function select(id: string) {
    // 전환은 즉시(로컬 상태), URL은 뒤따라 맞춘다.
    // 서버 왕복을 기다리면 탭이 늦게 바뀌어 사용자가 두 번 누른다.
    setActive(id)
    const params = new URLSearchParams(searchParams.toString())
    params.set(param, id)
    router.replace(`?${params}`, { scroll: false })
  }

  /** ←/→ 로 탭 이동 — 탭 위젯의 기본 키보드 규약이다. */
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = tabs[(index + delta + tabs.length) % tabs.length]
    select(next.id)
    document.getElementById(`segtab-${next.id}`)?.focus()
  }

  const current = tabs.find((t) => t.id === active) ?? tabs[0]

  return (
    <>
      <div className="seg-tabs" role="tablist" aria-label={ariaLabel}>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            id={`segtab-${t.id}`}
            type="button"
            role="tab"
            className={`seg-tab${t.id === current?.id ? ' is-active' : ''}`}
            aria-selected={t.id === current?.id}
            aria-controls={`segpanel-${t.id}`}
            tabIndex={t.id === current?.id ? 0 : -1}
            onClick={() => select(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {t.icon && <span className="seg-tab-icon">{t.icon}</span>}
            {t.label}
          </button>
        ))}
      </div>

      {current && (
        <div id={`segpanel-${current.id}`} role="tabpanel" aria-labelledby={`segtab-${current.id}`}>
          {current.content}
        </div>
      )}
    </>
  )
}
