// PUT /api/rfp/cases/[id]/outcome — 참여 결정과 결과 기록
//
// 이 데이터가 학습의 정답지다. 안 적으면 「우리 판정이 맞았나」에 영영 답할 수 없다.
//
// 사람이 적은 값은 `source='manual'` 로 남는다 — 자동 수집이 그것을 덮지 않는다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { validateOutcome } from '@/lib/rfp/learn/outcomes'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
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

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const { record, problems } = validateOutcome(raw)
  // 안 냈는데 순위가 있는 것은 앞뒤가 안 맞는다 — 받아 두면 통계에 섞인다
  if (problems.includes('rank_without_submit')) {
    return NextResponse.json({ error: 'rank_without_submit' }, { status: 400 })
  }

  const { data, error } = await (db as any)
    .from('rfp_outcomes')
    .upsert({
      org_id: kase.org_id,
      case_id: caseId,
      decision: record.decision,
      decision_reason: record.decisionReason,
      submitted: record.submitted,
      result: record.result,
      awarded_to: record.awardedTo,
      awarded_amount: record.awardedAmount,
      our_rank: record.ourRank,
      source: 'manual',
      recorded_by: gate.user.id,
      recorded_at: new Date().toISOString(),
    }, { onConflict: 'case_id' })
    .select('case_id, decision, submitted, result, our_rank, source')
    .single()

  if (error) return NextResponse.json({ error: '결과를 저장하지 못했습니다' }, { status: 500 })
  return NextResponse.json({ outcome: data, problems })
}
