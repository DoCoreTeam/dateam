'use client'

// lib/crm/ui/attention-signal.ts — 「주의 대상이 바뀌었다」 신호 (SSOT)
//
// ## 왜 필요한가 (실측 2026-08-31)
//
// 같은 사실을 **세 곳이 따로 세고 있었다**:
//   ① 사이드바 「오늘 3」 — `(crm)/layout.tsx` 가 **서버에서** 센다
//   ② 알림 벨의 숫자   — `AttentionBell` 이 **자기 state 로** 센다
//   ③ 오늘 화면의 목록 — `TodayClient` 가 **자기 state 로** 센다
//
// 셋이 서로를 모르니, 할 일을 끝내도 ③만 줄고 ①②는 그대로였다.
// 사용자가 겪은 것이 정확히 그것이다 —
// "다 정리하고도 한참 뒤에 사라지던데? 알림도 다시 알림아이콘을 눌러야 사라지고?"
//
// ①은 **레이아웃**이라 클라이언트 이동으로는 다시 그려지지 않는다(`router.refresh()` 가 필요하다).
// ②는 열 때만 다시 셌다. 그래서 눌러야 사라졌다.
//
// ## 그래서 신호 하나로 모은다
//
// 개수를 바꾸는 쪽은 `emitAttentionChanged()` 를 부르고, 세는 쪽은 전부 듣는다.
// 프로바이더를 새로 두지 않는다 — 세는 곳이 레이아웃·헤더·본문에 흩어져 있어
// 공통 조상이 없다. window 이벤트가 그 셋을 한 번에 닿는 유일한 자리다.
//
// 가드: lib/crm/ui/attention-signal.test.ts

import { useEffect } from 'react'

export const ATTENTION_CHANGED = 'crm:attention-changed'

/**
 * 주의 대상 개수를 **바꾼 직후** 부른다 — 할 일 완료·삭제·생성, 제안 반영·보류 등.
 *
 * 서버 응답을 받은 **뒤에** 부른다. 먼저 부르면 아직 안 바뀐 값을 다시 세게 된다.
 */
export function emitAttentionChanged(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ATTENTION_CHANGED))
}

/** 개수를 세는 쪽이 듣는다. 신호가 오면 다시 센다. */
export function useAttentionChanged(onChange: () => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const h = () => onChange()
    window.addEventListener(ATTENTION_CHANGED, h)
    return () => window.removeEventListener(ATTENTION_CHANGED, h)
  }, [onChange])
}
