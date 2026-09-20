'use client'

// components/ui/settings/SettingsCards.tsx — 카드로 채운 설정 그릇
//
// SettingsPanel 은 상태를 쥐지 않는다(어느 탭인지·무엇을 찾는지는 화면이 안다).
// 그런데 영업 CRM 설정과 RFP 관리자는 **서버 화면**이라 상태를 쥘 수 없고
// 함수를 아래로 내려보낼 수도 없다.
//
// 그래서 여기가 그 상태를 대신 쥔다. 서버 화면은 카드 목록만 넘긴다 —
// 무엇을 담을지는 화면이 정하고, 어떻게 고르고 찾는지는 그릇이 정한다.
// 화면마다 클라이언트 껍데기를 하나씩 만들면 그릇이 다시 갈린다(그게 처음 갈린 방식이다).

import { useState, type ReactNode } from 'react'
import SettingsPanel, { type SettingsGroup } from './SettingsPanel'

export interface SettingsCardEntry {
  /** 카드 고유 이름. 어느 탭에 있는지와 짝이 맞는지는 화면의 SSOT 가 단정한다 */
  id: string
  /** 이 카드가 속한 분류 */
  tab: string
  /** 검색에 걸리는 말 — 카드 제목 */
  title: string
  /** 제목에 없지만 사람이 찾을 법한 말 (예: 「견적」으로 「거래 조건」을 찾는다) */
  keywords?: string[]
  content: ReactNode
}

interface Props {
  groups: SettingsGroup[]
  cards: SettingsCardEntry[]
  /** 주소에 분류가 없을 때 열 탭. 안 주면 첫 탭 */
  defaultTab?: string
}

export default function SettingsCards({ groups, cards, defaultTab }: Props) {
  const first = defaultTab && groups.some((g) => g.id === defaultTab) ? defaultTab : groups[0]?.id ?? ''
  const [tab, setTab] = useState(first)
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  // 검색 중에는 탭을 무시한다 — 어느 분류에 있는지 모를 때가 검색을 쓰는 때다
  const visible = q
    ? cards.filter((c) => [c.title, ...(c.keywords ?? [])].some((w) => w.toLowerCase().includes(q)))
    : cards.filter((c) => c.tab === tab)

  return (
    <SettingsPanel
      groups={groups}
      activeId={tab}
      onSelect={setTab}
      query={query}
      onQueryChange={setQuery}
      isEmpty={visible.length === 0}
    >
      {visible.map((c) => <div key={c.id}>{c.content}</div>)}
    </SettingsPanel>
  )
}
