/**
 * 이메일 가리기 — 순수 함수 (테스트가 읽을 수 있게 따로 둔다)
 *
 * 로그를 보는 사람이 누구 계정이 찔렸는지는 알아야 하지만,
 * 기록 자체가 계정 목록이 되면 안 된다.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return '(형식 아님)'
  const name = email.slice(0, at)
  const head = name.slice(0, Math.min(2, name.length))
  return `${head}${'*'.repeat(Math.max(1, name.length - head.length))}${email.slice(at)}`
}
