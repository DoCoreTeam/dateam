'use client'

// components/ui/settings/SettingsPanel.tsx — 설정 화면의 그릇 (SSOT)
//
// 설정 화면이 넷이다(콘텐츠 인텔리전스 · 관리자 · 영업 CRM · RFP).
// 카드는 이미 공용 부품(SettingsCard)을 쓰는데 **그 카드를 담는 그릇은 화면마다 제각각**이었다.
// 검색 칸을 그린 화면도 있고 안 그린 화면도 있었고, 탭 묶음의 이름도 화면마다 달랐다.
//
// 그래서 검색 한 칸 · 분류 탭 · 빈 상태 · 세로 쌓기를 여기 하나에 둔다.
// 화면은 «무엇을 담을지»만 정하고 «어떻게 생겼는지»는 정하지 않는다.
//
// 말은 전부 lib/terms 의 SETTINGS 에서 온다 — 같은 칸이 화면마다 다른 말을 하지 않게.

import { useId, type ReactNode } from 'react'
import SegmentedTabs from '@/components/ui/SegmentedTabs'
import EmptyState from '@/components/ui/EmptyState'
import { SETTINGS } from '@/lib/terms'

export interface SettingsGroup {
  id: string
  label: string
}

interface Props {
  /** 분류 탭. 하나뿐이면 탭 줄을 그리지 않는다 — 고를 것이 없는 탭은 자리만 먹는다 */
  groups: SettingsGroup[]
  activeId: string
  onSelect: (id: string) => void
  /**
   * 검색어. 거르는 일은 화면이 한다 — 무엇이 이름이고 무엇이 설명인지는 화면만 안다.
   * 그릇은 칸과 말만 갖는다.
   */
  query: string
  onQueryChange: (next: string) => void
  /**
   * 그릴 것이 하나도 없음. 검색 중인지에 따라 다른 말을 한다 —
   * 「이 분류에는 없다」와 「찾는 것이 없다」는 사용자가 할 다음 행동이 다르다.
   */
  isEmpty?: boolean
  /** 분류와 무관한 알림 자리 (저장 알림 · 오류). 탭을 바꿔도 그대로 보여야 하는 것 */
  notice?: ReactNode
  children: ReactNode
}

export default function SettingsPanel({
  groups, activeId, onSelect, query, onQueryChange, isEmpty = false, notice, children,
}: Props) {
  // 한 페이지에 그릇이 둘 이상 놓여도 라벨이 엉키지 않게 id 를 부품이 만든다
  const searchId = useId()
  const searching = query.trim().length > 0

  return (
    <div className="settings-panel">
      <div className="settings-panel-search">
        <label className="label" htmlFor={searchId}>{SETTINGS.searchLabel}</label>
        <input
          className="input-field"
          id={searchId}
          type="search"
          value={query}
          placeholder={SETTINGS.searchPlaceholder}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>

      {/* 검색 중에는 탭을 감춘다 — 검색은 탭과 무관하게 전체에서 찾는다.
          탭이 켜져 있으면 결과가 그 탭 안의 것으로 읽혀 «없다»로 오해한다 */}
      {!searching && groups.length > 1 && (
        <SegmentedTabs
          ariaLabel={SETTINGS.tabsLabel}
          tabs={groups.map((g) => ({ id: g.id, label: g.label }))}
          activeId={activeId}
          onSelect={onSelect}
        />
      )}

      {notice}

      {isEmpty ? (
        searching
          ? <EmptyState title={SETTINGS.noMatchTitle} description={SETTINGS.noMatchHint} />
          : <EmptyState title={SETTINGS.emptyGroupTitle} description={SETTINGS.emptyGroupHint} />
      ) : (
        <div className="settings-panel-body">{children}</div>
      )}
    </div>
  )
}

/**
 * 설정 줄 묶음 — 카드 안에서 한 줄씩 쌓을 때.
 *
 * 화면이 `className="settings-list"` 를 직접 적던 자리다.
 * 클래스 이름을 화면이 알고 있으면 이름을 바꿀 때 화면을 전부 고쳐야 한다.
 */
export function SettingsList({ as = 'div', children }: { as?: 'div' | 'ul'; children: ReactNode }) {
  const Tag = as
  return <Tag className="settings-list">{children}</Tag>
}
