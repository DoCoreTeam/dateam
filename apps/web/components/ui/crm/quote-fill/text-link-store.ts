/**
 * 글 줄과 표 항목의 짝 — 편집기와 표가 같은 값을 본다
 *
 * 편집기에서 커서가 선 줄(`active`)의 항목이 표에서 표시되고,
 * 표 항목의 「글 N째 줄」을 누르면 편집기가 그 줄을 고른다(`reveal`).
 * 모달의 상태에 두지 않는 이유: 모달이 750줄이라 칸 하나 더 들고 다니게 하면 모든 줄이 다시 그려진다.
 */

import { useSyncExternalStore } from 'react'

interface LinkState { active: number | null; reveal: { line: number; seq: number } | null }

let state: LinkState = { active: null, reveal: null }
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export const textLink = {
  setActive(line: number | null): void {
    if (state.active === line) return
    state = { ...state, active: line }
    emit()
  },
  reveal(line: number): void {
    state = { ...state, active: line, reveal: { line, seq: (state.reveal?.seq ?? 0) + 1 } }
    emit()
  },
  reset(): void {
    state = { active: null, reveal: null }
    emit()
  },
}

function subscribe(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

export function useTextLink(): LinkState {
  return useSyncExternalStore(subscribe, () => state, () => state)
}
