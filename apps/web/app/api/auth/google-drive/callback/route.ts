import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getOAuth2Client, saveTokens } from '@/lib/google-drive'
import { google } from 'googleapis'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // 사용자가 OAuth 화면에서 취소한 경우
  if (error) {
    return NextResponse.redirect(
      new URL('/admin/settings?drive=cancelled', req.url)
    )
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: 'code 또는 state 파라미터가 없습니다' },
      { status: 400 }
    )
  }

  // CSRF state 검증
  const cookieStore = await cookies()
  const savedState = cookieStore.get('gdrive_oauth_state')?.value

  if (!savedState || savedState !== state) {
    return NextResponse.json(
      { error: 'state 검증 실패 — CSRF 공격 가능성' },
      { status: 400 }
    )
  }

  // state 쿠키 즉시 삭제
  cookieStore.delete('gdrive_oauth_state')

  // 현재 사용자 확인
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    cookieStore.delete('gdrive_oauth_state')
    return NextResponse.json({ error: '인증이 필요합니다' }, { status: 401 })
  }

  // admin role 재검증 — state 검증 통과 후에도 권한 확인 필수
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if ((profile as { role: string } | null)?.role !== 'admin') {
    cookieStore.delete('gdrive_oauth_state')
    return NextResponse.json({ error: '관리자만 접근할 수 있습니다' }, { status: 403 })
  }

  // code → tokens 교환
  const auth = getOAuth2Client()

  let tokens: {
    access_token?: string | null
    refresh_token?: string | null
    expiry_date?: number | null
  }

  try {
    const { tokens: exchanged } = await auth.getToken(code)
    tokens = exchanged
  } catch {
    return NextResponse.redirect(
      new URL('/admin/settings?drive=error&reason=token_exchange', req.url)
    )
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    return NextResponse.redirect(
      new URL('/admin/settings?drive=error&reason=missing_tokens', req.url)
    )
  }

  // 연결된 Google 계정 이메일 조회
  auth.setCredentials(tokens)
  let accountEmail = ''

  try {
    const oauth2 = google.oauth2({ version: 'v2', auth })
    const { data: userInfo } = await oauth2.userinfo.get()
    accountEmail = userInfo.email ?? ''
  } catch {
    accountEmail = user.email ?? ''
  }

  // system_settings에 토큰 저장 (adminClient — RLS 우회)
  const tokenExpiry = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString()

  await saveTokens(
    {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiry,
      accountEmail,
    },
    user.id
  )

  return NextResponse.redirect(
    new URL('/admin/settings?drive=connected', req.url)
  )
}
