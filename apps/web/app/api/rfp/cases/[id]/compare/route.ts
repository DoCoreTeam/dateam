// GET /api/rfp/cases/[id]/compare — 유사 사업과 정형 비교표
//
// 임베딩으로 스무 건까지 넓게 건지고 구조화 필터로 다섯 건으로 좁힌다.
// 순서가 반대면 비슷한 뜻의 사업을 필터 밖에서 놓친다.

import { readStoredReport, REPORT_VERSION_COLUMNS } from '@/lib/rfp/report/read-version'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { findSimilar, VECTOR_TOP_K, type CaseSummary, type VectorHit } from '@/lib/rfp/compare/similar'
import { compareReports } from '@/lib/rfp/compare/diff'
import type { Report } from '@/lib/rfp/report/schema'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const db = await createClient()

  const { data: me } = await (db as any)
    .from('rfp_cases')
    .select('id, title, sector, project_type, budget_amount, duration_months, created_at')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!me) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  // 같은 조직의 다른 케이스만 후보다 — RLS 가 남의 조직 것을 아예 안 준다
  const { data: others } = await (db as any)
    .from('rfp_cases')
    .select('id, title, sector, project_type, budget_amount, duration_months, created_at')
    .neq('id', caseId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200)

  const summaries: CaseSummary[] = (others ?? []).map(toSummary)
  const { data: outcomes } = await (db as any)
    .from('rfp_outcomes')
    .select('case_id, submitted')
  const submitted = new Set((outcomes ?? []).filter((o: { submitted: boolean }) => o.submitted)
    .map((o: { case_id: string }) => o.case_id))
  for (const s of summaries) s.participated = submitted.has(s.caseId)

  // 임베딩 순위는 아직 안 붙었다 — 붙기 전에는 최근 순으로 대신한다.
  // 그 사실을 응답에 적어 화면이 「의미 검색 미적용」을 표시할 수 있게 한다
  const hits: VectorHit[] = summaries.slice(0, VECTOR_TOP_K).map((s, i) => ({
    caseId: s.caseId,
    similarity: Math.max(0.1, 1 - i * 0.03),
  }))

  const { results, excluded } = findSimilar({ target: toSummary(me), hits, summaries })

  const rows = []
  for (const r of results) {
    const [mineReport, theirsReport] = await Promise.all([
      latestReport(db, caseId),
      latestReport(db, r.caseId),
    ])
    if (!mineReport || !theirsReport) continue
    const summary = summaries.find((s) => s.caseId === r.caseId)
    rows.push(compareReports(mineReport, theirsReport, {
      caseId: r.caseId,
      title: summary?.title ?? '',
      similarity: r.similarity,
    }))
  }

  return NextResponse.json({
    similar: results,
    excluded,
    comparisons: rows,
    semanticRanking: false,
  })
}

function toSummary(row: Record<string, unknown>): CaseSummary {
  return {
    caseId: String(row.id),
    title: String(row.title ?? ''),
    agency: null,
    sector: row.sector === null || row.sector === undefined ? null : String(row.sector),
    projectType: row.project_type === null || row.project_type === undefined ? null : String(row.project_type),
    budgetAmount: row.budget_amount === null || row.budget_amount === undefined ? null : Number(row.budget_amount),
    durationMonths: row.duration_months === null || row.duration_months === undefined ? null : Number(row.duration_months),
    participated: false,
    noticeDate: row.created_at === null || row.created_at === undefined ? null : String(row.created_at),
  }
}

async function latestReport(db: unknown, caseId: string): Promise<Report | null> {
  const { data } = await (db as any)
    .from('rfp_report_versions')
    .select(REPORT_VERSION_COLUMNS)
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  return readStoredReport(data as never)?.report ?? null
}
