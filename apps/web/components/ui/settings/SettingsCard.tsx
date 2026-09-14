// 설정 카드 — 관리자와 콘텐츠 인텔리전스와 영업 CRM 이 같은 골격을 쓴다.
//
// 테두리 두께와 안여백과 모서리는 globals.css 의 .settings-card 한 곳에서 온다.
// 카드가 자기 몫의 여백을 스스로 갖는다 — 쓰는 쪽이 바깥에서 margin 을 더하지 않아도 된다.

import type { ReactNode } from 'react'
import StatusPill, { type StatusTone } from './StatusPill'
import FieldNote from './FieldNote'

interface Props {
  title: ReactNode
  /** 제목 아래 한 줄 — 이 설정이 무엇을 바꾸는지 */
  description?: ReactNode
  /** 오른쪽 위 상태. 뜻만 고르고 색은 고르지 않는다 */
  status?: { tone: StatusTone; label: ReactNode; title?: string }
  /** 제목 줄 오른쪽에 놓을 것이 상태 배지가 아닐 때 (예: 토글) */
  headerAction?: ReactNode
  /**
   * 제목의 단계. 기본 3.
   * 카드가 페이지의 큰 덩어리면 2, 그 안의 한 줄이면 3 — 읽어 주는 기계가 차례를 만든다
   */
  headingLevel?: 2 | 3 | 4
  children?: ReactNode
}

export default function SettingsCard({
  title, description, status, headerAction, headingLevel = 3, children,
}: Props) {
  const Heading = `h${headingLevel}` as 'h2' | 'h3' | 'h4'
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <div className="min-w-0">
          <Heading className="settings-card-title">{title}</Heading>
          {description ? <FieldNote>{description}</FieldNote> : null}
        </div>
        {status ? (
          <StatusPill tone={status.tone} title={status.title}>{status.label}</StatusPill>
        ) : headerAction}
      </div>
      {children ? <div className="settings-card-body">{children}</div> : null}
    </section>
  )
}
