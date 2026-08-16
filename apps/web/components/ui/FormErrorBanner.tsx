// components/ui/FormErrorBanner.tsx — 폼 안에서 실패를 알리는 한 줄 (dacrm T1-02 신설)
//
// 왜 부품인가:
//   ErrorState 는 **화면 전체**가 실패했을 때 쓴다(목록을 못 불러옴 등).
//   폼 안의 실패는 다르다 — 사용자가 입력한 값은 그대로 남아 있어야 하고,
//   메시지는 저장 버튼 근처에서 "무엇을 고쳐야 하는지"를 말해야 한다.
//   이 자리를 화면마다 인라인으로 그리면 색·여백·역할이 갈린다(실측: 이미 3곳이 제각각).
//
// 규칙: 서버가 준 문장을 그대로 보여 준다. 뭉뚱그리면 사용자가 무엇을 할지 알 수 없다
//   — 특히 409(다른 사람이 먼저 수정)와 중복은 다음 행동이 서로 다르다.

import type { ReactNode } from 'react'

interface Props {
  /** 사용자에게 보일 문장. null 이면 아무것도 그리지 않는다 */
  message: string | null | undefined
  /** 원인 코드 — 문의할 때 이것만 있으면 추적된다 */
  code?: string
  /** 보조 안내·다시 시도 버튼 등 */
  children?: ReactNode
}

export default function FormErrorBanner({ message, code, children }: Props) {
  if (!message) return null
  return (
    <div role="alert" className="form-error-banner">
      <span>{message}</span>
      {code && <code className="form-error-banner__code">{code}</code>}
      {children}
    </div>
  )
}
