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
import { SURFACES, grantableKeys, keyKind, parentKey, splitKey, surfaceByKey } from '@/lib/access/surfaces'
import { ACCESS_ACTION_LABEL } from '@/lib/terms'
import { rangeOfPerson, type AccessRange } from '@/lib/access/capabilities'
import { navLabel } from '@/lib/nav/menu'

export interface SurfaceRow {
  key: string
  label: string
  group_key: string
  href: string
  default_audience: string
  /** 한 단계 위 키. 표면 자신이면 null */
  parent_key: string | null
  /** 표면인가 자리인가 동작인가. 화면은 앞의 둘만 그린다 */
  kind: 'surface' | 'zone' | 'action'
  /** 부여 말고 또 무엇이 있어야 들어가나. 없으면 부여만으로 들어간다 */
  needs_membership: string | null
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
  /**
   * 이 사람이 **누구의 것을 보나**. 조직도에서 나온 값이라 여기서 정하지 않는다.
   *
   * 왜 목록에 싣나: 표면을 열어 주는 순간 이 사람은 그 화면의 **자기 범위만큼**을 본다.
   * 저장하기 전에 그 범위를 모르면 관리자는 「한 사람에게 열었다」고 생각하는데
   * 실제로는 부서 전체의 자료가 그 사람에게 보이기 시작한다.
   */
  range: AccessRange
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

  /**
   * 표면과 **등재된 구역**을 함께 쓴다.
   *
   * 구역도 행이 있어야 한다 — `access_grant.surface_key` 가 이 표에 외래키를 걸고 있어
   * 행이 없으면 구역 부여는 저장 자체가 안 선다. 즉 이 표가 곧 «부여할 수 있는 것»이고,
   * 그 목록은 코드(`grantableKeys`)가 정한다.
   *
   * 구역의 주소는 표면 주소 뒤에 이름을 붙인 것이다(경로 구역). 탭 구역은 주소가 같아서
   * 표면 주소를 그대로 쓴다 — 주소는 여기서 사람이 보는 값이지 판정이 쓰는 값이 아니다.
   */
  const now = new Date().toISOString()
  const base = SURFACES.flatMap((s) => [
    {
      key: s.key,
      label: navLabel(s.href),
      group_key: s.group,
      href: s.href,
      default_audience: s.defaultAudience,
      synced_at: now,
    },
    ...(s.zones ?? []).map((z) => ({
      key: `${s.key}:${z.name}`,
      label: z.label,
      group_key: s.group,
      href: z.tab ? `${s.href}?tab=${z.tab}` : `${s.href}/${z.name}`,
      default_audience: s.defaultAudience,
      synced_at: now,
    })),
  ])

