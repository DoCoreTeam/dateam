import { useEffect, type RefObject } from 'react'

/**
 * 대화상자 안에 **키보드 포커스를 가둔다.**
 *
 * **왜**: 화면을 덮는 오버레이인데 Tab 이 뒤쪽 화면으로 빠져나가면, 키보드·스크린리더
 * 사용자는 «닫히지도 않았는데 사라진» 상태를 만난다 — 어디를 조작하고 있는지 알 수 없다.
 * (실측 v0.7.679: 캘린더 날짜 패널 `.day-panel` 이 `role="dialog" aria-modal="true"` 를
 *  선언해 놓고 포커스는 뒤쪽 달력 30칸으로 그대로 빠져나갔다. 선언과 동작이 달랐다.)
 *
 * `aria-modal="true"` 는 **약속**이다 — 이 훅이 그 약속을 실제로 지키게 한다.
 * 두 벌이 되지 않도록 `NbModal` 같은 공용 부품이 내부에서 이 훅을 쓰고, 화면은 상속만 한다.
 *
 * 하는 일은 셋뿐이다.
 *   ① 열릴 때 첫 초점을 컨테이너 안으로 옮긴다
 *   ② Tab / Shift+Tab 이 컨테이너 밖으로 못 나가게 순환시킨다
 *   ③ 닫힐 때 **원래 있던 곳으로 초점을 돌려준다**(이게 없으면 닫은 뒤 Tab 이 문서 맨 앞으로 튄다)
 */

/** 초점을 받을 수 있는 것들 — `disabled`·`tabindex="-1"`·숨김은 제외한다 */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

export interface FocusTrapOptions {
  /** false 면 아무것도 하지 않는다(중첩 대화상자에서 부모를 잠시 재우는 용도) */
  enabled?: boolean
  /**
   * 열릴 때 초점을 안으로 옮길지. 기본 true.
   * 우클릭 메뉴처럼 **자기 방식으로 초점을 다루는** 부품은 false 로 끄고 직접 옮긴다.
   */
  autoFocus?: boolean
}

export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  { enabled = true, autoFocus = true }: FocusTrapOptions = {},
) {
  useEffect(() => {
    if (!enabled) return
    const root = ref.current
    if (!root) return

    // 닫힌 뒤 돌아갈 자리 — 열기 전의 초점이다
    const previouslyFocused = document.activeElement as HTMLElement | null

    if (autoFocus) {
      const first = focusableWithin(root)[0]
      if (first) first.focus()
      else {
        // 누를 것이 하나도 없는 대화상자(읽기 전용)도 초점은 안에 있어야 한다
        root.setAttribute('tabindex', '-1')
        root.focus()
      }
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const items = focusableWithin(root)
      if (items.length === 0) {
        // 안에 아무것도 없으면 밖으로 나가지 못하게 막는 것으로 충분하다
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (!root.contains(active)) {
        // 밖에서 들어오는 Tab — 안의 처음(또는 끝)으로 데려온다
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      // 초점 복원 — 이미 다른 곳으로 옮겨 갔으면 건드리지 않는다(사용자 의도 존중)
      if (previouslyFocused && document.body.contains(previouslyFocused)) {
        const active = document.activeElement
        if (!active || active === document.body || root.contains(active)) {
          previouslyFocused.focus()
        }
      }
    }
  }, [ref, enabled, autoFocus])
}
