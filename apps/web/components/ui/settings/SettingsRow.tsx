// 설정 카드 안의 한 줄 — 왼쪽에 무엇, 가운데 값과 설명, 오른쪽에 행동.
//
// 자리의 축을 부품이 정한다. 화면이 매번 grid 를 짜면 같은 종류의 줄이 화면마다 다른 순서로 앉는다.

import type { ReactNode } from 'react'

interface Props {
  /** 왼쪽 — 아이콘이나 이름표 */
  lead?: ReactNode
  /** 가운데 — 값과 보조 설명 */
  children: ReactNode
  /** 오른쪽 — 저장 해제 연결확인 같은 행동 */
  action?: ReactNode
  /**
   * 어떤 태그로 그릴지. 기본 div.
   * 목록 안의 한 줄이면 li 여야 한다 — ul 안에 div 를 넣으면 읽어 주는 기계가 「목록 3개」를
   * 세지 못한다
   */
  as?: 'div' | 'li'
}

export default function SettingsRow({ lead, children, action, as = 'div' }: Props) {
  const Tag = as
  return (
    <Tag className="settings-row">
      {lead ?? <span aria-hidden="true" />}
      <div className="min-w-0">{children}</div>
      {action ?? <span aria-hidden="true" />}
    </Tag>
  )
}
