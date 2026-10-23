// 변경 이력 「어디서」에 보일 파일 이름
//
// 텔레그램으로 받은 파일은 이름이 기계가 붙인 것이다(1712345678-AbC9xY.pdf, file_123.xlsx).
// 그 이름은 사람에게 아무 말도 안 하므로 「파일 가져오기」로 보이고, 사람이 지은 이름은 그대로 둔다.

/** 숫자-영숫자.확장자 (텔레그램 수신 저장 이름) */
const RECEIVED_STAMP = /^\d{6,}-[A-Za-z0-9_-]+(\.[A-Za-z0-9]+)?$/
/** file_숫자.확장자 (텔레그램 기본 이름) */
const TELEGRAM_DEFAULT = /^file_\d+(\.[A-Za-z0-9]+)?$/

export function isMachineFileName(name: string): boolean {
  const base = name.trim().split('/').pop() ?? ''
  return RECEIVED_STAMP.test(base) || TELEGRAM_DEFAULT.test(base)
}

/** 사람이 읽을 이름이면 그 이름, 기계 이름이거나 비었으면 null (화면이 「파일 가져오기」로 씀) */
export function readableFileName(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? ''
  if (!trimmed || isMachineFileName(trimmed)) return null
  return trimmed
}
