import 'server-only'

/**
 * 접근권한 화면이 쓰는 서버 쪽 일 — **한 곳에서만** 한다
 *
 * 창구(`app/api/admin/access/route.ts`)와 화면(`page.tsx`)이 각자 검사를 적으면
 * 한쪽만 고쳐지는 날이 온다. 검사도 저장도 여기 한 벌만 둔다.
 *
 * ## 진실은 코드에 있다
 *
 * 표면 목록의 진실은 `lib/access/surfaces.ts` 다. DB 의 `access_surface` 는 사본이고,
 * 동기화는 **코드에서 DB 로 한 방향**뿐이다. 반대로 흐르면 화면을 지웠는데 표에는 남아
 * 관리자 화면에 **없는 문**이 그려진다.
 *
 * ## 모르는 값은 저장하지 않는다
 *
 * 표면 키는 등재부와, 주체 id 는 실제 사람·조직 행과 대조한다. 대조 없이 넣으면
 * 오타 하나가 「아무에게도 안 걸리는 부여」가 되어 **관리자는 열어 줬다고 믿는데 안 열린다.**
 */

import { createAdminClient } from '@/lib/supabase/server'
import { activeMembers } from '@/lib/members/resigned-server'
import { SURFACES, surfaceByKey } from '@/lib/access/surfaces'
import { navLabel } from '@/lib/nav/menu'

export interface SurfaceRow {
  key: string
  label: string
  group_key: string
  href: string
  default_audience: string
}

export interface GrantRow {
  id: string
  surface_key: string
  subject_kind: 'user' | 'org'
  subject_id: string
  effect: 'allow' | 'deny'
  include_descendants: boolean
}

export interface PersonOption {
  id: string
  name: string
  email: string | null
}

export interface OrgOption {
  id: string
  name: string
  /** 이 조직에 직접 속한 사람 수 */
  directCount: number
  /** 하위 조직까지 합친 사람 수 */
  subtreeCount: number
}

export interface AccessAdminData {
  surfaces: SurfaceRow[]
  grants: GrantRow[]
  people: PersonOption[]
  orgs: OrgOption[]
  /** 코드에 있는데 DB 에 없어서 이번에 넣은 표면 수 */
  justSynced: number
  /** DB 에 있는데 코드에 없는 표면 — 사람이 봐야 한다 */
  orphans: string[]
}

/** 코드 등재부를 DB 사본에 맞춘다. **넣고 고치기만 하고 지우지 않는다** */
export async function syncSurfaces(): Promise<{ justSynced: number; orphans: string[] }> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: before } = await (admin as any).from('access_surface').select('key')
  const known = new Set(((before ?? []) as { key: string }[]).map((r) => r.key))

  const rows = SURFACES.map((s) => ({
    key: s.key,
    label: navLabel(s.href),
    group_key: s.group,
    href: s.href,
    default_audience: s.defaultAudience,
    synced_at: new Date().toISOString(),
  }))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('access_surface').upsert(rows, { onConflict: 'key' })
  if (error) throw new Error(`표면 동기화 실패: ${error.message}`)

  const codeKeys = new Set(SURFACES.map((s) => s.key))
  return {
    justSynced: rows.filter((r) => !known.has(r.key)).length,
    orphans: [...known].filter((k) => !codeKeys.has(k)).sort(),
  }
}

