// Undo/Redo 순수 히스토리 — 스냅샷 스택(past/present/future) + maxHistory 캡. (브라우저 의존 없음, 단위테스트)
// 훅(useUndoable)이 이 reducer를 씀. SSOT.

export interface History<T> { past: T[]; present: T; future: T[] }

export function initHistory<T>(present: T): History<T> {
  return { past: [], present, future: [] }
}

/** 새 값 push. present가 같으면 무시(중복 스냅샷 방지). future는 비움(분기). maxHistory 초과 시 가장 오래된 것 버림. */
export function pushHistory<T>(h: History<T>, next: T, maxHistory = 100, eq: (a: T, b: T) => boolean = Object.is): History<T> {
  if (eq(h.present, next)) return h
  const past = [...h.past, h.present]
  while (past.length > maxHistory) past.shift()
  return { past, present: next, future: [] }
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  const prev = h.past[h.past.length - 1]
  return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] }
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const next = h.future[0]
  return { past: [...h.past, h.present], present: next, future: h.future.slice(1) }
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0
export const canRedo = <T>(h: History<T>) => h.future.length > 0

/** draft 복원 시 히스토리 리셋(복원값이 새 시작점). */
export function resetHistory<T>(present: T): History<T> {
  return initHistory(present)
}
