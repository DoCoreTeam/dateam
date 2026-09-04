/**
 * 회의 하나가 팀에게 어디까지 보이는가 — **손잡이 하나(SSOT)**
 *
 * ## 왜 이 파일이 생겼나
 *
 * 사용자 지적(2026-08-24) 원문:
 *   *"영업 CRM 연결 해제와 연결이 의미가 있나? 어차피 나만보기로 했을때는 변화가 있나?"*
 *
 * 두 물음이 같은 뿌리를 가리켰다. **"팀이 이 회의를 볼 수 있나"를 정하는 자리가 셋**이었고
 * 셋이 서로를 몰랐다.
 *
 *   ① `meeting_notes.visibility`  — 원본 **읽기**만 끊는다
 *   ② `crm_meeting.noteId`        — 원본 **링크**만 끊는다 (게다가 중복 미팅을 만들었다)
 *   ③ CRM 사본(summaryMd·전사)    — **끌 방법이 아예 없었다**
 *
 * 사용자는 셋을 하나로 본다("팀에 보이나, 안 보이나"). 화면도 그렇게 말했다.
 * 실제로는 ①과 ②가 각각 다른 것을 끊고, ③은 아무도 못 껐다.
 *
 * ## 그래서 상태 하나로 모은다
 *
 * 새 컬럼을 만들지 않는다 — 상태는 **이미 있는 두 값에서 파생**된다.
 * 컬럼을 더하면 손잡이가 넷이 될 뿐이고, 그게 이 사고의 원인이었다.
 *
 * ## 왜 `noteId` 를 더 이상 지우지 않나
 *
 * 예전 "연결 해제"는 `noteId = null` 을 했다. 그런데 재발행의 멱등 판정이
 * **그 `noteId` 로 기존 미팅을 찾는다**(`findPublished`). 지워 버리면 못 찾아
 * **같은 회의가 CRM 에 두 벌** 생긴다 — v0.7.576 이 없애려던 바로 그 상태다.
 *
 * `기록만`은 링크를 끊는 게 아니라 **원본을 잠그는 것**이다. `noteId` 는 그대로 두고
 * `visibility` 만 내린다. 그러면 재발행이 늘 같은 미팅을 찾고, 중복이 구조적으로 0 이 된다.
 */

import { NOTE_VISIBILITY, type NoteVisibility } from './note-visibility.ts'
import type { StatusKey } from '../tokens/status-colors.ts'

/**
 * 회의 하나의 공개 상태.
 *
 * 앞의 셋은 **사람이 고르는 것**이고, `NO_SOURCE` 는 **고를 수 없는 사실**이다 —
 * 원본이 애초에 없거나(구 CRM 미팅) 지워진 경우다. 손잡이에 넣지 않는다.
 */
export type MeetingShareState = 'PRIVATE' | 'TEAM' | 'RECORD_ONLY' | 'NO_SOURCE'

/** 사람이 고를 수 있는 것만. 화면의 스위치는 이 목록으로 그린다 */
export const CHOOSABLE_SHARE_STATES: MeetingShareState[] = ['PRIVATE', 'RECORD_ONLY', 'TEAM']

export interface ShareStateInput {
  /** CRM 에 살아 있는 미팅이 있나 (소프트 삭제된 것은 없는 것으로 본다) */
  hasLiveMeeting: boolean
  /** 그 미팅이 원본 회의노트를 가리키고 있나 */
  hasNoteLink: boolean
  /** 원본의 읽기 범위 */
  visibility: NoteVisibility | null
}

/**
 * 상태를 **읽는다**. 저장된 값이 아니라 지금 사실에서 계산한다.
 *
 * 컬럼으로 두지 않는 이유: 컬럼은 실제 상태와 어긋날 수 있고,
 * 어긋난 순간 화면이 거짓말을 한다. 파생값은 어긋날 수가 없다.
 */
export function readShareState(input: ShareStateInput): MeetingShareState {
  if (!input.hasLiveMeeting) return 'PRIVATE'
  if (!input.hasNoteLink) return 'NO_SOURCE'
  return input.visibility === NOTE_VISIBILITY.CRM ? 'TEAM' : 'RECORD_ONLY'
}

/**
 * 상태를 **쓸 때** 필요한 두 조각.
 *
 * 화면은 상태 하나만 고르고, 그것을 무엇으로 옮길지는 여기서 정한다 —
 * 화면마다 `visibility` 와 미팅 존재 여부를 따로 만지면 손잡이가 다시 갈린다.
 */
export interface ShareStatePlan {
  /** CRM 에 미팅이 있어야 하나 (false 면 소프트 삭제, true 면 없을 때 발행) */
  wantMeeting: boolean
  /** 원본 읽기 범위를 무엇으로 둘 것인가 */
  visibility: NoteVisibility
}

