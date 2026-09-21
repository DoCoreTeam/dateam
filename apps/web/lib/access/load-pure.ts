/**
 * 부여를 읽을 때의 **순수한 부분** — 조회 없이 판정만
 *
 * 왜 갈랐나: `load.ts` 는 `lib/supabase/server` 를 부르고 그쪽은 `server-only` 를 달고 있어
 * node 시험 러너가 해석하지 못한다. `org-scope.ts` 와 `org-scope-pure.ts` 가 같은 이유로
 * 같은 모양으로 갈려 있다 — 시험이 닿는 자리를 따로 둔다.
 *
 * 여기 있는 것: 부여 한 줄이 나에게 걸리는가, DB 줄을 판정 함수의 꼴로 바꾸는 일.
 * 여기 없는 것: 조회. 조회는 `load.ts` 가 하고 왕복 수도 거기서 정해진다.
 */

import type { Grant, Viewer } from './decide.ts'

/** DB 한 줄 그대로 */
export interface GrantRow {
  surface_key: string
  subject_kind: string
  subject_id: string
  effect: string
  include_descendants: boolean
}

export interface ViewerAccess {
  viewer: Viewer
  /** **이 사람에게 걸린 것만**. 남의 부여는 여기 오지 않는다 */
  grants: Grant[]
}

/** 내가 속한 조직 — 직접 소속과, 위로 이어진 것까지 */
export interface OrgMembership {
  /** 내 사람 노드의 부모. 「하위 포함」을 끈 부여는 여기만 본다 */
  direct: string[]
  /** 조상들까지 (직접 소속 포함). 「하위 포함」 부여는 여기를 본다 */
  withAncestors: string[]
}

/**
 * 부여 한 줄이 나에게 걸리나.
 *
 * 조직 부여에서 「하위 포함」이 꺼져 있으면 **그 부서에 직접 속한 사람만**이다.
 * 켜져 있으면 그 부서 아래 어디에 있어도 걸린다 — 내 조상 목록에 그 부서가 있으면 된다.
 * 모르는 주체 종류는 **걸리지 않는다** — 판정이 못 읽는 값이 조용히 문을 열면 안 된다.
 */
export function appliesToMe(row: GrantRow, userId: string, org: OrgMembership): boolean {
  if (row.subject_kind === 'user') return row.subject_id === userId
  if (row.subject_kind !== 'org') return false
  return row.include_descendants
    ? org.withAncestors.includes(row.subject_id)
    : org.direct.includes(row.subject_id)
}

/** DB 줄을 판정 함수가 읽는 꼴로. 모르는 값이 섞이면 걸러 낸다 */
export function toGrants(rows: readonly GrantRow[], userId: string, org: OrgMembership): Grant[] {
  return rows
    .filter((r) => (r.effect === 'allow' || r.effect === 'deny') && appliesToMe(r, userId, org))
    .map((r) => ({
      surfaceKey: r.surface_key,
      subject: { kind: r.subject_kind === 'user' ? 'user' as const : 'org' as const, id: r.subject_id },
      effect: r.effect === 'deny' ? 'deny' as const : 'allow' as const,
    }))
}

/**
 * 부여를 읽어 줄 곳. 시험이 왕복 수를 셀 수 있게 밖에서 넣는다.
 * `rows(subjectIds)` 는 그 주체들에게 걸린 부여를 **한 번에** 돌려준다.
 */
export interface AccessSource {
  myOrgs(userId: string): Promise<OrgMembership>
  rows(subjectIds: readonly string[]): Promise<GrantRow[]>
}

/** 한 요청분을 모은다 — 조회는 `source` 가 하고 여기서는 합치기만 한다 */
export async function collectViewerAccess(
  userId: string,
  isAdmin: boolean,
  source: AccessSource,
): Promise<ViewerAccess> {
  const org = await source.myOrgs(userId)
  const rows = await source.rows([userId, ...org.withAncestors])
  return {
    viewer: { userId, isAdmin, orgIds: org.withAncestors },
    grants: toGrants(rows, userId, org),
  }
}
