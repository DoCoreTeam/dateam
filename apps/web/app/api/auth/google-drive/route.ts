import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getOAuth2Client } from '@/lib/google-drive'
import { randomBytes } from 'crypto'

export async function GET(): Promise<NextResponse> {
  // 인증 확인 — admin만 Drive 연동 가능
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
      { error: '관리자만 Google Drive를 연동할 수 있습니다' },
      { status: 403 }
    )
  }

  // CSRF state 생성 후 쿠키에 저장
  const state = randomBytes(32).toString('hex')
  const cookieStore = await cookies()
  cookieStore.set('gdrive_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10분
    path: '/',
  })

  const auth = getOAuth2Client()
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // refresh_token을 항상 포함시키기 위해 필요
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  })

  return NextResponse.redirect(authUrl)
}
