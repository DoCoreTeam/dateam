/**
 * 회의를 어디서 적는가, CRM 권한이 있으면 CRM 미팅, 없으면 회의노트
 *
 * 사용자 지시(2026-10-22): *"CRM 권한이 없으면 회의노트, CRM 권한이 있으면 CRM에 있는 기록 메뉴"*.
 * 홈 단추와 사이드바가 같은 답을 내야 하므로 판정은 이 한 곳에 둔다.
 *
 * 판정만 둔다. 세션을 읽는 쪽은 `meeting-entry.server.ts` 이고
 * 이 파일은 시험 실행기가 그대로 읽는다(서버 모듈은 못 읽는다).
 */

export const CRM_MEETINGS_HREF = '/crm/meetings'
export const MEETING_NOTES_HREF = '/meeting-notes'

/** 회의를 적을 곳 */
export type MeetingEntry = 'crm' | 'notes'

export interface MeetingEntryGates {
  /** 표면 권한, CRM 레이아웃의 첫 문 `canOpen('/crm')` */
  canOpenCrm: boolean
  /** CRM 멤버, CRM 레이아웃의 둘째 문 `resolveCrmAccess().ok` */
  isCrmMember: boolean
}

/**
 * 두 문을 **둘 다** 지나야 CRM 이다.
 *
 * 하나만 보면 CRM 레이아웃이 막는 사람을 그 앞까지 데려가게 된다.
 * 거기서 「멤버가 아닙니다」를 보면 회의를 적을 곳이 사라진다.
 */
export function decideMeetingEntry(gates: MeetingEntryGates): MeetingEntry {
  return gates.canOpenCrm && gates.isCrmMember ? 'crm' : 'notes'
}

export function meetingEntryHref(hasCrm: boolean): string {
  return hasCrm ? CRM_MEETINGS_HREF : MEETING_NOTES_HREF
}
