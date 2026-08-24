/**
 * 회의노트 공개 범위 (SSOT) — 마이그 216 의 CHECK 제약과 **같은 값 집합**이어야 한다.
 *
 * 왜 상수로 두나: 화면·API·서비스 세 곳이 각자 `'crm'` 문자열을 적으면
 * 오타 하나가 조용히 새 값을 만들고, DB CHECK 는 통과시키지 않는데 코드는 통과시킨다.
 *
 * 값의 뜻(마이그 216 주석 그대로):
 *   · private = 본인 + admin. 컬럼 기본값이다 — **회의노트에서 만들면 이것**
 *   · crm     = 연결된 CRM 워크스페이스 멤버도 **읽는다**. CRM 미팅에서 만들면 이것(D6)
 *
 * ⚠️ 읽기 공개이지 편집 공개가 아니다. UPDATE·DELETE 는 언제나 본인만이다.
 * 나중에 'dept'(부서 공개)를 더할 때는 여기와 DB CHECK 를 **함께** 늘린다.
 */

export const NOTE_VISIBILITY = {
  PRIVATE: 'private',
  CRM: 'crm',
} as const

export type NoteVisibility = (typeof NOTE_VISIBILITY)[keyof typeof NOTE_VISIBILITY]

export const NOTE_VISIBILITY_VALUES: NoteVisibility[] = [NOTE_VISIBILITY.PRIVATE, NOTE_VISIBILITY.CRM]

export function isNoteVisibility(v: unknown): v is NoteVisibility {
  return typeof v === 'string' && (NOTE_VISIBILITY_VALUES as string[]).includes(v)
}

/** 화면에 쓰는 말 — 여기 말고 다른 데서 문자열을 짓지 않는다(§2-5 용어 상수) */
export const NOTE_VISIBILITY_LABEL: Record<NoteVisibility, string> = {
  private: '나만 보기',
  crm: '영업팀 공개',
}

export const NOTE_VISIBILITY_HINT: Record<NoteVisibility, string> = {
  private: '작성한 사람과 관리자만 볼 수 있어요.',
  crm: '이 회의가 연결된 영업 워크스페이스의 멤버도 읽을 수 있어요. 고치는 건 여전히 나만 가능합니다.',
}
