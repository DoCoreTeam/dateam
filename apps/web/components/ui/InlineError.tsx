// components/ui/InlineError.tsx — 인라인 오류 문구 SSOT
//
// 왜: 폼·버튼 옆에 붙는 한 줄짜리 오류를 화면마다 직접 그리고 있었다.
//   v0.7.456 실측 56곳 · 글자 크기 8종(`var(--fs-base)` `--fs-sm` `--fs-xs` `--fs-2xs`
//   `0.8rem` 그리고 토큰이 아닌 raw `12` `10.5`)이 동시에 살아 있었다.
//   같은 성격의 UI가 매번 다르게 보이면 사용자는 "다른 기능"으로 읽는다(CLAUDE.md §2-5).
//
// `ErrorState`와 무엇이 다른가:
//   - `ErrorState` = **화면/영역 단위** 실패. 원인 코드 · 다시 시도 · 도움 링크를 갖춘 블록.
//   - `InlineError` = **입력 하나·동작 하나**의 실패. 한 줄, 컨트롤 바로 옆.
//   둘을 섞으면 폼 필드 밑에 '다시 시도' 버튼이 생기는 식으로 어긋난다.
//
// 모양은 `.inline-error*` 클래스(globals.css)가 갖는다 — 화면이 fontSize를 넘기지 못하게 하는 게 목적이다.

import type { ReactNode } from 'react'

export interface InlineErrorProps {
  /** 표시할 오류 문구. falsy면 아무것도 렌더하지 않는다(호출부 `{err && …}` 중복 제거) */
  children?: ReactNode
  /** 표·버튼 줄처럼 세로 공간이 빠듯한 자리 — 한 단계 작게 */
  compact?: boolean
  /** 위쪽 여백이 필요한 자리(폼 마지막 줄 등) */
  spaced?: boolean
  /** 옅은 붉은 상자로 — 폼 전체 저장 실패처럼 **놓치면 안 되는** 오류 */
  banner?: boolean
  /** 배너를 사용자가 닫을 수 있게 한다 — 계속 남는 오류(드래그 실패 등)에 필요 */
  onDismiss?: () => void
}

export default function InlineError({
  children, compact = false, spaced = false, banner = false, onDismiss,
}: InlineErrorProps) {
  if (!children) return null
  const cls = [
    'inline-error',
    compact ? 'inline-error--compact' : '',
    spaced ? 'inline-error--spaced' : '',
    banner ? 'inline-error--banner' : '',
  ].filter(Boolean).join(' ')

  return (
    <span role="alert" className={cls}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} aria-label="오류 닫기" className="inline-error-dismiss">
          ×
        </button>
      )}
    </span>
  )
}
