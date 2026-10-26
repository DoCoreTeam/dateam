/**
 * 작업대 도착 자동 녹음 판정 (SSOT)
 *
 * 「녹음 시작」은 회의와 노트를 만든 뒤 작업대로 옮겨 가고, 주소에 표지(`rec=1`)를 단다.
 * 녹음기는 셸에 있고 라우트 묶음이 바뀌면 셸이 다시 그려지므로, 옮기기 전에 켜면 잃는다.
 * 그래서 도착한 작업대가 표지를 보고 켠다.
 *
 * 한 번만 켠다. 켜기 전에 이 노트의 표지를 「썼음」으로 적고 주소에서 표지를 지운다.
 * 새로고침이나 뒤로 가기로 같은 주소를 다시 열어도 두 번 켜지지 않는다.
 * 화면 판정을 컴포넌트에 두면 실브라우저 말고 검증할 수단이 없어 순수 함수로 둔다.
 */

import { AUTO_RECORD_PARAM, AUTO_RECORD_VALUE } from './start-flow.ts'

export interface AutoRecordInput {
  /** 주소의 `rec` 값, 없으면 null */
  param: string | null
  noteId: string
  /** 이 노트의 표지를 이미 썼나 */
  consumed: boolean
  /** 이 브라우저가 녹음을 쓸 수 있나 */
  supported: boolean
  canEdit: boolean
  /** 녹음기 상태 (`idle` `requesting` `recording` `paused` `stopping` `error`) */
  recState: string
  /** 다른 회의나 다른 탭의 녹음이 돌고 있나 */
  otherRecording: boolean
}

/** 녹음기가 새 녹음을 받을 수 있는 상태, 오류 뒤에도 다시 켤 수 있다 */
const READY_STATES = new Set(['idle', 'error'])

export function shouldAutoRecord(input: AutoRecordInput): boolean {
  if (input.param !== AUTO_RECORD_VALUE) return false
  if (!input.noteId) return false
  if (input.consumed) return false
  if (!input.supported || !input.canEdit) return false
  if (input.otherRecording) return false
  return READY_STATES.has(input.recState)
}

/** 노트마다 따로 적는 「표지를 썼음」 열쇠 */
export function consumedKey(noteId: string): string {
  return `newax.auto-record.${noteId}`
}

/** 주소에서 자동 녹음 표지만 지운다. 탭(`wb`)과 다른 값은 그대로 둔다 */
export function stripAutoRecordParam(href: string): string {
  const url = new URL(href, 'http://local.invalid')
  url.searchParams.delete(AUTO_RECORD_PARAM)
  const isAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(href)
  return isAbsolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`
}
