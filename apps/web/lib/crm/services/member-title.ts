/**
 * 담당자의 «직위» — 조직에서 가져온다 (SSOT)
 *
 * **왜 CRM 이 자기 칸만 보면 안 되나**: `crm_member.title` 은 손으로 채우는 칸이라 전부 비어 있었다.
 * 그래서 견적서에 「김도현」만 찍혔다. 그런데 호스트 `profiles` 에는 이미
 * **`rank`(직급, 예: 상무)와 `position`(직위, 예: 본부장)** 이 들어 있다 —
 * 사람이 두 번 입력할 일이 아니라 **한 곳에서 읽을 일**이다.
 * (사용자 지적: 「조직도상 김도현 본부장 또는 상무 이거가 나와줘야해」)
 *
 * **우선순위**: CRM 에서 직접 지정한 것 > 조직의 직위 > 조직의 직급.
 * 직접 지정을 맨 앞에 두는 이유: 대외 문서에 다른 직함을 쓰고 싶은 경우가 실제로 있다
 * (겸직·대외 직함). 그때 조직 값이 덮어쓰면 고칠 방법이 없다.
 */

/**
 * 고르는 규칙은 `title-rule.ts` 에 있다 — 화면 부품도 그 규칙을 쓰는데,
 * 이 파일은 서버 전용 모듈을 끌고 들어와서 클라이언트 번들에 못 들어간다(빌드 실패 실측 2026-09-23).
 * 여기서 다시 내보내므로 예전부터 이 파일을 부르던 자리는 그대로다.
 */
export { pickTitle, type OrgTitle } from './title-rule.ts'
import type { OrgTitle } from './title-rule.ts'

/**
 * 호스트 프로필에서 직위·직급을 읽는다.
 *
 * **실패해도 던지지 않는다.** 직함을 못 읽었다고 견적서가 안 나오면 안 된다 —
 * 이름만으로도 문서는 성립한다.
 */
export async function readOrgTitle(hostUserId: string | null | undefined): Promise<OrgTitle | null> {
  if (!hostUserId) return null
  try {
    const { createAdminClient } = await import('../../supabase/server.ts')
    const sb = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (sb.from('profiles') as any)
      .select('rank, position')
      .eq('id', hostUserId)
      .maybeSingle() as { data: { rank: string | null; position: string | null } | null }
    return data ? { position: data.position, rank: data.rank } : null
  } catch {
    return null
  }
}