/** 화면이 그릴 것 전부. 동기화를 먼저 하므로 표면 목록은 언제나 코드와 같다 */
export async function loadAccessAdminData(): Promise<AccessAdminData> {
  const admin = createAdminClient()
  const { justSynced, orphans } = await syncSurfaces()

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [surfaceRes, grantRes, peopleRes, nodeRes, closureRes] = await Promise.all([
    (admin as any).from('access_surface').select('key, label, group_key, href, default_audience'),
    (admin as any).from('access_grant').select('id, surface_key, subject_kind, subject_id, effect, include_descendants'),
    (admin as any).from('profiles').select('id, name, email').is('deleted_at', null).order('name'),
    (admin as any).from('org_nodes').select('id, type, parent_id, name, user_id'),
    (admin as any).from('org_node_closure').select('ancestor_id, descendant_id'),
  ])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const nodes = (nodeRes.data ?? []) as { id: string; type: string; parent_id: string | null; name: string; user_id: string | null }[]
  const closure = (closureRes.data ?? []) as { ancestor_id: string; descendant_id: string }[]

  /**
   * 퇴사자는 고르는 목록에서 뺀다. 남겨 두면 나간 사람에게 문을 여는 부여가 생기고,
   * 그건 아무도 안 쓰는 부여가 아니라 **계정이 살아 있는 동안 열려 있는 문**이다.
   */
  const people = await activeMembers(admin, ((peopleRes.data ?? []) as PersonOption[]).filter((p) => p.name))

  return {
    surfaces: ((surfaceRes.data ?? []) as SurfaceRow[]).sort((a, b) => a.key.localeCompare(b.key)),
    grants: (grantRes.data ?? []) as GrantRow[],
    people,
    orgs: orgOptions(nodes, closure),
    justSynced,
    orphans,
  }
}

/**
 * 조직 하나가 **몇 사람에게 걸리는가**.
 *
 * 화면이 이 숫자를 미리 보여 준다. 숫자가 없으면 관리자는 「본부에 열면 몇 명인가」를
 * 모른 채 저장하게 되고, 그건 열어 놓고 확인을 나중으로 미루는 일이다.
 * 세는 규칙은 `lib/access/load-pure.ts` 의 `appliesToMe` 와 같아야 한다 —
 * 하위 포함이면 조상 사슬, 아니면 직접 소속.
 */
export function orgOptions(
  nodes: readonly { id: string; type: string; parent_id: string | null; name: string; user_id: string | null }[],
  closure: readonly { ancestor_id: string; descendant_id: string }[],
): OrgOption[] {
  const people = nodes.filter((n) => n.type === 'person' && n.user_id)
  const descendants = new Map<string, Set<string>>()
  for (const c of closure) {
    if (!descendants.has(c.ancestor_id)) descendants.set(c.ancestor_id, new Set())
    descendants.get(c.ancestor_id)!.add(c.descendant_id)
  }

  return nodes
    .filter((n) => n.type !== 'person')
    .map((n) => {
      const under = descendants.get(n.id) ?? new Set([n.id])
      under.add(n.id)
      return {
        id: n.id,
        name: n.name,
        directCount: people.filter((p) => p.parent_id === n.id).length,
        subtreeCount: people.filter((p) => p.parent_id && under.has(p.parent_id)).length,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface SaveGrantInput {
  surfaceKey: string
  subjectKind: string
  subjectId: string
  effect: string
  includeDescendants: boolean
}

/** 모르는 값을 걸러 낸다. 통과한 것만 저장한다 */
export async function validateGrant(input: SaveGrantInput): Promise<string | null> {
  if (!surfaceByKey(input.surfaceKey)) return '등재부에 없는 표면입니다'
  if (input.subjectKind !== 'user' && input.subjectKind !== 'org') return '주체 종류가 사람이나 조직이 아닙니다'
  if (input.effect !== 'allow' && input.effect !== 'deny') return '열기나 막기가 아닙니다'

  const admin = createAdminClient()
  const table = input.subjectKind === 'user' ? 'profiles' : 'org_nodes'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any).from(table).select('id').eq('id', input.subjectId).maybeSingle()
  if (!data) return input.subjectKind === 'user' ? '없는 사람입니다' : '없는 조직입니다'
  return null
}

/** 같은 표면·같은 주체는 한 줄이다 — 두 줄이면 어느 쪽이 이기는지 사람이 알 수 없다 */
export async function saveGrant(input: SaveGrantInput, actorId: string): Promise<string | null> {
  const invalid = await validateGrant(input)
  if (invalid) return invalid

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('access_grant').upsert(
    {
      surface_key: input.surfaceKey,
      subject_kind: input.subjectKind,
      subject_id: input.subjectId,
      effect: input.effect,
      include_descendants: input.includeDescendants,
      created_by: actorId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'surface_key,subject_kind,subject_id' },
  )
  return error ? `저장 실패: ${error.message}` : null
}

export async function removeGrant(id: string): Promise<string | null> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('access_grant').delete().eq('id', id)
  return error ? `삭제 실패: ${error.message}` : null
}
