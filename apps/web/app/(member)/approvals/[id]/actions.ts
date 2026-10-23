'use server'

// 승인 요청 결정 (P0158 I08), 키 주인 본인이나 관리자가 화면에서 누른다
import { headers } from 'next/headers'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { decideApproval, type ApprovalOutcome } from '@/lib/actions/dispatch'

const inputSchema = z.object({ id: z.string().uuid(), decision: z.enum(['approve', 'reject']) })

export async function decideApprovalAction(id: string, decision: 'approve' | 'reject'): Promise<ApprovalOutcome | { ok: false; code: 'invalid' | 'unauthorized' }> {
  const parsed = inputSchema.safeParse({ id, decision })
  if (!parsed.success) return { ok: false, code: 'invalid' }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, code: 'unauthorized' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: profile } = await admin.from('profiles').select('role, deleted_at').eq('id', user.id).maybeSingle()
  if (!profile || profile.deleted_at) return { ok: false, code: 'unauthorized' }
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost'
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return decideApproval(parsed.data.id, { userId: user.id, role: profile.role ?? 'member' }, parsed.data.decision, `${proto}://${host}`)
}
