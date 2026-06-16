import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

// GET /api/work/projects/suggest — 본인 일일업무 기반 "예상 프로젝트 후보" 제안.
//  ⚠️ 자동 생성 금지(§5-3). 후보 리스트만 반환 → 사용자가 확인 후 POST /api/projects + confirm으로 생성.
//  방법(a): 아직 프로젝트에 연결 안 된 업무들을, 이미 autolink된 거래처/딜(work_entity_links) 기준으로 묶어
//           대표 후보명을 제안. autolink 산출(work_entity_links) 재사용 — 추가 LLM 호출 0(비용/정확도 균형).

const RECENT_LIMIT = 300        // 본인 최근 업무 스캔 상한(LIMIT 필수)
const MIN_TASKS = 2             // 후보가 되려면 최소 묶인 업무 수
const SAMPLE_MAX = 5            // 후보당 sampleLogIds 상한

interface Suggestion {
  suggestedName: string
  reason: string
  taskCount: number
  sampleLogIds: string[]
}

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  const supabase = await createClient()
  const user = auth.user

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // 1) 본인 personal 업무(최근) 로드
  const { data: logs } = await db.from('daily_logs')
    .select('id')
    .eq('user_id', user.id).eq('task_kind', 'personal')
    .order('logged_at', { ascending: false }).limit(RECENT_LIMIT)
  const logIds = ((logs ?? []) as Array<{ id: string }>).map((r) => r.id)
  if (logIds.length === 0) return NextResponse.json({ suggestions: [] })

  // 2) 이 업무들의 엔티티 링크 로드(account/deal/project)
  const { data: links } = await db.from('work_entity_links')
    .select('log_id, kind, entity_id')
    .in('log_id', logIds)
  const rows = (links ?? []) as Array<{ log_id: string; kind: string; entity_id: string }>

  // 3) 이미 프로젝트에 연결된 업무는 제외(중복 제안 방지)
  const linkedToProject = new Set(rows.filter((r) => r.kind === 'project').map((r) => r.log_id))

  // 4) account/deal 엔티티 기준 군집(프로젝트 미연결 업무만)
  const clusters = new Map<string, { kind: 'account' | 'deal'; entityId: string; logs: string[] }>()
  for (const r of rows) {
    if (r.kind !== 'account' && r.kind !== 'deal') continue
    if (linkedToProject.has(r.log_id)) continue
    const key = `${r.kind}:${r.entity_id}`
    let c = clusters.get(key)
    if (!c) { c = { kind: r.kind, entityId: r.entity_id, logs: [] }; clusters.set(key, c) }
    if (!c.logs.includes(r.log_id)) c.logs.push(r.log_id)
  }

  const eligible = Array.from(clusters.values()).filter((c) => c.logs.length >= MIN_TASKS)
  if (eligible.length === 0) return NextResponse.json({ suggestions: [] })

  // 5) 엔티티 이름 resolve(nameMap SSOT 패턴) — 후보명 원천
  const accIds = eligible.filter((c) => c.kind === 'account').map((c) => c.entityId)
  const dealIds = eligible.filter((c) => c.kind === 'deal').map((c) => c.entityId)
  const [accsN, dealsN] = await Promise.all([
    accIds.length ? db.from('accounts').select('id, name').in('id', accIds) : { data: [] },
    dealIds.length ? db.from('deals').select('id, title').in('id', dealIds) : { data: [] },
  ])
  const nameMap = new Map<string, string>()
  for (const a of (accsN.data ?? []) as Array<{ id: string; name: string }>) nameMap.set('account:' + a.id, a.name)
  for (const d of (dealsN.data ?? []) as Array<{ id: string; title: string }>) nameMap.set('deal:' + d.id, d.title)

  // 6) 후보 구성(업무 수 내림차순). 자동 생성 없음 — 제안만.
  const suggestions: Suggestion[] = eligible
    .map((c) => {
      const name = nameMap.get(`${c.kind}:${c.entityId}`)
      if (!name) return null
      const label = c.kind === 'deal' ? '딜' : '거래처'
      return {
        suggestedName: name,
        reason: `${label} "${name}" 관련 업무 ${c.logs.length}건이 아직 프로젝트로 묶이지 않았습니다`,
        taskCount: c.logs.length,
        sampleLogIds: c.logs.slice(0, SAMPLE_MAX),
      } as Suggestion
    })
    .filter((s): s is Suggestion => s !== null)
    .sort((a, b) => b.taskCount - a.taskCount)

  return NextResponse.json({ suggestions })
}
