'use server'

import { createAdminClient } from '@/lib/supabase/server'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let pw = ''
  for (let i = 0; i < 12; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)]
  }
  return pw
}

export async function approveRequest(requestId: string): Promise<{ success: boolean; tempPassword?: string; error?: string }> {
  const supabase = await createClient()
  const { data: { user: admin } } = await supabase.auth.getUser()
  if (!admin) return { success: false, error: 'Unauthorized' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any

  // 신청 정보 조회
  const { data: req, error: fetchErr } = await adminClient
    .from('api_access_requests')
    .select('*')
    .eq('id', requestId)
    .eq('status', 'pending')
    .single()

  if (fetchErr || !req) return { success: false, error: '신청 정보를 찾을 수 없습니다' }

  const tempPassword = generateTempPassword()

  // Supabase 계정 생성
  const { data: newUser, error: createErr } = await adminClient.auth.admin.createUser({
    email: req.email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { name: req.name },
  })

  if (createErr || !newUser.user) {
    if (createErr?.message?.includes('already registered')) {
      // 계정이 이미 있는 경우 — 상태만 업데이트
      await adminClient
        .from('api_access_requests')
        .update({ status: 'approved', approved_by: admin.id, approved_at: new Date().toISOString(), notes: '기존 계정으로 승인' })
        .eq('id', requestId)
      revalidatePath('/admin/api-access')
      return { success: true, tempPassword: '(기존 계정 — 비밀번호 변경 없음)' }
    }
    return { success: false, error: createErr?.message ?? '계정 생성 실패' }
  }

  // 프로필 생성 — upsert로 트리거 자동생성 충돌 방지, must_change_password 강제 true
  await adminClient
    .from('profiles')
    .upsert({ id: newUser.user.id, name: req.name, role: 'member', must_change_password: true }, { onConflict: 'id' })

  // 신청 상태 업데이트
  await adminClient
    .from('api_access_requests')
    .update({
      status: 'approved',
      approved_by: admin.id,
      approved_at: new Date().toISOString(),
      temp_password: tempPassword,
    })
    .eq('id', requestId)

  // revalidatePath 호출 안 함 — 클라이언트에서 비밀번호 확인 후 router.refresh() 처리
  return { success: true, tempPassword }
}

export async function rejectRequest(requestId: string, notes: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user: admin } } = await supabase.auth.getUser()
  if (!admin) return { success: false, error: 'Unauthorized' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any

  const { error } = await adminClient
    .from('api_access_requests')
    .update({ status: 'rejected', approved_by: admin.id, rejected_at: new Date().toISOString(), notes })
    .eq('id', requestId)
    .eq('status', 'pending')

  if (error) return { success: false, error: error.message }

  revalidatePath('/admin/api-access')
  return { success: true }
}
