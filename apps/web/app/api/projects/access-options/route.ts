import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { resolveOrgScope } from '@/lib/org-scope'

export async function GET() {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  // 조직 SSOT가 private RPC와 동일한 readable 범위를 계산한다.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const scope = await resolveOrgScope(admin, auth.user.id)
  const allowed = new Set(scope.readableDeptIds)
  const departments = scope.nodes
    .filter((node) => node.type === 'department' && allowed.has(node.id))
    .map((node) => ({ id: node.id, name: node.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  return NextResponse.json({ departments })
}
