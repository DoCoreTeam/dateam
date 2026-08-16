'use client'

// lib/ci/use-delete.ts — CI 삭제 흐름 SSOT (미리보기 → 확인 → 삭제)
//
// 왜 훅으로 두나: 삭제 자리가 8곳이 넘는데 화면마다
//   "영향 조회 → 상태 관리 → 실패 처리 → 목록 갱신"을 다시 짜면 반드시 어긋난다.
//   특히 **실패를 조용히 삼키는 화면**이 하나만 생겨도 사용자는 지운 줄 알고 떠난다.
//
// 삭제는 진짜 삭제라 되돌리기가 없다 → 확인 단계가 유일한 안전장치다.
// 이 훅은 확인 없이 지우는 길을 열어 두지 않는다(`ask` 없이는 `confirm`이 아무 일도 안 한다).

import { useCallback, useState } from 'react'
import type { ApiResponse } from '@/lib/ci/contracts'
import type { DeleteImpactView } from '@/components/ui/ConfirmDeleteDialog'

export type CiDeleteKind =
  | 'content' | 'channel' | 'board' | 'boardItem'
  | 'idea' | 'brief' | 'editPlan' | 'publication'

/** 종류별 삭제 주소. 한 곳에만 둔다 — 화면이 주소를 조립하면 오타가 조용히 404가 된다. */
function endpointOf(kind: CiDeleteKind, id: string, extra?: { boardId?: string }): string {
  switch (kind) {
    case 'content': return `/api/ci/contents/${id}`
    case 'channel': return `/api/ci/channels/${id}`
    case 'board': return `/api/ci/boards/${id}`
    case 'boardItem': return `/api/ci/boards/${extra?.boardId ?? ''}/items?itemId=${id}`
    case 'idea': return `/api/ci/ideas/${id}`
    case 'brief': return `/api/ci/briefs/${id}`
    case 'editPlan': return `/api/ci/edit-plans?id=${id}`
    case 'publication': return `/api/ci/publications/${id}`
  }
}

export interface PendingDelete {
  kind: CiDeleteKind
  id: string
  boardId?: string
  /** 대화상자 제목 */
  title: string
}

/**
 * `onDone`은 **무엇을 지웠는지** 받는다.
 * 호출부가 `del_.pending`을 되읽으면 이미 비워지는 중이라 종류를 알 수 없다 —
 * 기획을 지웠으면 목록으로, 편집안을 지웠으면 그 자리에서 새로고침처럼
 * **종류에 따라 다음 행동이 갈리는 화면**이 있으므로 값으로 넘긴다.
 */
export function useCiDelete(workspaceId: string, onDone?: (deleted: PendingDelete) => void) {
  const [pending, setPending] = useState<PendingDelete | null>(null)
  const [impact, setImpact] = useState<DeleteImpactView | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const ask = useCallback(async (next: PendingDelete) => {
    setPending(next); setImpact(null); setErrorMessage(null); setLoading(true)
    try {
      const res = await fetch(
        `/api/ci/delete-preview?kind=${next.kind}&id=${encodeURIComponent(next.id)}`,
        { headers: { 'X-CI-Workspace': workspaceId } },
      ).then((r) => r.json() as Promise<ApiResponse<DeleteImpactView>>)
      // 미리보기가 실패해도 삭제 자체는 막지 않는다 — 다만 무엇이 사라지는지 못 보여줄 뿐이다.
      // 그 사실을 숨기지 않고 대화상자에 그대로 띄운다.
      setImpact(res.success ? res.data : { label: null, cascades: [], detaches: [], blocked: null })
      if (!res.success) setErrorMessage('무엇이 사라지는지 확인하지 못했습니다')
    } catch {
      setImpact({ label: null, cascades: [], detaches: [], blocked: null })
      setErrorMessage('무엇이 사라지는지 확인하지 못했습니다')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const close = useCallback(() => {
    if (busy) return
    setPending(null); setImpact(null); setErrorMessage(null)
  }, [busy])

  const confirm = useCallback(async () => {
    if (!pending) return
    setBusy(true); setErrorMessage(null)
    try {
      const res = await fetch(endpointOf(pending.kind, pending.id, { boardId: pending.boardId }), {
        method: 'DELETE',
        headers: { 'X-CI-Workspace': workspaceId },
      }).then((r) => r.json() as Promise<ApiResponse<{ id: string }>>)

      if (!res.success) { setErrorMessage(res.error.message); return }

      const done = pending
      setPending(null); setImpact(null)
      onDone?.(done)
    } catch {
      setErrorMessage('지우지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }, [pending, workspaceId, onDone])

  return { pending, impact, loading, busy, errorMessage, ask, confirm, close }
}
