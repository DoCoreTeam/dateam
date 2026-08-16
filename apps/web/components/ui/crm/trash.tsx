'use client'

// 휴지통 보기 — 회사·인물·딜이 함께 쓴다 (dacrm)
//
// 왜 공용인가: 세 목록이 같은 약속을 한다 — "삭제하면 30일 동안 되돌릴 수 있다".
// 화면마다 따로 만들면 어디는 되살릴 수 있고 어디는 없는데 문구는 같아진다(§2-5).
//
// 휴지통은 **별도 화면이 아니라 필터**다. 화면을 나누면 지운 것을 메뉴에서 찾아야 하고,
// 검색·정렬 도구를 또 한 벌 만들게 된다.

import { useCallback, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import type { ColumnDef, ListFilterDef } from '@/components/ui/list/types'
import type { ListQuery } from '@/lib/ui/list-query'

export const TRASH_FILTER: ListFilterDef = {
  key: 'trash',
  label: '보기',
  options: [{ value: '1', label: '휴지통' }],
}

/** 목록 표준의 필터 선언에 넣을 키 — 화면이 이걸 빠뜨리면 URL 이 무시된다 */
export const TRASH_FILTER_KEYS = ['trash'] as const

export function isTrashView(query: ListQuery): boolean {
  return query.filters?.trash === '1'
}

/**
 * 되살리기 동작.
 *
 * 실패를 조용히 삼키지 않는다 — 되살렸다고 생각했는데 그대로면 사용자는 데이터를 잃었다고 믿는다.
 */
export function useRestore(endpointBase: string, onDone: () => void) {
  const [error, setError] = useState<string | null>(null)

  const restore = useCallback(async (id: string) => {
    setError(null)
    try {
      const res = await fetch(`${endpointBase}/${id}/restore`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error?.message ?? '되살리지 못했습니다.')
        return
      }
      onDone()
    } catch {
      setError('되살리지 못했습니다. 잠시 후 다시 시도해 주세요.')
    }
  }, [endpointBase, onDone])

  return { restore, restoreError: error }
}

/** 휴지통일 때만 붙이는 마지막 칸 */
export function restoreColumn<T extends { id: string }>(
  restore: (id: string) => void,
): ColumnDef<T> {
  return {
    key: 'restore',
    header: '되살리기',
    noLabel: true,
    // 행 클릭(상세 열기)과 섞이지 않게 전파를 멈춘다
    cell: (row) => (
      <span onClick={(e) => { e.preventDefault(); e.stopPropagation() }}>
        <NbButton variant="ghost" onClick={() => restore(row.id)}>
          <RotateCcw size={14} /> 되살리기
        </NbButton>
      </span>
    ),
  }
}

/** 휴지통 빈 상태 문구 — 세 화면이 같은 말을 한다 */
export const TRASH_EMPTY = {
  title: '휴지통이 비어 있어요',
  description: '삭제한 항목은 30일 동안 여기에 남고, 그 뒤 자동으로 정리됩니다.',
} as const
