// GET  /api/rfp/radar — 후보 목록
// POST /api/rfp/radar — 지금 훑기
//
// 자동은 **찾기까지**다. 케이스로 만드는 것은 사람이 연 뒤에 한다 —
// 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다.
//
// ## 두 단계다: 모으기 → 거르기
//
// 예전에는 거르기만 있었다. `rfp_sources` 를 훑는데 **그 표를 채우는 코드가 없어서**
// 조건을 아무리 잘 만들어도 결과가 늘 0건이었다.
// 이제 먼저 나라장터에서 기간으로 공고를 모으고(collectNotices), 그다음 조건으로 거른다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { toRadarRule } from '@/lib/rfp/radar/rules'
import { sweep, type NoticeCandidate } from '@/lib/rfp/radar/sweep'
import { collectNotices } from '@/lib/rfp/radar/collect'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_radar_hits')
    .select('id, rule_id, source_id, case_id, pre_score, reason, status, created_at')
    .eq('status', 'new')
    .order('pre_score', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: '후보를 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ hits: data ?? [] })
}

export async function POST(_req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  // ① 먼저 모은다. 못 모아도 이미 담긴 것으로 거르기는 계속한다 —
  //    나라장터가 죽었다고 어제 담은 공고까지 안 보일 이유가 없다
  const collected = await collectNotices(db as any, { orgId: String(orgId) })

  const { data: ruleRows } = await (db as any)
    .from('rfp_radar_rules')
    .select('id, name, keywords, classifications, budget_min, budget_max, agencies, enabled, last_swept_at')
    .eq('enabled', true)
  const rules = (ruleRows ?? []).map(toRadarRule)
  if (rules.length === 0) {
    return NextResponse.json({ hits: [], swept: 0, reason: 'no_rules', collected })
  }

  const { data: sourceRows } = await (db as any)
    .from('rfp_sources')
    .select('id, notice_no, title, announcing_agency, budget_amount, notice_date')
    .order('notice_date', { ascending: false })
    .limit(500)

  const candidates: NoticeCandidate[] = (sourceRows ?? []).map((r: Record<string, unknown>) => ({
    sourceId: String(r.id),
    noticeNo: String(r.notice_no ?? ''),
    title: String(r.title ?? ''),
    agency: r.announcing_agency === null || r.announcing_agency === undefined ? null : String(r.announcing_agency),
    budgetAmount: r.budget_amount === null || r.budget_amount === undefined ? null : Number(r.budget_amount),
    classification: null,
    noticeDate: r.notice_date === null || r.notice_date === undefined ? null : String(r.notice_date),
  }))

  const { data: seenRows } = await (db as any)
    .from('rfp_radar_hits')
    .select('rule_id, source_id')
  const seen = (seenRows ?? []).map((r: Record<string, unknown>) => ({
    ruleId: String(r.rule_id), sourceId: String(r.source_id),
  }))

  const hits = sweep(rules, candidates, seen)
  if (hits.length > 0) {
    // 유니크 (rule_id, source_id) 가 최종 방어다 — 크론 둘이 동시에 돌아도 한 줄이다
    await (db as any).from('rfp_radar_hits').insert(hits.map((h) => ({
      org_id: orgId,
      rule_id: h.ruleId,
      source_id: h.sourceId,
      pre_score: h.score,
      reason: h.reason,
      status: 'new',
    })))
  }

  await (db as any)
    .from('rfp_radar_rules')
    .update({ last_swept_at: new Date().toISOString() })
    .in('id', rules.map((r: { id: string }) => r.id))

  // 몇 건을 새로 모았는지 화면이 말해야 한다 — 「0건」이 «없다»인지 «못 가져왔다»인지 갈린다
  return NextResponse.json({ hits, swept: candidates.length, collected })
}
