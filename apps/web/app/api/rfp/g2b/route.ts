// POST /api/rfp/g2b — 공고번호로 나라장터 공고 수집
//
// 서비스 키는 **DB(org_content META)** 에서 읽는다. env 에 있으면 바꿀 때마다 배포해야 하고,
// 배포 권한이 없는 사람은 못 바꾼다 — 공공데이터포털 키는 사람 손에 달린 값이다.
//
// 실패하면 사유와 함께 **다음에 무엇을 하면 되는지**를 돌려준다.
// 「수집 실패」로만 두면 사용자는 시스템이 고장 난 줄 안다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { readServiceKey, fetchNotice, FALLBACK_GUIDE } from '@/lib/rfp/g2b/client'
import { toSourceRow, toDbColumns } from '@/lib/rfp/g2b/map'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { noticeNo?: unknown; round?: unknown }
  try {
    body = (await req.json()) as { noticeNo?: unknown; round?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const noticeNo = typeof body.noticeNo === 'string' ? body.noticeNo.trim() : ''
  if (!noticeNo) return NextResponse.json({ error: 'missing_notice_no' }, { status: 400 })
  const round = Number.isFinite(Number(body.round)) ? Number(body.round) : undefined

  // 키는 서비스 롤로만 읽는다 — 화면에 흘리지 않는다
  const serviceKey = await readServiceKey(createAdminClient() as never)
  if (!serviceKey) {
    return NextResponse.json(
      { error: 'no_service_key', fallback: FALLBACK_GUIDE.no_service_key },
      { status: 409 },
    )
  }

  const result = await fetchNotice({ noticeNo, round, serviceKey })
  if (!result.ok) {
    // 사유마다 다음에 무엇을 하면 되는지 함께 준다
    return NextResponse.json(
      { error: result.reason, detail: result.detail, fallback: result.fallback },
      { status: result.reason === 'not_found' ? 404 : 502 },
    )
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const row = toSourceRow(result.data)
  const { data, error } = await (db as any)
    .from('rfp_sources')
    .insert({ ...toDbColumns(row, orgId), fetched_at: new Date().toISOString() })
    .select('id, notice_no, notice_round, title, budget_amount, notice_date')
    .single()

  if (error) return NextResponse.json({ error: '공고를 저장하지 못했습니다' }, { status: 500 })
  return NextResponse.json({ source: data, mapped: row }, { status: 201 })
}
