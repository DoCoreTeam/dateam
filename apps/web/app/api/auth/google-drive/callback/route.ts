import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getOAuth2Client, saveTokens } from '@/lib/google-drive'
import { appendParams, sanitizeReturnTo } from '@/lib/nav/return-to'
import { google, type Auth } from 'googleapis'

const RETURN_COOKIE = 'gdrive_return_to'
const DEFAULT_RETURN = '/admin/settings?tab=integrations'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const cookieStore = await cookies()

  // 떠나온 화면으로 돌려보낸다(§복귀 경로 SSOT). 결과는 쿼리로 얹되 기존 쿼리(탭 등)는 보존한다.
  const returnTo = sanitizeReturnTo(cookieStore.get(RETURN_COOKIE)?.value, DEFAULT_RETURN)
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(new URL(appendParams(returnTo, params), req.url))

  // 사용자가 OAuth 화면에서 취소한 경우
  if (error) {
    cookieStore.delete(RETURN_COOKIE)
    return back({ drive: 'cancelled' })
  }

  if (!code || !state) {
    return NextResponse.json(
      { error: 'code 또는 state 파라미터가 없습니다' },
      { status: 400 }
    )
  }

  // CSRF state 검증
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
  } catch (e: unknown) {
    // 삼키면 화면엔 아무 말도 안 나오고 원인 추적이 불가능해진다(§오류 은닉 금지)
    console.error('[google-drive/callback] token exchange 실패:', e)
    cookieStore.delete(RETURN_COOKIE)
    return back({ drive: 'error', reason: 'token_exchange' })
  }

  if (!tokens.access_token || !tokens.refresh_token) {
    // refresh_token은 prompt=consent일 때만 온다. 없으면 재연결해도 7일 뒤 또 죽는다.
    console.error('[google-drive/callback] 토큰 누락 — access:%s refresh:%s',
      !!tokens.access_token, !!tokens.refresh_token)
    cookieStore.delete(RETURN_COOKIE)
    return back({ drive: 'error', reason: 'missing_tokens' })
  }

  // 연결된 Google 계정 이메일 조회.
  //
  // ⚠️ 예전엔 oauth2.userinfo.get()을 썼는데, 이 흐름의 스코프는 drive.file 하나뿐이라
  // userinfo가 **항상 실패**했고 catch가 조용히 로그인 사용자 이메일로 대체했다.
  // 그래서 카드가 "michaelkim@data-alliance.com"이라 표시하는데 실제 파일은
  // 전혀 다른 계정(kko2349@gmail.com)의 드라이브로 들어가고 있었다.
  // drive.about.get은 drive.file 스코프로도 **실제 연결 계정**을 돌려준다 — 스코프 추가 불필요.
  auth.setCredentials(tokens)
  let accountEmail = ''

  try {
    // google-auth-library 중복 설치로 OAuth2Client 타입 동일성이 깨져,
    // googleapis가 번들한 자체 타입으로 캐스팅한다(런타임 동작 동일).
    const drive = google.drive({
      version: 'v3',
      auth: auth as unknown as Auth.OAuth2Client,
    })
    const { data: about } = await drive.about.get({ fields: 'user(emailAddress)' })
    accountEmail = about.user?.emailAddress ?? ''
  } catch (e: unknown) {
    // 여기까지 실패하면 어느 계정인지 표시할 방법이 없다. 삼키지 말고 남긴다.
    console.error('[google-drive/callback] 연결 계정 조회 실패:', e)
  }

  if (!accountEmail) {
    // 로그인 사용자 이메일로 대체하지 않는다 — 틀린 계정을 맞는 것처럼 보여주느니
    // 모른다고 말하는 편이 낫다(사용자가 '연결 테스트'로 실제 계정을 확인할 수 있다).
    accountEmail = '계정 확인 불가'
  }

  // system_settings에 토큰 저장 (adminClient — RLS 우회)
  const tokenExpiry = tokens.expiry_date
    ? new Date(tokens.expiry_date).toISOString()
    : new Date(Date.now() + 3600 * 1000).toISOString()

  try {
    await saveTokens(
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry,
        accountEmail,
      },
      user.id
    )
  } catch (e: unknown) {
    // 저장 실패를 삼키면 "연결됨"이라 표시해놓고 실제로는 아무것도 저장이 안 된다
    console.error('[google-drive/callback] 토큰 저장 실패:', e)
    cookieStore.delete(RETURN_COOKIE)
    return back({ drive: 'error', reason: 'save_failed' })
  }

  cookieStore.delete(RETURN_COOKIE)
  return back({ drive: 'connected' })
}
