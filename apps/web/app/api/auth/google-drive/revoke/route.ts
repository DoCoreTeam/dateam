import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { revokeDriveTokens } from '@/lib/google-drive'

export async function POST(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if ((profile as { role: string } | null)?.role !== 'admin') {
    return NextResponse.json(
      { error: '관리자만 연결을 해제할 수 있습니다' },
      { status: 403 }
    )
  }

  await revokeDriveTokens()
  return NextResponse.json({ success: true })
}
