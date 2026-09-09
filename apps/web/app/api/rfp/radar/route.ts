// GET  /api/rfp/radar — 후보 목록
// POST /api/rfp/radar — 지금 훑기
//
// 자동은 **찾기까지**다. 케이스로 만드는 것은 사람이 연 뒤에 한다 —
// 자동으로 만들면 분석 비용이 자동으로 나가고 아무도 안 볼 리포트가 쌓인다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { toRadarRule } from '@/lib/rfp/radar/rules'
import { sweep, type NoticeCandidate } from '@/lib/rfp/radar/sweep'

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

  const { data: ruleRows } = await (db as any)
    .from('rfp_radar_rules')
    .select('id, name, keywords, classifications, budget_min, budget_max, agencies, enabled, last_swept_at')
    .eq('enabled', true)
  const rules = (ruleRows ?? []).map(toRadarRule)
  if (rules.length === 0) return NextResponse.json({ hits: [], swept: 0, reason: 'no_rules' })

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

  return NextResponse.json({ hits, swept: candidates.length })
}
