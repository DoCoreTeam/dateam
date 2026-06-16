import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { resolveOrgScope } from '@/lib/org-scope'

// GET /api/work/departments — 내가 부서업무를 등록할 수 있는 부서 목록(승격 picker용). dept-tasks/page.tsx 와 동일 규칙.
export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scope = await resolveOrgScope(createAdminClient() as any, auth.user.id)
  const depts = scope.nodes
    .filter((n) => n.type === 'department' && (scope.isExecutive || scope.readableDeptIds.includes(n.id)))
    .map((n) => ({ id: n.id, name: n.name }))
  return NextResponse.json({ departments: depts })
}
