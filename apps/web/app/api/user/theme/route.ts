import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { isThemeId } from '@/lib/themes'

// 개인 테마 저장 — 본인만(self-only). theme=null 이면 리셋(전역 디폴트 추종).
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { theme?: unknown }
  const { theme } = body

  // 허용: 유효 테마 id 또는 null(리셋). 그 외 거부.
  if (theme !== null && !isThemeId(theme)) {
    return NextResponse.json({ error: '유효하지 않은 테마' }, { status: 400 })
  }
  const value: string | null = theme // null | ThemeId (위 가드로 좁혀짐)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminClient = createAdminClient() as any
  const { error } = await adminClient
    .from('profiles')
    .update({ theme_preference: value })
    .eq('id', user.id)
    .is('deleted_at', null)

  if (error) {
    return NextResponse.json({ error: '저장 실패' }, { status: 500 })
  }

  revalidatePath('/', 'layout') // 전역 즉시 반영
  return NextResponse.json({ success: true, theme: value })
}
