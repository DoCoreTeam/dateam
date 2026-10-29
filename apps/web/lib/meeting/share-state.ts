/**
 * 회의 하나가 누구에게 보이는가 — **손잡이 하나(SSOT)**
 *
 * ## 상태는 둘이다 (사용자 결정 2026-10-27)
 *
 * 사용자 원문: *"회의노트는 말그대로 본인만 보는거야, 그리고 CRM에 기록만은 본인만 보는거니
 * 회의노트랑 같은거고 팀공개는 조직도 기반에 팀에서 볼 수 있는건데 (상위 팀도)"*
 *
 * 예전에는 셋이었다(나만 보기 · 기록만 · 팀 공개). 「기록만」은 원본만 잠그고 CRM 사본(요약·전사)을
 * 영업 워크스페이스 전원에게 보여 줬다. 회의 기록이 노트 하나로 합쳐지면서 사본이 없어졌고,
 * 그래서 「기록만」은 「나만 보기」와 같은 것이 됐다.
 *
 * ## 상태는 저장하지 않고 읽는다
 *
 * 상태는 `meeting_notes.visibility` 한 칸에서 나온다. CRM 미팅이 있는지 없는지는
 * 「어디에 보이나」(회사·딜이 붙었나)일 뿐 「누가 보나」를 바꾸지 않는다.
 * 누가 보는지는 DB RLS 가 정한다(마이그 321, 작성자의 팀과 상위 팀장).
 */

import { NOTE_VISIBILITY, toNoteVisibility, type NoteVisibility } from './note-visibility.ts'
import type { StatusKey } from '../tokens/status-colors.ts'

/** 회의 하나의 공개 상태 */
export type MeetingShareState = 'PRIVATE' | 'TEAM'

/** 화면의 스위치는 이 목록으로 그린다, 좁은 것에서 넓은 것으로 */
export const CHOOSABLE_SHARE_STATES: MeetingShareState[] = ['PRIVATE', 'TEAM']

export function isShareState(v: unknown): v is MeetingShareState {
  return typeof v === 'string' && (CHOOSABLE_SHARE_STATES as string[]).includes(v)
}

/** 상태를 **읽는다**. 저장된 값이 아니라 노트의 공개 범위에서 계산한다 */
export function readShareState(visibility: unknown): MeetingShareState {
  return toNoteVisibility(visibility) === NOTE_VISIBILITY.TEAM ? 'TEAM' : 'PRIVATE'
}

/** 상태를 **쓸 때** 노트 공개 범위를 무엇으로 둘지 */
export function visibilityFor(state: MeetingShareState): NoteVisibility {
  return state === 'TEAM' ? NOTE_VISIBILITY.TEAM : NOTE_VISIBILITY.PRIVATE
}

/** 화면에 쓰는 말 — 여기 말고 다른 데서 문자열을 짓지 않는다(§2-5 용어 상수) */
export const SHARE_STATE_LABEL: Record<MeetingShareState, string> = {
  PRIVATE: '나만 보기',
  TEAM: '팀 공개',
}

/**
 * 상태의 **색**. 화면이 색을 고르지 않는다(§0-2 규칙 4) —
 * 고르게 두면 목록·상세·배지가 저마다 다른 색을 쓰고, 사용자는 같은 뜻을 다르게 읽는다.
 */
export const SHARE_STATE_STATUS: Record<MeetingShareState, StatusKey> = {
  PRIVATE: 'note',
  TEAM: 'done',
}

/** 각 상태에서 **누가 보는지**. 라벨만으로는 범위를 알 수 없으므로 함께 적는다 */
export const SHARE_STATE_HINT: Record<MeetingShareState, string> = {
  PRIVATE: '나와 관리자만 볼 수 있어요.',
  TEAM: '내 팀과 상위 팀장이 볼 수 있어요. 고치고 지우는 건 나만 할 수 있어요.',
}
