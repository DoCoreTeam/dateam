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

/**
 * 관리자인지 확인한다.
 *
 * **왜 새로 넣었나**: 여기 있던 확인은 「로그인했는가」뿐이었다(실측 2026-09-20).
 * 서버 액션은 화면 게이트가 안 막는다 — 주소만 알면 로그인한 누구나 부를 수 있다.
 * 이 둘은 **계정을 만들고 API 키를 내주는** 일이라 로그인만으로는 부족하다.
 */
async function requireApiAccessAdmin(): Promise<{ id: string } | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAdminClient() as any
  const { data } = await db
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  return data?.role === 'admin' ? { id: user.id } : null
}

export async function approveRequest(requestId: string): Promise<{ success: boolean; tempPassword?: string; error?: string }> {
  const admin = await requireApiAccessAdmin()
  if (!admin) return { success: false, error: '관리자 권한이 필요합니다' }

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
      return { success: true, tempPassword: '(기존 계정: 비밀번호 변경 없음)' }
    }
    return { success: false, error: createErr?.message ?? '계정 생성 실패' }
  }

  // 프로필 생성 — upsert로 트리거 자동생성 충돌 방지, must_change_password 강제 true
  await adminClient
    .from('profiles')
    .upsert({ id: newUser.user.id, name: req.name, role: 'api_user', must_change_password: true }, { onConflict: 'id' })

  // 신청 상태 업데이트
  await adminClient
    .from('api_access_requests')
    .update({
      status: 'approved',
      approved_by: admin.id,
      approved_at: new Date().toISOString(),
      // 임시 비밀번호는 저장하지 않는다 — 승인 화면이 한 번 보여 주고 끝낸다(마이그 223·224).
      // 예전엔 여기 평문으로 남겨 두고 승인 뒤에도 안 지웠다(실측 2026-08-27: 2건 잔존).
    })
    .eq('id', requestId)

  // revalidatePath 호출 안 함 — 클라이언트에서 비밀번호 확인 후 router.refresh() 처리
  return { success: true, tempPassword }
}

export async function rejectRequest(requestId: string, notes: string): Promise<{ success: boolean; error?: string }> {
  const admin = await requireApiAccessAdmin()
  if (!admin) return { success: false, error: '관리자 권한이 필요합니다' }

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
