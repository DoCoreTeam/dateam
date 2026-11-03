/**
 * 회사 프로필 초안 문서를 보관함으로 바로 올리는 길
 *
 * ## 왜 따로 있나
 *
 * 서버리스 함수는 요청 본문이 4.5MB 를 넘으면 **함수에 닿기 전에** 413 으로 끊긴다
 * (실측 2026-11-03: 6MB 본문이 `FUNCTION_PAYLOAD_TOO_LARGE`, text/plain).
 * 회사소개서는 대개 그보다 크다. 그래서 바이트는 브라우저가 보관함에 바로 넣고
 * 함수는 경로만 받는다.
 *
 * ## 경로를 서버가 정하는 이유
 *
 * 보관함 쓰기는 서버만 한다(마이그레이션 250). 브라우저는 **서버가 서명한 주소 하나**에만
 * 올릴 수 있고, 초안 창구는 그 조직의 초안 자리가 아닌 경로를 거절한다 —
 * 아니면 남의 조직 원문 경로를 넣어 읽게 할 수 있다.
 *
 * 이 파일은 화면도 import 하므로 node 전용 모듈을 쓰지 않는다.
 */

import { checkFileSize, type FileRejectReason } from './limits.ts'

/** 초안 원문을 두는 2단계 폴더. 케이스 id 자리라 uuid 와 안 겹치는 이름이다 */
export const DRAFT_DIR = 'profile-draft'

/** 한 번에 올릴 수 있는 문서 수 — 회사소개서·등록증·실적표면 충분하다 */
export const MAX_DRAFT_FILES = 5

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

export function draftUploadPath(orgId: string, id: string): string {
  return `${orgId}/${DRAFT_DIR}/${id}.bin`
}

/** 그 조직의 초안 자리인가 — 정확히 한 모양만 통과시킨다(`..`·다른 폴더·다른 조직 전부 거절) */
export function isDraftPathOf(orgId: string, path: string): boolean {
  if (!new RegExp(`^${UUID}$`, 'i').test(orgId)) return false
  return new RegExp(`^${orgId}/${DRAFT_DIR}/${UUID}\\.bin$`, 'i').test(path)
}

export interface DraftFileMeta { name: string; size: number }
export interface DraftTarget { name: string; path: string }

export type DraftPlan =
  | { ok: true; targets: DraftTarget[] }
  | { ok: false; error: 'missing_file' | 'too_many_files'; limit?: number }
  | { ok: false; error: FileRejectReason; name: string; limit: number }

/** 올릴 파일들을 보고 자리를 정한다 — 주소를 주기 전에 크기를 먼저 본다 */
export function planDraftUploads(
  orgId: string, files: readonly DraftFileMeta[], newId: () => string,
): DraftPlan {
  if (files.length === 0) return { ok: false, error: 'missing_file' }
  if (files.length > MAX_DRAFT_FILES) return { ok: false, error: 'too_many_files', limit: MAX_DRAFT_FILES }

  const targets: DraftTarget[] = []
  let total = 0
  for (const f of files) {
    const size = checkFileSize({ sizeBytes: f.size, caseBytes: total, fileName: f.name })
    if (!size.ok) return { ok: false, error: size.reason, name: f.name, limit: size.limit }
    total += f.size
    targets.push({ name: f.name, path: draftUploadPath(orgId, newId()) })
  }
  return { ok: true, targets }
}

/** 초안 창구가 JSON 으로 받은 `files` 를 읽는다. 모양이 하나라도 틀리면 null */
export function readDraftRefs(orgId: string, value: unknown): DraftTarget[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DRAFT_FILES) return null
  const refs: DraftTarget[] = []
  for (const v of value) {
    if (!v || typeof v !== 'object') return null
    const { name, path } = v as Record<string, unknown>
    if (typeof name !== 'string' || name.trim() === '' || typeof path !== 'string') return null
    if (!isDraftPathOf(orgId, path)) return null
    refs.push({ name, path })
  }
  return refs
}

/** 화면이 말할 실패의 갈래. 문구는 terms 가 갖는다 */
export type DraftFailure =
  | { kind: 'too_large'; name: string; limitMb: number }
  | { kind: 'too_many'; limit: number }
  | { kind: 'empty'; name: string }
  | { kind: 'unreadable' }
  | { kind: 'upload_failed' }
  | { kind: 'generic' }

/**
 * 창구가 돌려준 실패 본문을 갈래로 편다.
 *
 * 본문이 JSON 이 아닐 수 있다(413 은 함수에 닿기 전에 text/plain 으로 온다) — 그래서 unknown 을 받는다
 */
export function readDraftFailure(status: number, body: unknown): DraftFailure {
  if (status === 413) return { kind: 'too_large', name: '', limitMb: 0 }
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = typeof b.name === 'string' ? b.name : ''
  const limit = typeof b.limit === 'number' ? b.limit : 0
  switch (b.error) {
    case 'file_too_large':
    case 'case_quota_exceeded':
      return { kind: 'too_large', name, limitMb: Math.floor(limit / (1024 * 1024)) }
    case 'too_many_files': return { kind: 'too_many', limit }
    case 'empty_file': return { kind: 'empty', name }
    case 'no_readable_file': return { kind: 'unreadable' }
    case 'upload_url_failed':
    case 'upload_not_found':
    case 'invalid_upload_ref':
      return { kind: 'upload_failed' }
    default: return { kind: 'generic' }
  }
}
