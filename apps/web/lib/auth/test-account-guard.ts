/**
 * 시험 계정이 관리자로 남는 것을 막는 판정 (REQ-001)
 *
 * 실측 2026-10-23: 운영 구성원 화면에 관리자 권한의 「AI채팅테스트」 「테스터」(test@test.com) 계정이 남아 있었다.
 * 관리자 수를 세는 곳도, 시험 계정을 짚는 곳도 없어 아무도 몰랐다.
 * 화면은 관리자 수를 늘 보이고, 시험으로 보이는 관리자를 따로 짚는다.
 */

const TEST_EMAIL = /^(test|tester|qa|f10-)[^@]*@|@(test|example)\.(com|co\.kr|org)$/i
const TEST_NAME = /테스트|테스터|\btest\b/i

export function looksLikeTestAccount(email: string | null | undefined, name: string | null | undefined): boolean {
  return TEST_EMAIL.test(email ?? '') || TEST_NAME.test(name ?? '')
}

export interface AdminSummary {
  adminCount: number
  /** 관리자이면서 시험 계정처럼 보이는 사람 id */
  suspiciousAdminIds: string[]
}

export function summarizeAdmins(
  profiles: readonly { id: string; role: string; name: string | null }[],
  emailOf: (id: string) => string | null | undefined,
): AdminSummary {
  const admins = profiles.filter((p) => p.role === 'admin')
  return {
    adminCount: admins.length,
    suspiciousAdminIds: admins.filter((p) => looksLikeTestAccount(emailOf(p.id), p.name)).map((p) => p.id),
  }
}

/**
 * 시험 계정 스크립트가 돌아도 되나. .env.local 은 운영 DB 를 가리키므로 스크립트는 언제나 운영에 쓴다.
 * 그래서 「운영에 쓴다」를 사람이 명시해야 돌고, 관리자 권한은 어떤 경우에도 주지 않는다.
 */
export function testAccountRunError(args: readonly string[], role: string): string | null {
  if (role === 'admin') return '시험 계정에 관리자 권한을 줄 수 없어요'
  if (!args.includes('--confirm-production')) return '운영 DB 에 계정을 만듭니다. 맞으면 --confirm-production 을 붙여 다시 실행하세요'
  return null
}
