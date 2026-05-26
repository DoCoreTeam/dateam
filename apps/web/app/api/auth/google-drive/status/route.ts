import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveConnectionStatus } from '@/lib/google-drive'

// 로그인한 모든 사용자가 Drive 연결 상태를 확인할 수 있음
// 토큰 값은 노출하지 않고 { connected, email }만 반환
export async function GET(): Promise<NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  const status = await getDriveConnectionStatus()
  return NextResponse.json(status)
}
