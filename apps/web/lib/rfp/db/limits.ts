/**
 * 첨부 상한 (설계서 3.2.1)
 *
 * ## 왜 파일을 갈랐나
 *
 * 이 값들은 **화면도 알아야 한다** — 고르는 순간에 「200MB 까지예요」를 보여 줘야
 * 사용자가 200MB 를 올리고 나서 거절당하지 않는다.
 *
 * 그런데 같은 파일에 `node:crypto` 를 쓰는 해시 함수가 있으면 그 파일을 import 한
 * 클라이언트 컴포넌트가 통째로 죽는다
 * (실측 2026-09-09: `/rfp/new` 가 500 — "Reading from node:crypto is not handled by plugins").
 *
 * 그래서 **숫자만 여기 두고 서버 전용 코드는 files.ts 에 남긴다.**
 */

/** 파일 하나 상한 */
export const MAX_FILE_BYTES = 200 * 1024 * 1024
/** 케이스 하나 총합 상한 */
export const MAX_CASE_BYTES = 500 * 1024 * 1024

export type FileRejectReason =
  | 'file_too_large'
  | 'case_quota_exceeded'
  | 'empty_file'
  | 'missing_name'

export interface SizeCheckInput {
  sizeBytes: number
  /** 이 케이스에 이미 쌓인 바이트 */
  caseBytes: number
  fileName: string
}

export type SizeCheck =
  | { ok: true }
  | { ok: false; reason: FileRejectReason; limit: number; actual: number }

/**
 * 크기와 이름을 본다 — **바이트를 읽기 전에** 부른다.
 *
 * 200MB 를 메모리에 올린 뒤 거절하면 거절 한 번에 200MB 를 쓴다.
 * 화면과 서버가 **같은 함수**를 쓴다 — 두 벌이면 한쪽만 느슨해진다.
 */
export function checkFileSize(input: SizeCheckInput): SizeCheck {
  if (!input.fileName.trim()) {
    return { ok: false, reason: 'missing_name', limit: 0, actual: 0 }
  }
  if (input.sizeBytes <= 0) {
    return { ok: false, reason: 'empty_file', limit: 0, actual: input.sizeBytes }
  }
  if (input.sizeBytes > MAX_FILE_BYTES) {
    return { ok: false, reason: 'file_too_large', limit: MAX_FILE_BYTES, actual: input.sizeBytes }
  }
  if (input.caseBytes + input.sizeBytes > MAX_CASE_BYTES) {
    return { ok: false, reason: 'case_quota_exceeded', limit: MAX_CASE_BYTES, actual: input.caseBytes + input.sizeBytes }
  }
  return { ok: true }
}
