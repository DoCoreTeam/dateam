/**
 * 회의노트 공개 범위 (SSOT) — 마이그 321 의 CHECK 제약과 **같은 값 집합**이어야 한다.
 *
 * 왜 상수로 두나: 화면·API·서비스 세 곳이 각자 `'team'` 문자열을 적으면
 * 오타 하나가 조용히 새 값을 만들고, DB CHECK 는 통과시키지 않는데 코드는 통과시킨다.
 *
 * 값의 뜻(마이그 321 주석 그대로, 사용자 결정 2026-10-27):
 *   · private = 본인 + admin. 컬럼 기본값이다
 *   · team    = 작성자의 팀과 그 상위 팀장이 **읽는다**(조직도 기준, private.my_readable_dept_ids)
 *
 * 예전 'crm'(연결된 영업 워크스페이스 전원)은 321 이 'team' 으로 옮겼다.
 * 배포 전 코드가 'crm' 을 보내도 DB 트리거가 'team' 으로 받는다.
 *
 * ⚠️ 읽기 공개이지 편집 공개가 아니다. UPDATE·DELETE 는 언제나 본인만이다.
 */

export const NOTE_VISIBILITY = {
  PRIVATE: 'private',
  TEAM: 'team',
} as const

export type NoteVisibility = (typeof NOTE_VISIBILITY)[keyof typeof NOTE_VISIBILITY]

export const NOTE_VISIBILITY_VALUES: NoteVisibility[] = [NOTE_VISIBILITY.PRIVATE, NOTE_VISIBILITY.TEAM]

export function isNoteVisibility(v: unknown): v is NoteVisibility {
  return typeof v === 'string' && (NOTE_VISIBILITY_VALUES as string[]).includes(v)
}

/** DB 에서 읽은 값을 두 값 중 하나로. 모르는 값은 더 닫힌 쪽(나만 보기)으로 읽는다 */
export function toNoteVisibility(v: unknown): NoteVisibility {
  return v === NOTE_VISIBILITY.TEAM ? NOTE_VISIBILITY.TEAM : NOTE_VISIBILITY.PRIVATE
}
