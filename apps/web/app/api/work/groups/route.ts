import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { groupLogsByEntity, type GroupLogInput } from '@/lib/work/group-logs'

// GET /api/work/groups?by=account|deal — 내 일일업무를 고객/딜 기준으로 그룹핑(건수·상태·미리보기) + 미링크.
//  account: daily_logs.linked_account_id 기준. deal: work_entity_links(kind=deal) 기준.
export async function GET(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const by = new URL(req.url).searchParams.get('by') === 'deal' ? 'deal' : 'account'
  const supabase = await createClient()
  const user = auth.user

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: logs } = await db.from('daily_logs')
    .select('id, content, entry_type, linked_account_id')
    .eq('user_id', user.id).eq('task_kind', 'personal')
    .order('logged_at', { ascending: false }).limit(1000)
  const rows = (logs ?? []) as Array<{ id: string; content: string; entry_type: string; linked_account_id: string | null }>

  let entityOf = new Map<string, string | null>()
  if (by === 'account') {
    for (const r of rows) entityOf.set(r.id, r.linked_account_id ?? null)
  } else {
    // deal: work_entity_links(kind=deal) — 로그별 첫 매핑
    const { data: links } = await db.from('work_entity_links')
      .select('log_id, entity_id').eq('kind', 'deal').in('log_id', rows.map((r) => r.id).slice(0, 1000))
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
    const table = by === 'deal' ? 'deals' : 'accounts'
    const col = by === 'deal' ? 'title' : 'name'
    const { data: ents } = await db.from(table).select(`id, ${col}`).in('id', ids)
    for (const e of (ents ?? []) as Array<Record<string, string>>) nameMap.set(e.id, e[col] ?? '(이름없음)')
  }

  return NextResponse.json({
    by,
    groups: result.groups.map((g) => ({ ...g, name: nameMap.get(g.id) ?? '(삭제됨)' })),
    ungrouped: result.ungrouped,
  })
}
