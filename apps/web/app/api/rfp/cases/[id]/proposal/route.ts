// POST /api/rfp/cases/[id]/proposal — 제안서 목차와 전략 만들기
//
// 목차는 **평가 기준 배점**에서 파생된다. 우리가 쓰고 싶은 순서가 아니라 배점표 순서다 —
// 배점표에 있는 장이 목차에 없으면 평가위원이 점수를 줄 자리를 못 찾는다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { buildOutline, uncoveredRequirements, type EvaluationCriterion } from '@/lib/rfp/proposal/outline'
import { buildStrategy } from '@/lib/rfp/proposal/strategy'
import { SOFT_WEIGHTS, type Assessment } from '@/lib/rfp/fit/assess'
import type { Requirement } from '@/lib/rfp/structure/requirements'
import type { Report, ValueNode } from '@/lib/rfp/report/schema'
import type { Anomaly } from '@/lib/rfp/anomaly/engine'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const db = await createClient()

  const { data: kase } = await (db as any)
    .from('rfp_cases')
    .select('id, org_id')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!kase) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  const { data: version } = await (db as any)
    .from('rfp_report_versions')
    .select('id, report')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!version) return NextResponse.json({ error: 'no_report' }, { status: 409 })

  const report = version.report as Report
  const criteria = criteriaOf(report)
  const requirements = requirementsOf(report)

  let body: { maxPages?: unknown } = {}
  try {
    body = (await req.json()) as { maxPages?: unknown }
  } catch {
    // 본문 없이 불러도 된다
  }
  const maxPages = Number.isFinite(Number(body.maxPages)) ? Number(body.maxPages) : null

  const outline = buildOutline({ criteria, requirements, maxPages })

  const { data: fit } = await (db as any)
    .from('rfp_fit_assessments')
    .select('id, verdict, score, parts, hard_checks, gaps, profile_version, report_version')
    .eq('case_id', caseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const strategy = fit
    ? buildStrategy(toAssessment(fit), anomaliesOf(report), SOFT_WEIGHTS as unknown as Record<string, number>)
    : null

  const { data, error } = await (db as any)
    .from('rfp_proposals')
    .insert({
      org_id: kase.org_id,
      case_id: caseId,
      report_version_id: version.id,
      fit_id: fit?.id ?? null,
      outline,
      strategy: strategy ?? {},
      created_by: gate.user.id,
    })
    .select('id, created_at')
    .single()

  if (error) return NextResponse.json({ error: '제안서 초안을 저장하지 못했습니다' }, { status: 500 })

  return NextResponse.json({
    proposal: data,
    outline,
    strategy,
    // 제안서에 빠지면 감점이다
    uncovered: uncoveredRequirements(outline, requirements).map((r) => r.code),
  }, { status: 201 })
}

function criteriaOf(report: Report): EvaluationCriterion[] {
  const node = (report.evaluation as Record<string, ValueNode<unknown>>)?.criteria
  const v = node?.value
  if (!Array.isArray(v)) return []
  return v
    .map((c) => c as { name?: unknown; points?: unknown; blockId?: unknown })
    .filter((c) => typeof c.name === 'string')
    .map((c) => ({
      name: String(c.name),
      points: Number(c.points ?? 0),
      blockId: typeof c.blockId === 'string' ? c.blockId : null,
    }))
}

function requirementsOf(report: Report): Requirement[] {
  const v = (report.scope as Record<string, ValueNode<unknown>>)?.requirements?.value
  return Array.isArray(v) ? (v as Requirement[]) : []
}

function anomaliesOf(report: Report): Anomaly[] {
  return Array.isArray(report.anomalies) ? (report.anomalies as Anomaly[]) : []
}

function toAssessment(row: Record<string, unknown>): Assessment {
  return {
    verdict: row.verdict as Assessment['verdict'],
    conditional: false,
    score: Number(row.score ?? 0),
    parts: (row.parts ?? {}) as Assessment['parts'],
    hardChecks: (row.hard_checks ?? []) as Assessment['hardChecks'],
    summary: { met: 0, unmet: 0, unknown: 0 },
    gaps: (row.gaps ?? []) as string[],
    profileVersion: Number(row.profile_version ?? 0),
    reportVersion: Number(row.report_version ?? 0),
  }
}
