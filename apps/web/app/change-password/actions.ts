'use server'

import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

interface RoutineTemplate {
  name: string
  items?: string[]
}

async function getValidMemberNames(): Promise<string[]> {
  const adminClient = createAdminClient()
  const { data } = await adminClient
    .from('org_content')
    .select('value')
    .eq('key', 'routine_templates')
    .single() as unknown as { data: { value: RoutineTemplate[] } | null }

  if (!data?.value || !Array.isArray(data.value)) return []
  return data.value.map((t) => t.name).filter(Boolean)
}

export async function changePasswordAction(
  newPassword: string,
  name?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 이름 검증 (제공된 경우)
  if (name !== undefined) {
    const validNames = await getValidMemberNames()
    if (!validNames.includes(name)) {
      return { ok: false, error: `'${name}'은(는) 조직도에 등록된 이름이 아닙니다` }
    }
  }

  const { error: pwError } = await supabase.auth.updateUser({ password: newPassword })
  if (pwError) return { ok: false, error: pwError.message }

  const adminClient = createAdminClient()
  const updateFields: Record<string, unknown> = { must_change_password: false }
  if (name) updateFields.name = name

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (adminClient.from('profiles') as any)
    .update(updateFields)
    .eq('id', user.id)

  revalidatePath('/', 'layout')
  return { ok: true }
}

export async function getOrgMemberNames(): Promise<string[]> {
  return getValidMemberNames()
}

export async function changePassword(formData: FormData): Promise<never> {
  const newPassword = formData.get('password') as string
  const confirm = formData.get('confirm') as string

  if (!newPassword || newPassword.length < 8) {
    redirect('/change-password?error=' + encodeURIComponent('비밀번호는 8자 이상이어야 합니다'))
  }
  if (newPassword !== confirm) {
    redirect('/change-password?error=' + encodeURIComponent('비밀번호가 일치하지 않습니다'))
  }

  const result = await changePasswordAction(newPassword)
  if (!result.ok) {
    redirect('/change-password?error=' + encodeURIComponent(result.error))
  }

  redirect('/dashboard')
}
