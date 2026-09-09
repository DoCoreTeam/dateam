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

// 상한과 크기 검사는 **화면도 써야 해서** 따로 있다 —
// 이 파일은 node:crypto 를 쓰므로 클라이언트가 import 하면 통째로 죽는다.
export {
  MAX_FILE_BYTES, MAX_CASE_BYTES, checkFileSize,
  type FileRejectReason, type SizeCheckInput, type SizeCheck,
} from './limits.ts'

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
