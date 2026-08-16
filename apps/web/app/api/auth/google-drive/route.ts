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

/**
 * 무엇을 위해 연결하는지 — 콜백이 토큰을 어디에 넣을지 정한다.
 *
 * **왜 경로를 새로 안 만들었나**: Google 콘솔에 등록된 redirect URI 는 이 콜백 하나다.
 * 새 경로를 만들면 사람이 콘솔에 가서 URI 를 추가해야 하고, 그때까지 연동이 막힌다.
 * 목적을 쿠키에 담아 같은 콜백에서 갈라 쓰면 **클라이언트를 그대로 재사용**할 수 있다.
 */
const PURPOSE_COOKIE = 'google_oauth_purpose'

/**
 * 목적별 동의 범위.
 *
 * 필요한 것만 받는다 — 메일을 읽을 이유가 없는 Drive 연동에 gmail 을 끼워 넣으면
 * 사용자가 동의 화면에서 겁을 먹고, 겁먹은 동의는 나중에 취소된다.
 */
const SCOPES: Record<string, string[]> = {
  drive: ['https://www.googleapis.com/auth/drive.file'],
  // CRM 은 **읽기만** 한다. 보내기 권한은 지금 쓸 데가 없고, 안 쓰는 권한은 사고 표면이다.
  crm: [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
}

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

  /**
   * 목적에 따라 누가 연결할 수 있는지가 다르다.
   *
   * · Drive: 조직 전체가 쓰는 저장소라 **관리자만**.
   * · CRM: 각자 **자기 메일함**을 붙이는 일이다. 관리자만 되게 하면
   *   팀원의 메일은 영영 안 들어오고, 그건 이 기능이 없는 것과 같다.
   *   대신 CRM 멤버가 아니면 안 된다 — 워크스페이스 밖 사람이 토큰을 심을 수 없어야 한다.
   */
  const purposeParam = req.nextUrl.searchParams.get('purpose') === 'crm' ? 'crm' : 'drive'
  const isAdmin = (profile as { role: string } | null)?.role === 'admin'

  if (purposeParam === 'crm') {
    const { resolveCrmAccess } = await import('@/lib/crm/auth/requireCrmMember')
    const access = await resolveCrmAccess()
    if (!access.ok) {
      return NextResponse.json(
        { error: '영업 CRM 멤버만 메일 연동을 설정할 수 있습니다' },
        { status: 403 }
      )
    }
  } else if (!isAdmin) {
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

  // 목적을 쿠키에 담는다 — 쿼리로 왕복시키면 콜백에서 위조 여부를 알 수 없다
  cookieStore.set(PURPOSE_COOKIE, purposeParam, cookieOpts)

  const auth = getOAuth2Client()
  const authUrl = auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // refresh_token을 항상 포함시키기 위해 필요
    scope: SCOPES[purposeParam],
    state,
  })

  return NextResponse.redirect(authUrl)
}
