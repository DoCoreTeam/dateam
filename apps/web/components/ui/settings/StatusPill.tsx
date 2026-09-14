// 상태 배지 — 뜻은 다섯뿐이고 색은 화면이 고르지 않는다.
//
// 예전에는 관리자 카드가 인라인 style 로 초록 배경을 칠하고, 영업 CRM 은 NbBadge 를 쓰고,
// 콘텐츠 인텔리전스는 status-pill 를 썼다. 같은 「연결됨」이 세 화면에서 세 가지로 보였다.
// 뜻을 고르면 색은 globals.css 가 정한다.

import type { ReactNode } from 'react'

/** 다섯 뜻. 여기 없는 뜻은 없다 — 새 색을 만들지 말고 이 중에서 고른다 */
export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral'

const TONE_CLASS: Record<StatusTone, string> = {
  ok: 'status-pill status-pill-ok',
  warn: 'status-pill status-pill-warn',
  danger: 'status-pill status-pill-danger',
  info: 'status-pill status-pill-info',
  neutral: 'status-pill status-pill-neutral',
}

interface Props {
  tone: StatusTone
  /** 마우스를 올렸을 때 나오는 말 — 배지가 줄인 사실을 그 자리에서 밝힌다 */
  title?: string
  children: ReactNode
}

export default function StatusPill({ tone, title, children }: Props) {
  return <span className={TONE_CLASS[tone]} title={title}>{children}</span>
}
