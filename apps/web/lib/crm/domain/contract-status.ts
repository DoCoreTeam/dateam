/**
 * 계약서 상태 — 무엇을 할 수 있나 (P0132 I08)
 *
 * **상태는 넷이고 보냄은 상태가 아니다.** 보냄은 「그 버전을 고객에게 냈다」는 체크다
 * (견적서와 같다, 용어집 「문서 말」). 보낸 뒤에도 작성 중이면 고칠 수 있고, 고치면 다음 버전이다.
 *
 * 체결하면 글이 굳는다. 체결한 계약을 바꾸려면 변경 계약서를 새로 만든다(I10).
 * 화면과 서버가 같은 판정을 읽도록 규칙은 여기 한 곳에 둔다.
 */

export type ContractStatus = 'DRAFT' | 'CONCLUDED' | 'TERMINATED' | 'CANCELLED'

export const CONTRACT_STATUSES: readonly ContractStatus[] = ['DRAFT', 'CONCLUDED', 'TERMINATED', 'CANCELLED']

/** 상태마다 갈 수 있는 곳. 끝난 상태에서는 어디로도 안 간다 */
export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ['CONCLUDED', 'CANCELLED'],
  CONCLUDED: ['TERMINATED'],
  TERMINATED: [],
  CANCELLED: [],
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to)
}

/** 새 버전을 쓸 수 있나 — 작성 중일 때만. 체결 뒤의 글은 그날 날인한 글이다 */
export function canWriteVersion(status: string): boolean {
  return status === 'DRAFT'
}

/**
 * 계약서를 만들 수 있는 견적 상태 — 보냄 또는 수락.
 * 작성 중 견적은 아직 고객과 합의한 값이 아니다. 거절이나 만료된 견적으로 계약서를 쓰면
 * 고객이 안 받은 값이 계약서에 들어간다.
 */
export const CONTRACTABLE_QUOTE_STATUSES: readonly string[] = ['SENT', 'ACCEPTED']

export function canContractFromQuote(quoteStatus: string): boolean {
  return CONTRACTABLE_QUOTE_STATUSES.includes(quoteStatus)
}

/** 버전이 생긴 까닭. 버전 기록에 이 말로 남는다 */
export type ContractVersionKind = 'GENERATED' | 'EDITED' | 'AI_EDIT' | 'REFILLED'