export function planShareState(next: MeetingShareState): ShareStatePlan {
  switch (next) {
    case 'TEAM':
      return { wantMeeting: true, visibility: NOTE_VISIBILITY.CRM }
    case 'RECORD_ONLY':
      // 링크(noteId)는 건드리지 않는다 — 그게 중복 미팅의 원인이었다
      return { wantMeeting: true, visibility: NOTE_VISIBILITY.PRIVATE }
    case 'PRIVATE':
      return { wantMeeting: false, visibility: NOTE_VISIBILITY.PRIVATE }
    default:
      /**
       * `NO_SOURCE` 는 고를 수 있는 상태가 아니다.
       * 조용히 무엇이든 하지 않고 던진다 — 조용히 넘기면 화면이 눌린 줄 알고,
       * 사용자는 바뀐 줄 안다.
       */
      throw new Error(`고를 수 없는 공개 상태입니다: ${next}`)
  }
}

/** 화면에 쓰는 말 — 여기 말고 다른 데서 문자열을 짓지 않는다(§2-5 용어 상수) */
export const SHARE_STATE_LABEL: Record<MeetingShareState, string> = {
  PRIVATE: '나만 보기',
  RECORD_ONLY: '기록만',
  TEAM: '팀 공개',
  NO_SOURCE: '원본 없음',
}

/**
 * 각 상태에서 **팀이 실제로 보는 것**.
 *
 * 예전 화면은 "나만 보기"라고 해 놓고 팀에게 요약·전사를 그대로 보여 줬다.
 * 라벨만으로는 그 차이를 알 수 없으므로, 무엇이 보이는지를 함께 적는다.
 */
/**
 * 상태의 **색**. 화면이 색을 고르지 않는다(§0-2 규칙 4) —
 * 고르게 두면 목록·상세·배지가 저마다 다른 색을 쓰고, 사용자는 같은 뜻을 다르게 읽는다.
 */
export const SHARE_STATE_STATUS: Record<MeetingShareState, StatusKey> = {
  PRIVATE: 'note',      // 회색 — 아직 아무에게도 안 갔다
  RECORD_ONLY: 'doing', // 진행 중 색 — 절반만 갔다
  TEAM: 'done',         // 완료 색 — 팀이 다 본다
  NO_SOURCE: 'note',
}

export const SHARE_STATE_HINT: Record<MeetingShareState, string> = {
  PRIVATE: '영업 CRM에 올라가지 않아요. 나와 관리자만 봅니다.',
  RECORD_ONLY: '영업팀이 요약과 전사는 보지만, 원본 회의노트는 열 수 없어요.',
  TEAM: '영업팀이 요약·전사와 원본 회의노트를 모두 볼 수 있어요.',
  NO_SOURCE: '원본 회의노트가 없는 미팅이라 공개 범위를 정할 수 없어요.',
}

/**
 * 상태를 바꿀 때 **되돌릴 수 없는 일이 섞이는가**.
 *
 * `PRIVATE` 로 내리는 것만 미팅을 지운다(소프트 삭제라 되돌릴 수 있지만,
 * 팀이 보던 것이 사라지는 일이라 확인을 받는다). 나머지는 읽기 범위만 바꾼다.
 */
export function needsConfirm(from: MeetingShareState, to: MeetingShareState): boolean {
  return from !== to && to === 'PRIVATE' && from !== 'NO_SOURCE'
}

/**
 * 서버가 이미 아는 것만으로 **첫 렌더에 쓸 상태**를 고른다.
 *
 * 왜(사용자 지적 v0.7.685): *"공개상태도 아래가 아니라 잘 보이는 곳에 젤 먼저 보이는 곳에"*
 * 공개 범위 카드가 화면 **맨 아래**(288줄 중 284줄)에 있었고, 게다가 서버 왕복이 끝날 때까지
 * `null` 을 그려 **뒤늦게 나타났다.** 늦게 나타나는 것은 사용자에게 「없다」로 읽힌다.
 *
 * 회의노트 행에는 `visibility` 가 이미 있으므로 **왕복 없이** 두 상태는 확정할 수 있다.
 * 나머지 하나(`RECORD_ONLY` — 원본은 잠갔지만 미팅은 살아 있음)만 미팅 존재 여부가 필요해
 * 왕복 뒤에 확정된다. 즉 **틀린 값을 잠깐 보여주는 것이 아니라, 덜 자세한 값을 먼저 보여준다.**
 */
export function initialShareState(visibility: NoteVisibility | undefined): MeetingShareState {
  return visibility === NOTE_VISIBILITY.CRM ? 'TEAM' : 'PRIVATE'
}
