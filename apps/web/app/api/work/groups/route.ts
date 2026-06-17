import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { groupLogsByEntity, type GroupLogInput } from '@/lib/work/group-logs'

// GET /api/work/groups?by=account|deal|project — 내 일일업무를 고객/딜/프로젝트 기준으로 그룹핑(건수·상태·미리보기) + 미링크.
//  account: daily_logs.linked_account_id 기준. deal/project: work_entity_links(kind=deal|project) 기준(동형 패턴).
type Axis = 'account' | 'deal' | 'project'
// work_entity_links 기반 축(deal/project)의 이름 resolve 메타. SSOT로 분기 1곳에 둔다.
const LINK_AXIS: Record<'deal' | 'project', { table: string; col: string }> = {
  deal: { table: 'deals', col: 'title' },
  project: { table: 'projects', col: 'name' },
}

function parseAxis(v: string | null): Axis {
  return v === 'deal' || v === 'project' ? v : 'account'
}

export async function GET(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const by = parseAxis(new URL(req.url).searchParams.get('by'))
  const supabase = await createClient()
  const user = auth.user

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: logs } = await db.from('daily_logs')
    .select('id, content, entry_type, linked_account_id')
    .eq('user_id', user.id).eq('task_kind', 'personal')
    .eq('is_onboarding', false)  // onboarding: 엔티티 기준 집계(관여분포) — 실습 행 제외
    .order('logged_at', { ascending: false }).limit(1000)
  const rows = (logs ?? []) as Array<{ id: string; content: string; entry_type: string; linked_account_id: string | null }>

  const entityOf = new Map<string, string | null>()
  if (by === 'account') {
    for (const r of rows) entityOf.set(r.id, r.linked_account_id ?? null)
  } else {
    // deal/project: work_entity_links(kind) — 로그별 첫 매핑 (동일 패턴, kind만 분기)
    const { data: links } = await db.from('work_entity_links')
      .select('log_id, entity_id').eq('kind', by).in('log_id', rows.map((r) => r.id).slice(0, 1000))
    const m = new Map<string, string>()
    for (const l of (links ?? []) as Array<{ log_id: string; entity_id: string }>) if (!m.has(l.log_id)) m.set(l.log_id, l.entity_id)
    for (const r of rows) entityOf.set(r.id, m.get(r.id) ?? null)
  }

  const input: GroupLogInput[] = rows.map((r) => ({ id: r.id, content: r.content, entry_type: r.entry_type as GroupLogInput['entry_type'], entityId: entityOf.get(r.id) ?? null }))
  const result = groupLogsByEntity(input)

  // 이름 resolve
  const ids = result.groups.map((g) => g.id)
  const nameMap = new Map<string, string>()
  if (ids.length > 0) {
    const meta = by === 'account' ? { table: 'accounts', col: 'name' } : LINK_AXIS[by]
    let q = db.from(meta.table).select(`id, ${meta.col}`).in('id', ids)
    // projects는 소프트삭제(deleted_at) 보유 → 삭제된 프로젝트는 이름 미노출(폴백 '(삭제됨)').
    // accounts/deals는 하드삭제(soft-delete 컬럼 없음) → 그대로 둔다.
    if (by === 'project') q = q.is('deleted_at', null)
    const { data: ents } = await q
    for (const e of (ents ?? []) as Array<Record<string, string>>) nameMap.set(e.id, e[meta.col] ?? '(이름없음)')
  }

  return NextResponse.json({
    by,
    groups: result.groups.map((g) => ({ ...g, name: nameMap.get(g.id) ?? '(삭제됨)' })),
    ungrouped: result.ungrouped,
  })
}
