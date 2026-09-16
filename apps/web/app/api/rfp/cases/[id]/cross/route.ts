// POST /api/rfp/cases/[id]/cross — 고른 항목만 교차검증
//
// 전부 검증하지 않는다. 사용자가 고른 필드만 돈다 —
// 전부 돌리면 비용이 벤더 수만큼 곱해지고, 그 비용을 낼 이유가 없는 필드가 대부분이다.
//
// GET 은 「무엇을 권하나」와 「얼마나 드나」를 돌려준다. 확인 전에 숫자를 보여 주지 않으면
// 사용자는 청구서를 보고 나서야 안다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { enqueueJob } from '@/lib/rfp/jobs/queue'
import { dedupeKey, JOB_PRIORITY, isRunnable } from '@/lib/rfp/jobs/stages'

export const dynamic = 'force-dynamic'

/** 한 번에 검증할 수 있는 필드 수 — 넘으면 비용이 사용자 예상을 벗어난다 */
const MAX_FIELDS = 30

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

  let body: { fields?: unknown; vendorIds?: unknown }
  try {
    body = (await req.json()) as { fields?: unknown; vendorIds?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const fields = Array.isArray(body.fields) ? body.fields.filter((f): f is string => typeof f === 'string') : []
  if (fields.length === 0) {
    // 「전부」가 기본이면 사용자가 실수로 큰 비용을 낸다
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }
  if (fields.length > MAX_FIELDS) {
    return NextResponse.json({ error: 'too_many_fields', limit: MAX_FIELDS }, { status: 400 })
  }

  const vendorIds = Array.isArray(body.vendorIds)
    ? body.vendorIds.filter((v): v is string => typeof v === 'string')
    : []
  if (vendorIds.length === 0) {
    return NextResponse.json({ error: 'missing_vendors' }, { status: 400 })
  }

  // 앞 판을 덮지 않는다 — 판을 올려 새 잡을 만든다
  const { data: versions } = await (db as any)
    .from('rfp_report_versions')
    .select('version')
    .eq('case_id', caseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const baseVersion = Number(versions?.version ?? 0)
  if (baseVersion === 0) {
    return NextResponse.json({ error: 'no_base_report' }, { status: 409 })
  }

  // 실행기가 없는 단계를 걸면 202 를 받고 기다리다 반드시 실패한다.
  // 걸기 전에 안 된다고 듣는 편이 낫다
  if (!isRunnable('cross_verify')) {
    return NextResponse.json({ error: 'stage_not_runnable', stage: 'cross_verify' }, { status: 501 })
  }

  try {
    const job = await enqueueJob(db as any, {
      orgId: kase.org_id,
      caseId,
      jobType: 'cross_verify',
      payload: { fields, vendorIds, baseVersion, requestedBy: gate.user.id },
      priority: JOB_PRIORITY.cross_verify,
      dedupeKey: dedupeKey(caseId, 'cross_verify', baseVersion + 1),
    })
    return NextResponse.json({
      job: { id: job.id, status: job.status },
      fields: fields.length,
      vendors: vendorIds.length,
    }, { status: 202 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '교차검증을 걸지 못했습니다' },
      { status: 500 },
    )
  }
}
