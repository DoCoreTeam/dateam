import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import type { Profile } from '@/types/database'
import { isThemeId } from '@/lib/themes'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any
  const { data: profile } = await adminClient
    .from('profiles').select('role').eq('id', user.id).is('deleted_at', null)
    .single() as { data: Pick<Profile, 'role'> | null }
  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({})) as { theme?: string }
  if (!isThemeId(body.theme)) {
    return NextResponse.json({ error: '유효하지 않은 테마' }, { status: 400 })
  }

  await adminClient
    .from('system_settings')
    .upsert({ key: 'active_theme', value: body.theme, updated_by: user.id }, { onConflict: 'key' })

  revalidatePath('/', 'layout')
  return NextResponse.json({ success: true, theme: body.theme })
}
