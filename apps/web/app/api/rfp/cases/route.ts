// GET  /api/rfp/cases  — 내 조직 케이스 목록
// POST /api/rfp/cases  — 케이스 만들기 (등급 필수)
//
// 조직 격리는 **RLS 가 한다.** 여기서 org_id 로 다시 거르지 않는 이유:
// 앱에서 거르기 시작하면 «앱 필터를 빠뜨린 라우트» 가 생기고, 그 라우트만 조용히 남의 것을 준다.
// 사용자 세션 클라이언트로 질의하면 정책이 못 보는 행을 아예 안 준다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { validateCaseInput, readPageSize } from '@/lib/rfp/db/cases'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const url = new URL(req.url)
  const limit = readPageSize(url.searchParams.get('limit'))
  const cursor = url.searchParams.get('cursor')

  const db = await createClient()
  let q = (db as any)
    .from('rfp_cases')
    .select('id, title, doc_class, stage, sector, budget_amount, proposal_deadline, created_at')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (cursor) q = q.lt('created_at', cursor)

  const { data, error } = await q
  if (error) {
    return NextResponse.json({ error: '목록을 불러오지 못했습니다' }, { status: 500 })
  }

  const rows = data ?? []
  return NextResponse.json({
    cases: rows,
    nextCursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const check = validateCaseInput(raw)
  if (!check.ok) {
    return NextResponse.json({ error: check.reason, field: check.field }, { status: 400 })
  }

  const db = await createClient()
  // 조직은 서버가 정한다 — 요청이 org_id 를 보내면 남의 조직에 케이스를 넣을 수 있다
  const { data: orgId, error: orgError } = await (db as any).rpc('rfp_default_org')
  if (orgError || !orgId) {
    return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })
  }

  const v = check.value
  const { data, error } = await (db as any)
    .from('rfp_cases')
    .insert({
      org_id: orgId,
      title: v.title,
      doc_class: v.docClass,
      sector: v.sector,
      project_type: v.projectType,
      budget_amount: v.budgetAmount,
      duration_months: v.durationMonths,
      proposal_deadline: v.proposalDeadline,
      source_id: v.sourceId,
      created_by: gate.user.id,
    })
    .select('id, title, doc_class, stage, created_at')
    .single()

  if (error) {
    return NextResponse.json({ error: '케이스를 만들지 못했습니다' }, { status: 500 })
  }
  return NextResponse.json({ case: data }, { status: 201 })
}
