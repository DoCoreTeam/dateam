'use client'

import { useState, useEffect, useCallback } from 'react'

// 공용 그룹 접기 상태 훅 (가격표/시장/재고/고객가 공통)
// docs 01 §3 — 중복 collapse 로직 통합. 기본 전부 접힘 1회 초기화.

export function useCollapsibleGroups(allKeys: string[], defaultCollapsed = true) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    if (initialized || allKeys.length === 0) return
    setCollapsed(defaultCollapsed ? new Set(allKeys) : new Set())
    setInitialized(true)
  }, [allKeys, initialized, defaultCollapsed])

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const isCollapsed = useCallback((key: string) => collapsed.has(key), [collapsed])

  const expandAll = useCallback(() => setCollapsed(new Set()), [])
  const collapseAll = useCallback(() => setCollapsed(new Set(allKeys)), [allKeys])

  return { isCollapsed, toggle, expandAll, collapseAll }
}
