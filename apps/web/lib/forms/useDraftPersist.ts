'use client'

// 비침습 임시저장 — 상태를 소유하지 않고 값만 영속/복원(복잡한 폼·Tiptap 등 state machine 보존).
// useFormCore가 부적합한 곳(주간보고 등)에서 draft persistence만 필요할 때. draft-core(SSOT) 재사용.
import { useState, useEffect, useRef } from 'react'
import { draftKey, serializeDraft, parseDraft, draftDiffers, DEFAULT_TTL_MS } from './draft-core'

interface Opts<T> {
  formId: string
  recordId?: string
  userId?: string
  value: T              // 폼이 소유한 현재 값(읽기)
  initial: T            // 비교 기준(복원 배너 노출 판단)
  onRestore: (v: T) => void
  enabled?: boolean
  ttlMs?: number
  debounceMs?: number
}

export function useDraftPersist<T>(opts: Opts<T>) {
  const { formId, recordId = 'new', userId = '', value, initial, onRestore, enabled = true, ttlMs = DEFAULT_TTL_MS, debounceMs = 600 } = opts
  const key = draftKey(userId, formId, recordId)
  const [hasDraft, setHasDraft] = useState(false)
  const pending = useRef<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 마운트(또는 recordId 변경) 시 복원 검사
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const env = parseDraft<T>(window.localStorage.getItem(key), ttlMs, Date.now())
    if (env && draftDiffers(env.value, initial)) { pending.current = env.value; setHasDraft(true) }
    else { pending.current = null; setHasDraft(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // 값 변경 → 디바운스 저장
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try { window.localStorage.setItem(key, serializeDraft(value, Date.now())) } catch { /* */ }
    }, debounceMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, key, enabled])

  function clear() { if (typeof window !== 'undefined') { try { window.localStorage.removeItem(key) } catch { /* */ } } setHasDraft(false); pending.current = null }
  function restore() { if (pending.current !== null) onRestore(pending.current); setHasDraft(false) }
  function discard() { clear() }

  return { hasDraft, restore, discard, clear }
}
