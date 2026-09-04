// lib/meeting/recording-placement.ts — 녹음 버튼을 **어디에 세울지** 정하는 SSOT
//
// ## 왜 생겼나 (사용자 지적 2026-09-05)
//
// *"이미 작성 완료 된거에 녹음시작이 떡하니 있는게 이상하지 않나?"*
//
// 확정(`status='final'`)된 8월 19일 회의를 열었는데 화면 맨 위가 「🎙 녹음 시작」이었다.
// 실측: 확정 7건 중 **6건이 녹음 없는 회의**다. 끝난 회의를 다시 읽으러 온 사람에게
// 가장 큰 버튼으로 「녹음 시작」을 내미는 것은, 이 화면이 무엇을 하는 곳인지 잘못 말하는 것이다.
//
// ## 층위로 보면 (§2-3-6)
//
// 녹음은 **재료**다 — 작성과 나란한 자리이고, 정리(결과물)보다 아래다.
// 그런데 녹음만 접기 밖 맨 위에 있었다. 「결과물이 위, 재료가 아래」를 유일하게 어긴 자리다.
//
// 그렇다고 **언제나** 접기 안으로 내리면 반대 사고가 난다: 회의가 시작되는 순간
// 노트를 열고 녹음을 누르는 흐름에서, 접힌 화면은 한 번 더 누르게 만든다.
// 회의는 기다려 주지 않는다.
//
// ## 그래서 상태로 가른다
//
//   작성 중  → 맨 위. 지금 회의 중일 수 있다.
//   확정·보관 → 접기 안. 이미 끝난 회의다. 덧붙일 녹음이 있으면 근거를 펴면 된다.
//
// 판정을 컴포넌트 밖에 두는 이유(완료 조건 E-6): `status === 'final'` 같은 식을 JSX 안에
// 쓰면 실브라우저 말고는 검증할 수단이 없다. 이 판정이 틀리면 회의 중에 녹음을 못 누르거나
// (더 나쁘게) 끝난 회의가 다시 녹음 화면처럼 보인다.

import type { NoteStatusKey } from './ui/note-status.ts'

/**
 * 녹음 버튼을 **결과물 위**(접기 밖 맨 위)에 고정할까.
 *
 * @param status `meeting_notes.status`. 모르는 값이면 **고정한다** —
 *   판정 불가를 이유로 회의 중에 녹음을 못 누르게 만드는 쪽이 훨씬 나쁘다.
 *   (기존 동작이 「언제나 위」였으므로 이 폴백은 회귀 0이기도 하다.)
 */
export function isRecordingPinned(status: string | null | undefined): boolean {
  return !isFinishedNote(status)
}

/** 이 회의는 끝났나 — 확정·보관은 «다시 읽는» 화면이다 */
export function isFinishedNote(status: string | null | undefined): boolean {
  const finished: NoteStatusKey[] = ['final', 'archived']
  return finished.includes(status as NoteStatusKey)
}
