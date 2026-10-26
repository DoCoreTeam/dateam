/**
 * 녹음 구간이 어디로 가나 (SSOT)
 *
 * 실측 2026-10-26: 오프라인에서 시작한 녹음이 도는 동안 회의가 서버로 건너갔다.
 * 녹음기는 계속 `local_…` 주소로 올렸고, 서버엔 그런 회의가 없어 구간마다 404 가 났다.
 *
 * 규칙 셋 —
 *   서버 id 면 그대로 올린다
 *   지역 id 이고 건넨 짝이 있으면 **서버 id 로 보관하고 올린다**
 *   지역 id 이고 짝이 없으면 **올리지 않고 기기에만 둔다.** 회의가 서버에 생긴 뒤 건네기가 옮긴다
 */

import { isLocalNoteId, serverIdFor as pairedServerId } from '../offline/local-meeting.ts'

export interface PartDestination {
  noteId: string
  upload: boolean
}

export interface PartDestinationDeps {
  serverIdFor?: (localId: string) => string | null
  isLocal?: (noteId: string) => boolean
}

export function resolvePartDestination(noteId: string, deps: PartDestinationDeps = {}): PartDestination {
  const isLocal = deps.isLocal ?? isLocalNoteId
  if (!isLocal(noteId)) return { noteId, upload: true }
  const paired = (deps.serverIdFor ?? ((id: string) => pairedServerId(id)))(noteId)
  return paired ? { noteId: paired, upload: true } : { noteId, upload: false }
}
