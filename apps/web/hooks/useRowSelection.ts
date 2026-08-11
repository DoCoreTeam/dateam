'use client'

/**
 * 목록 다중선택 상태 SSOT — 체크박스 목록(선택 삭제/선택 복구)을 쓰는 모든 화면이 공유한다.
 *
 * 왜 훅으로 두는가: "선택 → 일괄 처리"는 화면마다 같은 함정을 갖는다.
 *  (a) 검색·필터·휴지통 전환으로 **화면에서 사라진 행이 선택으로 남아** 보이지 않는 데이터를 지우는 사고
 *  (b) 전체선택 체크박스의 부분선택(indeterminate) 상태 누락
 * → 여기서 한 번만 해결하고 각 목록은 rows만 넘긴다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

export interface RowSelection {
  /** 현재 화면에 보이는 행 중 선택된 id (렌더 순서 유지) */
  selectedIds: string[]
  count: number
  isSelected: (id: string) => boolean
  toggle: (id: string) => void
  /** 전체선택 ↔ 전체해제 (현재 화면에 보이는 행 기준) */
  toggleAll: () => void
  clear: () => void
  /** 선택에서 특정 id들만 제거 — 일괄 처리 후 부분 성공분 반영용 */
  remove: (ids: readonly string[]) => void
  allSelected: boolean
  someSelected: boolean
}

export function useRowSelection<T>(rows: readonly T[], getId: (row: T) => string): RowSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set<string>())

  const visibleIds = useMemo(() => rows.map(getId), [rows, getId])
  const visibleKey = visibleIds.join('|')

  // 목록이 바뀌면 사라진 id를 선택에서 떨군다(위 (a) 사고 방지).
  // 변화가 없으면 같은 Set을 그대로 반환 → 리렌더 루프 없음.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(visibleIds.filter((id) => prev.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey])

  const selectedIds = useMemo(() => visibleIds.filter((id) => selected.has(id)), [visibleIds, selected])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const allSelected = visibleIds.length > 0 && selectedIds.length === visibleIds.length

  const toggleAll = useCallback(() => {
    setSelected(() => (allSelected ? new Set<string>() : new Set(visibleIds)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, visibleKey])

  const clear = useCallback(() => setSelected(new Set<string>()), [])

  const remove = useCallback((ids: readonly string[]) => {
    setSelected((prev) => {
      const next = new Set(prev)
      ids.forEach((id) => next.delete(id))
      return next
    })
  }, [])

  return {
    selectedIds,
    count: selectedIds.length,
    isSelected,
    toggle,
    toggleAll,
    clear,
    remove,
    allSelected,
    someSelected: selectedIds.length > 0 && !allSelected,
  }
}
