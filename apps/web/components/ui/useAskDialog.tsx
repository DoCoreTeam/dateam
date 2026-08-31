'use client'

// components/ui/useAskDialog.tsx — 묻고 답을 기다리는 대화상자 (SSOT)
//
// **왜 만들었나**: 화면 10곳이 `window.prompt` · `window.confirm` · `window.alert` 을 쓰고 있었다.
// 브라우저 기본 대화상자는 ① 우리 디자인 밖이고 ② 테마·글꼴·버튼 배치가 제각각이며
// ③ **페이지의 다른 동작을 통째로 막는다**(자동화·다른 탭 포함).
// 무엇보다 이 제품의 다른 모달과 **말투도 배치도 다르다** — 같은 일을 하는데 다르게 보인다(§2-5).
//
// **`ConfirmDeleteDialog` 와 다른 것이다.** 그쪽은 «되돌릴 수 없는 삭제» 전용이라
// 서버가 센 영향(무엇이 함께 사라지나)을 받아 보여 준다. 이건 그보다 얕은 자리 —
// 이름 한 칸을 묻거나, 예/아니오를 묻거나, 알리기만 하는 자리다.
//
// **Promise 로 답을 준다.** 호출부가 `if (!await ask.confirm(...)) return` 처럼
// 원래 쓰던 모양을 그대로 쓸 수 있어야 10곳을 안전하게 옮길 수 있다.

import { useCallback, useRef, useState } from 'react'
import NbModal from '@/components/ui/nb/NbModal'
import NbButton from '@/components/ui/nb/NbButton'
import { ACTION } from '@/lib/terms'
import styles from './ask-dialog.module.css'

type Kind = 'text' | 'confirm' | 'notice'

interface AskState {
  kind: Kind
  title: string
  body?: string
  /** 입력형일 때의 라벨·기본값·안내 */
  label?: string
  defaultValue?: string
  placeholder?: string
  /** 확정 버튼의 말. 없으면 종류에 맞는 기본값 */
  confirmLabel?: string
  /** 확정이 위험한 일인가 — 버튼이 위험색이 된다 */
  danger?: boolean
}

export interface AskApi {
  /** 한 칸 묻기. 취소하면 `null` */
  text: (o: Omit<AskState, 'kind'>) => Promise<string | null>
  /** 예/아니오. 취소하면 `false` */
  confirm: (o: Omit<AskState, 'kind'>) => Promise<boolean>
  /** 알리기만. 닫으면 끝 */
  notice: (o: Omit<AskState, 'kind'>) => Promise<void>
}

/**
 * 쓰는 법:
 *
 * ```tsx
 * const { ask, dialog } = useAskDialog()
 * // …
 * if (!await ask.confirm({ title: '이 단계를 삭제할까요?' })) return
 * return <>{…}{dialog}</>
 * ```
 *
 * `dialog` 를 렌더하지 않으면 아무것도 안 뜬다 — 그래서 **반드시 함께 반환한다**.
 */
export function useAskDialog(): { ask: AskApi; dialog: React.ReactNode } {
  const [state, setState] = useState<AskState | null>(null)
  const [value, setValue] = useState('')
  // 답을 기다리는 쪽 — 열 때 담아 두고 닫을 때 부른다
  const resolveRef = useRef<((v: unknown) => void) | null>(null)

  const open = useCallback((next: AskState): Promise<unknown> => {
    setState(next)
    setValue(next.defaultValue ?? '')
    return new Promise((resolve) => { resolveRef.current = resolve })
  }, [])

  /** 닫기는 **한 곳**을 지난다 — 답을 안 주고 닫히면 기다리는 쪽이 영영 멈춘다 */
  const close = useCallback((answer: unknown) => {
    const r = resolveRef.current
    resolveRef.current = null
    setState(null)
    r?.(answer)
  }, [])

  const ask: AskApi = {
    text: (o) => open({ ...o, kind: 'text' }) as Promise<string | null>,
    confirm: (o) => open({ ...o, kind: 'confirm' }) as Promise<boolean>,
    notice: (o) => open({ ...o, kind: 'notice' }) as Promise<void>,
  }

  const cancelAnswer = (kind: Kind): unknown =>
    kind === 'text' ? null : kind === 'confirm' ? false : undefined

  const dialog = state ? (
    <NbModal
      title={state.title}
      onClose={() => close(cancelAnswer(state.kind))}
      maxWidth={440}
      footer={
        // 확정은 오른쪽 끝, 취소는 그 왼쪽 (§2-3-2 L-6)
        <div className={styles.foot}>
          {state.kind !== 'notice' && (
            <NbButton variant="ghost" onClick={() => close(cancelAnswer(state.kind))}>
              {ACTION.cancel}
            </NbButton>
          )}
          <NbButton
            variant={state.danger ? 'danger' : 'primary'}
            onClick={() => close(
              state.kind === 'text' ? (value.trim() || null)
                : state.kind === 'confirm' ? true
                  : undefined,
            )}
            disabled={state.kind === 'text' && value.trim().length === 0}
          >
            {state.confirmLabel ?? (state.kind === 'notice' ? ACTION.close : ACTION.confirm)}
          </NbButton>
        </div>
      }
    >
      <div className={styles.body}>
        {state.body && <p className={styles.text}>{state.body}</p>}
        {state.kind === 'text' && (
          <div className={styles.field}>
            {state.label && <label className="label" htmlFor="ask-value">{state.label}</label>}
            <input
              id="ask-value"
              className="input-field"
              value={value}
              autoFocus
              placeholder={state.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                // 엔터로 확정 — 한 칸짜리라 마우스로 옮겨 갈 이유가 없다
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && value.trim()) {
                  close(value.trim())
                }
              }}
            />
          </div>
        )}
      </div>
    </NbModal>
  ) : null

  return { ask, dialog }
}
