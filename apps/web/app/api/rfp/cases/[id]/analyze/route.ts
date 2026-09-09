// POST /api/rfp/cases/[id]/analyze — 기본 모드 분석 걸기
//
// 화면이 기다리지 않는다. 잡을 큐에 넣고 바로 돌려준다 —
// 200쪽짜리 분석은 몇 분이 걸리고, 그 시간을 HTTP 요청이 버티게 만들면
// 타임아웃마다 「분석이 실패했다」로 보인다(실제로는 돌고 있는데도).

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { enqueueJob } from '@/lib/rfp/jobs/queue'
import { dedupeKey, JOB_PRIORITY } from '@/lib/rfp/jobs/stages'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // member 부터 걸 수 있다. viewer 는 여기서 막힌다
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const { id: caseId } = await ctx.params
  const db = await createClient()

  // 케이스가 안 보이면 없는 것이다 — RLS 가 남의 조직 것을 아예 안 준다
  const { data: kase } = await (db as any)
    .from('rfp_cases')
    .select('id, org_id, stage')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()

  if (!kase) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  const { data: files } = await (db as any)
    .from('rfp_document_files')
    .select('id')
    .eq('case_id', caseId)
    .is('deleted_at', null)
    .limit(1)

  if (!files || files.length === 0) {
    // 파일 없이 분석을 걸면 빈 리포트가 나오고 사용자는 그것을 「내용 없음」으로 읽는다
    return NextResponse.json({ error: 'no_files' }, { status: 409 })
  }

  let body: { rerun?: boolean } = {}
  try {
    body = (await req.json()) as { rerun?: boolean }
  } catch {
    // 본문 없이 불러도 된다
  }

  // 다시 돌리려면 판을 올려 새 키를 만든다. 같은 키면 있던 잡을 돌려준다
  const { data: runs } = await (db as any)
    .from('rfp_analysis_runs')
    .select('id')
    .eq('case_id', caseId)
  const version = (runs?.length ?? 0) + (body.rerun ? 1 : 0) + 1

  try {
    const job = await enqueueJob(db as any, {
      orgId: kase.org_id,
      caseId,
      jobType: 'parse',
      // 판 번호를 payload 로 넘긴다 — 뒤 단계가 같은 판을 이어받아야
      // 되살아난 잡이 IR 을 두 벌로 만들지 않는다
      payload: { requestedBy: gate.user.id, version },
      priority: JOB_PRIORITY.parse,
      dedupeKey: dedupeKey(caseId, 'parse', version),
    })
    return NextResponse.json({ job: { id: job.id, status: job.status, jobType: job.jobType } }, { status: 202 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '분석을 걸지 못했습니다' },
      { status: 500 },
    )
  }
}
