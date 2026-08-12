import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getOAuth2Client } from '@/lib/google-drive'
import { RETURN_TO_PARAM, sanitizeReturnTo } from '@/lib/nav/return-to'
import { randomBytes } from 'crypto'

/** 복귀 주소를 담는 쿠키. state와 같은 수명으로 둔다 */
const RETURN_COOKIE = 'gdrive_return_to'
/** 이 흐름의 기본 복귀 지점 — 연동 카드가 있는 탭 */
const DEFAULT_RETURN = '/admin/settings?tab=integrations'

export async function GET(req: NextRequest): Promise<NextResponse> {
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
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 600, // 10분
    path: '/',
  }
  cookieStore.set('gdrive_oauth_state', state, cookieOpts)

  // 떠나온 화면을 기억한다 — 동의를 마치면 여기로 돌려보낸다(§복귀 경로 SSOT).
  // 쿼리로 왕복시키지 않고 httpOnly 쿠키에 담는 이유: state와 함께 서버만 신뢰한다.
  const returnTo = sanitizeReturnTo(
    req.nextUrl.searchParams.get(RETURN_TO_PARAM),
    DEFAULT_RETURN,
  )
  cookieStore.set(RETURN_COOKIE, returnTo, cookieOpts)

  const auth = getOAuth2Client()
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // refresh_token을 항상 포함시키기 위해 필요
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  })

  return NextResponse.redirect(authUrl)
}
