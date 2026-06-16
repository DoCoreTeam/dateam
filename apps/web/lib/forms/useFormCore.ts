'use client'

// 전영역 공통 폼 코어 — 임시저장(새로고침 유지) + Undo/Redo(Ctrl/Cmd+Z) 한 줄 적용.
// 모든 입력면이 import. SSOT. 민감정보 제외. SSR 안전(마운트 후 복원).
import { useState, useEffect, useRef, useCallback } from 'react'
import { draftKey, serializeDraft, parseDraft, draftDiffers, DEFAULT_TTL_MS } from './draft-core'
import { initHistory, pushHistory, undo as undoH, redo as redoH, canUndo as cu, canRedo as cr, resetHistory, type History } from './history-core'

interface Opts<T> {
  formId: string
  recordId?: string
  userId?: string
  initial: T
  enabled?: boolean          // 수정권한 없거나 비활성 시 false
  exclude?: string[]         // 민감필드(비밀번호 등) draft 제외
  ttlMs?: number
  debounceMs?: number
  maxHistory?: number
  /** 단축키 스코프 — 이 ref 내부에 포커스 있을 때만 Ctrl+Z 가로챔. 없으면 비활성(안전) */
  scopeRef?: React.RefObject<HTMLElement>
}

export interface FormCore<T> {
  value: T
  set: (next: T) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  hasDraft: boolean          // 복원 배너 노출
  restore: () => void
  discard: () => void
  clear: () => void          // 저장 성공 시 호출 (draft 삭제)
}

export function useFormCore<T>(opts: Opts<T>): FormCore<T> {
  const { formId, recordId = 'new', userId = '', initial, enabled = true, exclude = [], ttlMs = DEFAULT_TTL_MS, debounceMs = 500, maxHistory = 100, scopeRef } = opts
  const key = draftKey(userId, formId, recordId)
  const [hist, setHist] = useState<History<T>>(() => initHistory(initial))
  const [hasDraft, setHasDraft] = useState(false)
  const pendingDraft = useRef<T | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 마운트 후 draft 복원 검사(SSR 안전 — 클라에서만 localStorage 접근)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const env = parseDraft<T>(window.localStorage.getItem(key), ttlMs, Date.now())
    if (env && draftDiffers(env.value, initial, exclude)) {
      pendingDraft.current = env.value
      setHasDraft(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback((next: T) => {
    setHist((h) => pushHistory(h, next, maxHistory))
  }, [maxHistory])

  // value 변경 → 디바운스 localStorage 저장
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      try { window.localStorage.setItem(key, serializeDraft(hist.present, Date.now(), exclude)) } catch { /* quota 등 무시 */ }
    }, debounceMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist.present, key, enabled])

  // 탭 닫힘/새로고침 직전 flush(디바운스 미반영분 보존)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return
    const onUnload = () => { try { window.localStorage.setItem(key, serializeDraft(hist.present, Date.now(), exclude)) } catch { /* */ } }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hist.present, key, enabled])

  const clear = useCallback(() => {
    if (typeof window !== 'undefined') { try { window.localStorage.removeItem(key) } catch { /* */ } }
    setHasDraft(false); pendingDraft.current = null
  }, [key])

  const restore = useCallback(() => {
    if (pendingDraft.current !== null) setHist(resetHistory(pendingDraft.current))
    setHasDraft(false)
  }, [])

  const discard = useCallback(() => { clear() }, [clear])

  const doUndo = useCallback(() => setHist((h) => undoH(h)), [])
  const doRedo = useCallback(() => setHist((h) => redoH(h)), [])

  // 단축키 — scopeRef 내부 포커스 시에만. IME 조합 중·contenteditable(Tiptap) 제외.
  useEffect(() => {
    if (!enabled || !scopeRef) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k !== 'z' && k !== 'y') return
      if (e.isComposing) return  // 한글 조합 중 금지
      const el = document.activeElement as HTMLElement | null
      if (!el || !scopeRef.current?.contains(el)) return
      if (el.isContentEditable) return  // Tiptap 등 자체 undo에 위임
      const isRedo = k === 'y' || (k === 'z' && e.shiftKey)
      e.preventDefault()
      if (isRedo) doRedo(); else doUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled, scopeRef, doUndo, doRedo])

  return {
    value: hist.present, set, undo: doUndo, redo: doRedo,
    canUndo: cu(hist), canRedo: cr(hist), hasDraft, restore, discard, clear,
  }
}