  /**
   * 동작 키도 행을 갖는다 — 같은 외래키를 지나기 때문이다.
   * 목록은 `grantableKeys()` 가 정하고 여기서는 이름만 붙인다. 두 곳이 각자 목록을 만들면
   * 저장은 되는데 행이 없는 키, 또는 행은 있는데 저장이 안 되는 키가 생긴다.
   */
  const byKey = new Map(base.map((r) => [r.key, r]))
  const rows = grantableKeys().map((key) => {
    const own = byKey.get(key)
    if (own) return own
    const parent = byKey.get(parentKey(key) ?? '')
    const action = key.slice(key.indexOf('#') + 1) as keyof typeof ACCESS_ACTION_LABEL
    return {
      key,
      label: `${parent?.label ?? key} ${ACCESS_ACTION_LABEL[action] ?? action}`,
      group_key: parent?.group_key ?? 'standalone',
      href: parent?.href ?? '',
      default_audience: parent?.default_audience ?? 'admin',
      synced_at: now,
    }
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('access_surface').upsert(rows, { onConflict: 'key' })
  if (error) throw new Error(`표면 동기화 실패: ${error.message}`)

  const codeKeys = new Set(grantableKeys())
  return {
    justSynced: rows.filter((r) => !known.has(r.key)).length,
    orphans: [...known].filter((k) => !codeKeys.has(k)).sort(),
  }
}

/**
 * 조회 하나를 꺼내되 **조용히 비지 않게** 한다.
 *
 * **왜 필요한가** (실측 2026-09-21): `profiles` 에 없는 `email` 칼럼을 골라 읽고 있었다.
 * supabase-js 는 그걸 던지지 않고 `{ data: null, error }` 로 **돌려준다.** 그런데 부르는 쪽이
 * `data ?? []` 만 보고 있어서, 사람 고르는 목록이 **오류 한 줄 없이 빈 채로** 그려졌다.
 * 관리자 화면은 멀쩡해 보이고 아무도 못 고른다 — 조용히 0건이 되는 것이 제일 나쁘다.
 *
 * 그래서 던진다. 이 화면은 관리자 전용이고, 조회가 깨졌으면 **깨진 줄 알아야** 고친다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rows<T>(res: any, what: string): T[] {
  if (res?.error) throw new Error(`${what}을(를) 읽지 못했습니다: ${res.error.message}`)
  return (res?.data ?? []) as T[]
}

/** 화면이 그릴 것 전부. 동기화를 먼저 하므로 표면 목록은 언제나 코드와 같다 */
export async function loadAccessAdminData(): Promise<AccessAdminData> {
  const admin = createAdminClient()
  const { justSynced, orphans } = await syncSurfaces()

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const [surfaceRes, grantRes, peopleRes, nodeRes, closureRes] = await Promise.all([
    (admin as any).from('access_surface').select('key, label, group_key, href, default_audience'),
    (admin as any).from('access_grant').select('id, surface_key, subject_kind, subject_id, effect, include_descendants'),
    (admin as any).from('profiles').select('id, name').is('deleted_at', null).order('name'),
    (admin as any).from('org_nodes').select('id, type, parent_id, head_user_id, name, user_id'),
    (admin as any).from('org_node_closure').select('ancestor_id, descendant_id'),
  ])
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const nodes = rows<{ id: string; type: string; parent_id: string | null; head_user_id: string | null; name: string; user_id: string | null }>(nodeRes, '조직도')
  const closure = rows<{ ancestor_id: string; descendant_id: string }>(closureRes, '조직 계층')

  /**
   * 퇴사자는 고르는 목록에서 뺀다. 남겨 두면 나간 사람에게 문을 여는 부여가 생기고,
   * 그건 아무도 안 쓰는 부여가 아니라 **계정이 살아 있는 동안 열려 있는 문**이다.
   */
  const active = await activeMembers(
    admin,
    rows<Omit<PersonOption, 'range'>>(peopleRes, '구성원').filter((p) => p.name),
  )
  // 조직도를 사람 수만큼 다시 읽지 않는다 — 이미 읽은 nodes 로 셈만 한다
  const people: PersonOption[] = active.map((p) => ({ ...p, range: rangeOfPerson(p.id, nodes) }))

  return {
    surfaces: withParent(rows<Omit<SurfaceRow, 'parent_key' | 'kind' | 'needs_membership'>>(surfaceRes, '표면 사본')),
    grants: rows<GrantRow>(grantRes, '부여'),
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

/** 한 번만 만든다 — 요청마다 다시 만들면 25개 표면의 곱만큼 쓸데없이 돈다 */
const GRANTABLE = new Set(grantableKeys())

export interface SaveGrantInput {
  surfaceKey: string
  subjectKind: string
  subjectId: string
  effect: string
  includeDescendants: boolean
}

/**
 * 표면 먼저, 그 아래 구역 — 화면이 순서를 다시 정하지 않게 서버가 정렬해서 준다.
 *
 * 구역이 표면에서 떨어져 나오면 관리자는 `work:activity` 가 어디에 속한 자리인지
 * 키를 읽어 짐작해야 한다. 짐작으로 허용하거나 차단하게 두지 않는다.
 */
export function withParent(rows: readonly Omit<SurfaceRow, 'parent_key' | 'kind' | 'needs_membership'>[]): SurfaceRow[] {
  const RANK = { surface: 0, zone: 1, action: 2 } as const
  return rows
    .map((r) => ({
      ...r,
      parent_key: parentKey(r.key),
      kind: keyKind(r.key),
      // 진실은 코드 등재부다 — DB 사본에 안 싣는다. 사본에 실으면 문구를 고쳐도 옛 말이 남는다
      needs_membership: surfaceByKey(r.key)?.needsMembership ?? null,
    }))
    .sort((a, b) => {
      const an = a.kind === 'surface' ? a.key : a.key.split(/[:#]/)[0]
      const bn = b.kind === 'surface' ? b.key : b.key.split(/[:#]/)[0]
      if (an !== bn) return an.localeCompare(bn)
      return RANK[a.kind] - RANK[b.kind] || a.key.localeCompare(b.key)
    })
}

/** 모르는 값을 걸러 낸다. 통과한 것만 저장한다 */
export async function validateGrant(input: SaveGrantInput): Promise<string | null> {
  /**
   * **부여할 수 있는 키**인가 — 표면·등재된 자리·그 둘의 동작.
   *
   * 등재 안 된 자리는 판정은 되지만 저장은 안 된다. 저장해 두면 그 행이 아무 자리도
   * 안 가리키는 부여가 되고, 관리자는 열었다고 믿는다.
   * 목록은 `grantableKeys()` 한 곳이다 — 동기화가 쓰는 목록과 같아야 외래키가 선다.
   */
  if (!GRANTABLE.has(input.surfaceKey)) return '등재부에 없는 표면입니다'
  if (input.subjectKind !== 'user' && input.subjectKind !== 'org') return '주체 종류가 사람이나 조직이 아닙니다'
  if (input.effect !== 'allow' && input.effect !== 'deny') return '허용이나 차단이 아닙니다'

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
  if (error) return `저장 실패: ${error.message}`

  /**
   * 문을 열었으면 **들어갈 자리도 만든다.** 여기서 실패해도 부여는 남긴다 —
   * 부여까지 되돌리면 관리자는 저장 자체가 안 된 줄 알고 같은 일을 다시 한다.
   */
  try {
    await ensureServiceSeat(input)
  } catch (e) {
    return `문은 열었는데 서비스 자리를 못 만들었습니다: ${e instanceof Error ? e.message : String(e)}`
  }
  return null
}

/**
 * 서비스 표면을 사람에게 허용하면 **그 서비스의 자리까지 만든다** (I11a).
 *
 * ## 왜 필요한가 (실측 2026-09-22)
 *
 * 테스트 계정에 영업 CRM 을 열어 주고 메뉴를 눌렀더니
 * 「영업 CRM 사용 권한이 없습니다. 관리자에게 요청해 주세요」가 떴다.
 * 서비스는 자기 멤버 표를 따로 보기 때문이다. 메뉴는 부여로 뜨고 문은 멤버 표로 막히니
 * **죽은 문**이고, 그건 이 판이 없애려던 바로 그것이다.
 *
 * ## 왜 요청 중이 아니라 저장할 때인가
 *
 * 들어오는 요청마다 몰래 자리를 만들면 관리자는 자기가 무엇을 만들었는지 모른다.
 * 저장은 관리자가 **명시적으로 누른 한 번**이라, 그 자리에서 만드는 것이 설명된다.
 *
 * ## 무엇을 만드나
 *
 * 가장 낮은 등급(READONLY)이다. 「보라고 열어 줬다」가 부여의 뜻이고, 그보다 더 주는 것은
 * 관리자가 CRM 멤버 화면에서 따로 올린다. 이미 자리가 있으면 **손대지 않는다** —
 * 등급을 덮으면 올려 둔 권한이 조용히 내려간다.
 *
 * 부여를 지울 때 자리를 지우지는 않는다. 그 사람에게 딸린 기록(담당·감사 로그)이 남아 있고,
 * 문은 서비스 셸의 접근권한 판정이 닫는다.
 */
async function ensureServiceSeat(input: SaveGrantInput): Promise<void> {
  if (input.effect !== 'allow') return
  if (input.surfaceKey.includes('#')) return
  const { surfaceKey, zone } = splitKey(input.surfaceKey)
  if (zone !== null) return
  if (!surfaceByKey(surfaceKey)?.autoSeat) return

  const admin = createAdminClient()
  const userIds = input.subjectKind === 'user'
    ? [input.subjectId]
    : await orgMemberUserIds(admin, input.subjectId, input.includeDescendants)
  if (userIds.length === 0) return

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const { data: seated } = await (admin as any)
    .from('crm_member').select('hostUserId').in('hostUserId', userIds).is('deletedAt', null)
  const has = new Set(((seated ?? []) as { hostUserId: string }[]).map((r) => r.hostUserId))
  const missing = userIds.filter((id) => !has.has(id))
  if (missing.length === 0) return

  // 워크스페이스는 하나다. 이름을 코드에 박지 않고 이미 있는 자리에서 꺼낸다
  const { data: anyMember } = await (admin as any)
    .from('crm_member').select('workspaceId').limit(1).maybeSingle()
  const workspaceId = (anyMember as { workspaceId?: string } | null)?.workspaceId
  if (!workspaceId) throw new Error('영업 CRM 워크스페이스를 찾지 못했습니다')

  const { data: profileRows } = await (admin as any)
    .from('profiles').select('id, name').in('id', missing)
  const nameOf = new Map(((profileRows ?? []) as { id: string; name: string | null }[]).map((p) => [p.id, p.name]))

  const rowsToAdd: Record<string, unknown>[] = []
  for (const id of missing) {
    /**
     * 메일 주소는 `auth.users` 에만 있다 — `profiles` 에는 그 칼럼이 없다.
     * `crm_member.email` 은 NOT NULL 이라 빠뜨리면 자리 만들기가 통째로 실패한다
     * (실측 2026-09-22: 첫 판이 그대로 실패했다).
     */
    const { data: authUser } = await admin.auth.admin.getUserById(id)
    const email = authUser?.user?.email
    // 메일이 없는 계정 하나 때문에 나머지를 못 앉히지 않는다. 남은 사람은 아래 반환이 센다
    if (!email) continue
    rowsToAdd.push({
      id: `mb_grant_${id.slice(0, 8)}_${Date.now().toString(36)}`,
      workspaceId,
      hostUserId: id,
      role: 'READONLY',
      displayName: nameOf.get(id) ?? email,
      email,
      capabilities: [],
    })
  }
  if (rowsToAdd.length === 0) return

  const { error: seatError } = await (admin as any).from('crm_member').insert(rowsToAdd)
  if (seatError) throw new Error(seatError.message)
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * 조직 하나에 걸리는 사람들 — **`appliesToMe` 와 같은 규칙**이어야 한다.
 *
 * 하위 포함이면 조상 사슬로 걸리는 사람 전부, 아니면 그 조직에 직접 속한 사람만이다.
 * 여기서 다르게 세면 관리자가 연 사람 수와 실제로 자리가 생기는 사람 수가 어긋나고,
 * 어긋난 쪽은 «열어 줬는데 못 들어가는 사람»으로 남는다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function orgMemberUserIds(admin: any, orgId: string, includeDescendants: boolean): Promise<string[]> {
  let parents = [orgId]
  if (includeDescendants) {
    const { data } = await admin
      .from('org_node_closure').select('descendant_id').eq('ancestor_id', orgId)
    parents = [...new Set([orgId, ...((data ?? []) as { descendant_id: string }[]).map((r) => r.descendant_id)])]
  }
  const { data: people } = await admin
    .from('org_nodes').select('user_id').eq('type', 'person').in('parent_id', parents)
  return [...new Set(((people ?? []) as { user_id: string | null }[]).map((p) => p.user_id).filter((id): id is string => Boolean(id)))]
}

export async function removeGrant(id: string): Promise<string | null> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('access_grant').delete().eq('id', id)
  return error ? `삭제 실패: ${error.message}` : null
}
