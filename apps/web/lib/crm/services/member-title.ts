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

/** 조직에서 읽어 온 직함 조각 */
export interface OrgTitle {
  /** 직위 — 본부장·팀장·실장 */
  position: string | null
  /** 직급 — 상무·부장·차장 */
  rank: string | null
}

/**
 * 문서에 찍을 직함 하나를 고른다.
 *
 * 둘 다 있으면 **직위**를 쓴다 — 「본부장」이 「상무」보다 상대에게 역할을 알려 준다.
 * 아무것도 없으면 `''` 다. 「직원」처럼 지어내지 않는다.
 */
export function pickTitle(explicit: string | null | undefined, org: OrgTitle | null | undefined): string {
  const e = (explicit ?? '').trim()
  if (e) return e
  const p = (org?.position ?? '').trim()
  if (p) return p
  return (org?.rank ?? '').trim()
}

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
