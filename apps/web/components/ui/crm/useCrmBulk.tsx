'use client'

// components/ui/crm/useCrmBulk.tsx — CRM 목록의 "골라서 한 번에" 한 벌 (§2-5 동종 UI 통일)
//
// **왜 훅으로 두는가**(v0.7.576): 회사 목록에 선택 삭제·되돌리기를 붙이고 나서
// 인물·딜·견적에 같은 것을 넣으려 보니, 화면마다 옮겨야 할 조각이 여덟 개였다
// (선택 상태 · 이름 조회 · 삭제 · 복구 · 확인창 · 결과 카드 · 상한 안내 · 진행률).
// 네 번 복붙하면 넷이 조금씩 달라지고, 그때부터 사용자에겐 **다른 기능**으로 보인다.
//
// 그래서 여기서 한 번 조립하고 화면은 세 가지만 꽂는다:
//   `toolbarSelection` → ListToolbar    `surfaceSelection` → ListSurface    `panels` → 본문
//
// 서버 일괄 엔드포인트를 만들지 않는 이유는 `lib/ui/use-bulk-action.ts` 머리말에 있다.

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import InlineError from '@/components/ui/InlineError'
import BulkResultPanel, { BulkProgress, bulkHeadline } from '@/components/ui/list/BulkResultPanel'
import BulkDeleteConfirm from '@/components/ui/crm/BulkDeleteConfirm'
import { useBulkAction, callCrmRecord, BULK_MAX } from '@/lib/ui/use-bulk-action'
import type { RowSelection } from '@/hooks/useRowSelection'

/**
 * 용어는 여기서만 정한다(§2-5 (2)).
 *
 * 앱의 다른 되돌리기(주간보고 이력 · 업무 활동 · 프로젝트)가 전부 **되살리기**를 쓴다.
 * 같은 행위를 화면마다 다른 말로 부르면 사용자는 다른 기능으로 읽는다.
 */
const LABEL = {
  restore: '선택 되살리기',
  restoring: '되살리는 중…',
  restoreDone: '되살렸어요.',
  delete: '선택 삭제',
  deleting: '지우는 중…',
  deleteDone: '삭제했어요.',
} as const

interface Options {
  /** `/api/crm/companies` 처럼 **한 건짜리** 경로의 앞부분 */
  endpoint: string
  /** 확인창에 쓰는 말 — "회사" · "인물" · "딜" · "견적" */
  entity: string
  /** 세는 단위 — "곳" · "명" · "건" */
  unit: string
  selection: RowSelection
  /** id → 사용자가 알아보는 이름. 실패 줄과 확인창에 쓴다 */
  labelOf: (id: string) => string
  /** 휴지통 보기인가 — 그러면 삭제 대신 되돌리기만 보인다 */
  trash: boolean
  /** 처리가 끝난 뒤 목록 다시 읽기 */
  onReload: () => void
  /** 이 화면만의 추가 버튼(회사의 'AI로 채우기' 등) — 삭제 버튼 **앞**에 놓인다 */
  extraActions?: ReactNode
}

export function useCrmBulk({
  endpoint, entity, unit, selection, labelOf, trash, onReload, extraActions,
}: Options) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  const afterBulk = useCallback(() => {
    selection.clear()
    onReload()
  }, [selection, onReload])

  const bulkDelete = useBulkAction({
    run: (id) => callCrmRecord(`${endpoint}/${id}`, 'DELETE'),
    labelOf, fallbackMessage: '삭제하지 못했습니다.', onDone: afterBulk,
  })
  const bulkRestore = useBulkAction({
    run: (id) => callCrmRecord(`${endpoint}/${id}/restore`, 'POST'),
    labelOf, fallbackMessage: '되살리지 못했습니다.', onDone: afterBulk,
  })

  /** 지금 화면에서 도는 쪽 — 휴지통이면 복구, 아니면 삭제 */
  const bulk = trash ? bulkRestore : bulkDelete

  const toolbarSelection = useMemo(() => ({
    count: selection.count,
    onClear: selection.clear,
    actions: (
      <>
        {/* 휴지통에서는 되살리기만 — 이미 지운 것을 또 지울 일은 없다 */}
        {trash ? (
          <NbButton
            onClick={() => void bulkRestore.start(selection.selectedIds)}
            disabled={bulkRestore.busy || selection.count > BULK_MAX}
          >
            {bulkRestore.busy ? <AXDotLoader /> : <RotateCcw size={16} />}
            {bulkRestore.busy ? LABEL.restoring : LABEL.restore}
            <BulkProgress {...bulkRestore.progress} />
          </NbButton>
        ) : (
          <>
            {extraActions}
            {/* 되돌릴 수 없는 일이므로 곧장 실행하지 않고 확인을 받는다(R-5) */}
            <NbButton
              variant="danger"
              onClick={() => setConfirmOpen(true)}
              disabled={bulkDelete.busy || selection.count > BULK_MAX}
            >
              {bulkDelete.busy ? <AXDotLoader /> : <Trash2 size={16} />}
              {bulkDelete.busy ? LABEL.deleting : LABEL.delete}
              <BulkProgress {...bulkDelete.progress} />
            </NbButton>
          </>
        )}
        {selection.count > BULK_MAX && (
          <InlineError compact>한 번에 {BULK_MAX}{unit}까지예요. 나눠서 눌러 주세요.</InlineError>
        )}
      </>
    ),
  }), [selection, trash, bulkDelete, bulkRestore, extraActions, unit])

  const surfaceSelection = useMemo(() => ({
    selected: new Set(selection.selectedIds),
    onToggle: selection.toggle,
    onToggleAll: selection.toggleAll,
    allSelected: selection.allSelected,
    someSelected: selection.someSelected,
  }), [selection])

  const panels = (
    <>
      {bulk.result && (
        <BulkResultPanel
          headline={bulkHeadline(bulk.result.ok, bulk.result.failed.length, trash ? LABEL.restoreDone : LABEL.deleteDone, unit)}
          failures={bulk.result.failed}
          onClose={bulk.clearResult}
        />
      )}
      {confirmOpen && (
        <BulkDeleteConfirm
          entity={entity}
          names={selection.selectedIds.map(labelOf)}
          busy={bulkDelete.busy}
          onConfirm={() => { setConfirmOpen(false); void bulkDelete.start(selection.selectedIds) }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  )

  return { toolbarSelection, surfaceSelection, panels, bulk, busy: bulkDelete.busy || bulkRestore.busy }
}
