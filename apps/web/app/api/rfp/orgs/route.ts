// GET  /api/rfp/orgs — 내 조직과 사용량과 요금제
// POST /api/rfp/orgs — 구성원 초대
//
// 조직 격리는 **RLS 가 한다.** 여기서 org_id 로 다시 거르지 않는다 —
// 앱 필터를 빠뜨린 라우트가 생기면 그 라우트만 조용히 남의 것을 준다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { can, type OrgRole } from '@/lib/rfp/tenant/org'
import { validateInvite, makeToken, expiryFrom } from '@/lib/rfp/tenant/invite'
import { toPlan, summarize, currentPeriod, type UsageRow } from '@/lib/rfp/tenant/usage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const [orgRes, membersRes, usageRes] = await Promise.all([
    (db as any).from('rfp_orgs').select('id, name, plan_id').eq('id', orgId).maybeSingle(),
    (db as any).from('rfp_org_members').select('profile_id, role'),
    (db as any).from('rfp_usage_ledger').select('org_id, period, kind, units, cost_krw'),
  ])

  const org = orgRes.data
  if (!org) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 404 })

  const { data: planRow } = await (db as any)
    .from('rfp_plans')
    .select('id, name, monthly_case_limit, monthly_ai_krw, max_members, cross_verify, assistant')
    .eq('id', org.plan_id ?? 'starter')
    .maybeSingle()

  const rows: UsageRow[] = (usageRes.data ?? []).map((r: Record<string, unknown>) => ({
    orgId: String(r.org_id),
    period: String(r.period),
    kind: r.kind as UsageRow['kind'],
    units: Number(r.units ?? 0),
    costKrw: Number(r.cost_krw ?? 0),
  }))

  const period = currentPeriod()
  return NextResponse.json({
    org: { id: org.id, name: org.name, planId: org.plan_id },
    plan: planRow ? toPlan(planRow) : null,
    members: (membersRes.data ?? []).length,
    usage: summarize(rows, period),
  })
}

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const { data: me } = await (db as any)
    .from('rfp_org_members')
    .select('role')
    .eq('org_id', orgId)
    .eq('profile_id', gate.user.id)
    .maybeSingle()

  // 구성원 관리는 관리자만 — member 가 사람을 부르면 비용이 그만큼 늘어난다
  if (!can((me?.role as OrgRole) ?? null, 'manage_members')) {
    return NextResponse.json({ error: '권한이 없습니다' }, { status: 403 })
  }

  let body: { email?: unknown; role?: unknown }
  try {
    body = (await req.json()) as { email?: unknown; role?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const [{ data: members }, { data: pending }] = await Promise.all([
    (db as any).from('profiles').select('email').in('id',
      ((await (db as any).from('rfp_org_members').select('profile_id').eq('org_id', orgId)).data ?? [])
        .map((m: { profile_id: string }) => m.profile_id)),
    (db as any).from('rfp_invites').select('email, accepted_at').eq('org_id', orgId),
  ])

  const check = validateInvite(body, {
    members: (members ?? []).map((m: { email: string | null }) => ({ email: m.email ?? '' })),
    pending: (pending ?? []).map((p: { email: string; accepted_at: string | null }) => ({
      email: p.email, acceptedAt: p.accepted_at,
    })),
  })
  if (check.problems.length > 0) {
    return NextResponse.json({ error: check.problems[0], problems: check.problems }, { status: 400 })
  }

  const token = await makeToken()
  const { data, error } = await (db as any)
    .from('rfp_invites')
    .insert({
      org_id: orgId,
      email: check.email,
      role: check.role,
      token,
      // 기한이 없는 링크는 1년 뒤에도 남의 조직에 들어가는 문이다
      expires_at: expiryFrom(Date.now()),
      invited_by: gate.user.id,
    })
    .select('id, email, role, expires_at')
    .single()

  if (error) return NextResponse.json({ error: '초대를 만들지 못했습니다' }, { status: 500 })
  // 토큰은 메일로만 나간다 — 응답에 실으면 목록 화면에 남는다
  return NextResponse.json({ invite: data }, { status: 201 })
}
