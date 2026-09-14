// GET  /api/rfp/cases/[id]/revisions — 차수 사슬과 앞 차수와의 diff
// POST /api/rfp/cases/[id]/revisions — 이 케이스를 새 차수로 잇기
//
// **앞 차수를 지우지 않는다.** 지우면 「무엇이 바뀌었나」를 영영 말할 수 없고,
// 지난 리포트를 근거로 쓴 제안서도 설명이 안 된다.

import { readStoredReport, REPORT_VERSION_COLUMNS } from '@/lib/rfp/report/read-version'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { linkRevision, chainOf, type Revision } from '@/lib/rfp/revision/link'
import { diffReports, onlyChanges, criticalChanges, summarize } from '@/lib/rfp/revision/diff'
import type { Report } from '@/lib/rfp/report/schema'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const db = await createClient()

  const { data: mine } = await (db as any)
    .from('rfp_case_revisions')
    .select('case_id, notice_no, round, is_latest, created_at')
    .eq('case_id', caseId)
    .maybeSingle()
  if (!mine) return NextResponse.json({ chain: [], diff: null })

  const { data: rows } = await (db as any)
    .from('rfp_case_revisions')
    .select('case_id, notice_no, round, is_latest, created_at')
    .eq('notice_no', mine.notice_no)
    .order('round', { ascending: true })

  const chain = chainOf((rows ?? []).map(toRevision), mine.notice_no)
  const previous = chain.filter((r) => r.round < mine.round).slice(-1)[0] ?? null
  if (!previous) return NextResponse.json({ chain, diff: null })

  const [before, after] = await Promise.all([
    latestReport(db, previous.caseId),
    latestReport(db, caseId),
  ])
  if (!before || !after) return NextResponse.json({ chain, diff: null, reason: 'no_report' })

  const result = diffReports(before, after)
  return NextResponse.json({
    chain,
    diff: {
      summary: summarize(result),
      changes: onlyChanges(result),
      // 이 필드가 바뀌면 제안 전략이 흔들린다
      critical: criticalChanges(result),
      counts: { changed: result.changed, added: result.added, removed: result.removed },
    },
  })
}

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

  let body: { noticeNo?: unknown; round?: unknown }
  try {
    body = (await req.json()) as { noticeNo?: unknown; round?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const noticeNo = typeof body.noticeNo === 'string' ? body.noticeNo.trim() : ''
  const round = Number(body.round)
  if (!noticeNo || !Number.isInteger(round) || round < 1) {
    return NextResponse.json({ error: 'missing_params' }, { status: 400 })
  }

  const { data: rows } = await (db as any)
    .from('rfp_case_revisions')
    .select('case_id, notice_no, round, is_latest, created_at')
    .eq('notice_no', noticeNo)

  const link = linkRevision({ noticeNo, round, caseId }, (rows ?? []).map(toRevision))
  if (link.problems.includes('same_round')) {
    // 같은 차수가 둘이면 「무엇이 최신인가」에 답할 수 없다
    return NextResponse.json({ error: 'same_round' }, { status: 409 })
  }

  if (link.demote.length > 0) {
    // 최신 표시만 뗀다. 지우지 않는다
    await (db as any)
      .from('rfp_case_revisions')
      .update({ is_latest: false })
      .in('case_id', link.demote)
  }

  const { data, error } = await (db as any)
    .from('rfp_case_revisions')
    .insert({ org_id: kase.org_id, notice_no: noticeNo, round, case_id: caseId, is_latest: true })
    .select('case_id, notice_no, round, is_latest')
    .single()
  if (error) return NextResponse.json({ error: '차수를 잇지 못했습니다' }, { status: 500 })

  if (link.supersedes) {
    await (db as any)
      .from('rfp_cases')
      .update({ supersedes_case_id: link.supersedes.caseId })
      .eq('id', caseId)
  }

  return NextResponse.json({ revision: data, supersedes: link.supersedes?.caseId ?? null }, { status: 201 })
}

function toRevision(row: Record<string, unknown>): Revision {
  return {
    caseId: String(row.case_id),
    noticeNo: String(row.notice_no ?? ''),
    round: Number(row.round ?? 0),
    isLatest: Boolean(row.is_latest),
    createdAt: String(row.created_at ?? ''),
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
