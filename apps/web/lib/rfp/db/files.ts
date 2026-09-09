/**
 * 첨부 파일 인입 규칙 (설계서 3.2.1, 3.7.3)
 *
 * ## 왜 검사를 순수 함수로 빼나
 *
 * 상한과 중복 판정은 **거절 사유가 사용자에게 그대로 보이는** 자리다.
 * 라우트 안에 섞여 있으면 「왜 거절됐는지」를 화면과 테스트가 각자 추측하게 된다.
 *
 * ## 같은 파일을 두 번 올리면
 *
 * 막되 **버리지 않는다.** 나라장터 묶음에는 같은 서식이 여러 번 들어 있고,
 * 사용자는 정정공고를 받아 다시 올린다. 「이미 있음」이라고만 하면
 * 사용자는 자기가 뭘 잘못했는지 모른다 — **기존 파일을 가리켜 준다.**
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

/** 파일 내용의 지문. 같은 파일인지는 이름이 아니라 이것으로 안다 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(bytes).digest('hex')
}

export interface ExistingFile {
  id: string
  originalName: string
  sha256: string
}

export type DedupeResult =
  | { duplicate: false }
  /** 이미 있는 파일. 사용자에게 어느 파일인지 알려 준다 */
  | { duplicate: true; existing: ExistingFile }

/**
 * 같은 케이스에 같은 내용이 이미 있나.
 *
 * 이름이 달라도 내용이 같으면 같은 파일이다 — 「(붙임1)서식.hwp」와 「서식(1).hwp」는
 * 사람 눈에는 둘이지만 파싱하면 같은 결과가 두 벌 쌓인다.
 */
export function findDuplicate(sha: string, existing: readonly ExistingFile[]): DedupeResult {
  const hit = existing.find((f) => f.sha256 === sha)
  return hit ? { duplicate: true, existing: hit } : { duplicate: false }
}
