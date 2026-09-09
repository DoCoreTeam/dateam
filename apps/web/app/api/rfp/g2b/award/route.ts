// POST /api/rfp/g2b/award — 낙찰 결과 수집
//
// 이 데이터가 학습의 정답지다. 「우리 판정이 맞았나」는 낙찰 결과가 있어야 답할 수 있다.
//
// 같은 공고를 두 번 수집해도 한 행이다 — `rfp_outcomes.case_id` 유니크가 그것을 막는다.
// 그리고 **사람이 적은 값을 자동 수집이 덮지 않는다.**

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { readServiceKey, fetchNotice, FALLBACK_GUIDE } from '@/lib/rfp/g2b/client'
import { toAwardInfo, toOutcome, mergeWithManual } from '@/lib/rfp/g2b/award'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { caseId?: unknown; noticeNo?: unknown }
  try {
    body = (await req.json()) as { caseId?: unknown; noticeNo?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const caseId = typeof body.caseId === 'string' ? body.caseId : ''
  const noticeNo = typeof body.noticeNo === 'string' ? body.noticeNo.trim() : ''
  if (!caseId || !noticeNo) return NextResponse.json({ error: 'missing_params' }, { status: 400 })

  const db = await createClient()
  const { data: kase } = await (db as any)
    .from('rfp_cases')
    .select('id, org_id')
    .eq('id', caseId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!kase) return NextResponse.json({ error: '케이스를 찾지 못했습니다' }, { status: 404 })

  const serviceKey = await readServiceKey(createAdminClient() as never)
  if (!serviceKey) {
    return NextResponse.json({ error: 'no_service_key', fallback: FALLBACK_GUIDE.no_service_key }, { status: 409 })
  }

  const fetched = await fetchNotice({ noticeNo, serviceKey })
  if (!fetched.ok) {
    return NextResponse.json(
      { error: fetched.reason, detail: fetched.detail, fallback: fetched.fallback },
      { status: fetched.reason === 'not_found' ? 404 : 502 },
    )
  }

  const award = toAwardInfo([fetched.data])
  if (!award) return NextResponse.json({ error: 'bad_response' }, { status: 502 })

  // 우리 회사 이름은 프로필에서 온다 — 이름이 없으면 참여 여부를 못 가린다
  const { data: profile } = await (db as any)
    .from('rfp_company_profiles')
    .select('basic')
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const basic = (profile?.basic ?? {}) as { companyName?: string; businessNumber?: string | null }
  if (!basic.companyName) {
    return NextResponse.json({ error: 'no_company_profile' }, { status: 409 })
  }

  const outcome = toOutcome(caseId, award, {
    name: basic.companyName,
    bizNo: basic.businessNumber ?? null,
  })

  const { data: existing } = await (db as any)
    .from('rfp_outcomes')
    .select('source, submitted, decision')
    .eq('case_id', caseId)
    .maybeSingle()

  // 담당자가 「우리는 안 냈다」고 적어 뒀는데 크론이 뒤집으면 그 사람은 다시 안 믿는다
  const patch = mergeWithManual(existing ?? null, outcome)

  const { data, error } = await (db as any)
    .from('rfp_outcomes')
    .upsert(
      { org_id: kase.org_id, case_id: caseId, ...patch, recorded_at: new Date().toISOString() },
      { onConflict: 'case_id' },
    )
    .select('case_id, submitted, result, awarded_to, awarded_amount, our_rank, source')
    .single()

  if (error) return NextResponse.json({ error: '결과를 저장하지 못했습니다' }, { status: 500 })
  return NextResponse.json({ outcome: data, award }, { status: 201 })
}
