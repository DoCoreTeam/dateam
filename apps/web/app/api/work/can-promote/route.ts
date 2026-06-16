import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { resolveOrgScope } from '@/lib/org-scope'

// GET /api/work/can-promote — 현재 사용자가 일일업무를 부서업무로 등록할 자격이 있는지 판정.
//  자격 = 부서장(조직도 head, editableDeptIds 보유) 또는 admin. (본인 기준 판정만)
export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = await resolveOrgScope(createAdminClient() as any, auth.user.id)
  const canPromote = scope.editableDeptIds.length > 0 || auth.user.role === 'admin'

  return NextResponse.json({ canPromote }, { headers: { 'Cache-Control': 'no-store' } })
}
