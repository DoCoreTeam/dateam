// GET  /api/rfp/profile — 우리 조직의 활성 프로필
// PUT  /api/rfp/profile — 프로필 저장 (새 버전으로)
//
// 고칠 때마다 **새 버전**을 만든다. 덮어쓰면 지난 판정이 왜 그랬는지 설명할 수 없다 —
// 「그때는 인증이 없었다」를 보여 주려면 그때의 프로필이 남아 있어야 한다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  const db = await createClient()
  const { data, error } = await (db as any)
    .from('rfp_company_profiles')
    .select('id, version, status, basic, created_at')
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return NextResponse.json({ error: '프로필을 불러오지 못했습니다' }, { status: 500 })
  return NextResponse.json({ profile: data ?? null })
}

export async function PUT(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const basic = (body as Record<string, unknown>)?.basic
  if (!basic || typeof basic !== 'object') {
    return NextResponse.json({ error: 'missing_basic' }, { status: 400 })
  }
  const companyName = (basic as Record<string, unknown>).companyName
  if (typeof companyName !== 'string' || !companyName.trim()) {
    return NextResponse.json({ error: 'missing_company_name' }, { status: 400 })
  }

  const db = await createClient()
  const { data: orgId } = await (db as any).rpc('rfp_default_org')
  if (!orgId) return NextResponse.json({ error: '조직을 찾지 못했습니다' }, { status: 403 })

  const { data: last } = await (db as any)
    .from('rfp_company_profiles')
    .select('version')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextVersion = Number(last?.version ?? 0) + 1

  // 지난 판정이 가리키는 프로필은 그대로 두고 보관 상태로만 바꾼다
  await (db as any).from('rfp_company_profiles').update({ status: 'archived' }).eq('status', 'active')

  const { data, error } = await (db as any)
    .from('rfp_company_profiles')
    .insert({
      org_id: orgId,
      version: nextVersion,
      status: 'active',
      basic,
      created_by: gate.user.id,
    })
    .select('id, version, status, basic, created_at')
    .single()

  if (error) return NextResponse.json({ error: '프로필을 저장하지 못했습니다' }, { status: 500 })
  return NextResponse.json({ profile: data }, { status: 201 })
}
