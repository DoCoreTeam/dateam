/**
 * 회의노트 상태의 말과 색 — SSOT
 *
 * **왜 생겼나**: 같은 표가 화면 셋에 **글자까지 똑같이** 복붙돼 있었다(실측 v0.7.597).
 *   · `app/(member)/meeting-notes/MeetingDetailClient.tsx:32`
 *   · `app/(member)/meeting-notes/MeetingDateView.tsx:7`
 *   · `app/(member)/meeting-notes/MeetingListView.tsx:38`
 *
 * 하나를 고치면 두 곳이 남는다. 그리고 실제로 **오탈자까지 복제돼 있었다** —
 * 세 파일 모두 `'작성중'` 으로 공백이 빠져 있었다. 표준은 `작성 중` 이다(용어집 §02 진행 표기).
 * 이 파일로 올리면서 함께 고친다.
 *
 * 모양은 `lib/crm/ui/meeting-status.ts` 를 따른다 — `Record<Key, { label, status }>` + `_ORDER`.
 * `status` 는 `StatusKey` 라 **색이 자동으로 따라온다**(화면이 색을 안 정한다).
 */

import type { StatusKey } from '../../tokens/status-colors.ts'

/** `meeting_notes.status` 컬럼 값 */
export type NoteStatusKey = 'draft' | 'final' | 'archived'

export const NOTE_STATUS_META: Record<NoteStatusKey, { label: string; status: StatusKey }> = {
  draft: { label: '작성 중', status: 'planned' },
  final: { label: '확정', status: 'done' },
  archived: { label: '보관', status: 'doing' },
}

/** 사람이 겪는 순서 — 쓰고 → 확정하고 → 보관한다 */
export const NOTE_STATUS_ORDER: NoteStatusKey[] = ['draft', 'final', 'archived']

/**
 * 모르는 값이 와도 화면이 깨지지 않게.
 *
 * 세 화면이 각자 `?? { label: note.status, status: 'planned' }` 로 같은 폴백을 적고 있었다.
 * 폴백도 한 곳에 둔다 — 안 그러면 "어떤 화면은 원문을 보여 주고 어떤 화면은 빈칸"이 된다.
 */
export function noteStatusMeta(value: string | null | undefined): { label: string; status: StatusKey } {
  if (value && value in NOTE_STATUS_META) return NOTE_STATUS_META[value as NoteStatusKey]
  return { label: value ?? '알 수 없음', status: 'planned' }
}
