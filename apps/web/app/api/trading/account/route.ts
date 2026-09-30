// GET /api/trading/account — 증권사 계좌를 지금 한 번 읽는다
//
// 사용자 지시 2026-09-30: 「계좌를 직접 볼 수 있으면 그것도 하고 직접 매매는 안해도
// 데이터는 받을수있으니」.
//
// ## 왜 서버 컴포넌트가 아니라 창구인가
//
// 화면을 그릴 때마다 증권사를 부르면 탭을 열어 두는 것만으로 KIS 호출이 계속 나간다.
// 매분 도는 수집도 같은 계좌를 묻고 있어 초당 제한에 같이 걸린다.
// **사람이 누를 때만** 나가야 한다.
//
// ## 보안
//
// - 소유자 확인(`tradingAccess`)을 지나야 한다. 레이아웃이 쓰는 것과 **같은 함수**다 —
//   제 나름의 확인을 만들면 두 판정이 갈린다 (S2)
// - 조회 창구만 부른다. 주문 창구는 같은 경로에 살고 끝 글자로만 갈리므로
//   `AccountClient` 의 조회 메서드 밖으로 안 나간다
// - 증권사 원문(`msg1`)을 응답에 안 싣는다. 코드와 우리가 적은 말만 싣는다 (S3)
// - 사람이 눌러야 나가지만 연타는 막는다 — 최소 간격을 둔다

import { NextResponse } from 'next/server'
import { tradingAccess } from '@/lib/trading/access'
import { loadAccountRef, loadAppCredential } from '@/lib/trading/broker/credentials'
import { getAccessToken } from '@/lib/trading/broker/token'
import { createAccountClient } from '@/lib/trading/broker/account'
import { moneyRows, positionRows, accountFailureView } from '@/lib/trading/broker/account-view'
import { loadTradingSettings } from '@/lib/trading/settings/store'
import { isNightHour } from '@/lib/trading/calendar/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * 연타 막기. **한 판(instance)에서만 센다** — 여러 판이 뜨면 각자 센다.
 * 정확한 한도가 아니라 실수로 스무 번 누르는 것을 막는 턱이다.
 */
const MIN_INTERVAL_MS = 3_000
let lastCallAt = 0

export async function GET() {
  if (!(await tradingAccess()).allowed) {
    return NextResponse.json({ ok: false, why: '이 화면의 소유자만 볼 수 있습니다', how: '' }, { status: 403 })
  }

  const now = Date.now()
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    return NextResponse.json(
      { ok: false, why: '너무 자주 눌렀습니다', how: '잠시 뒤 다시 눌러 주세요', code: null },
      { status: 429 },
    )
  }
  lastCallAt = now

  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())
    const { values } = await loadTradingSettings(today)
    const env = String(values.kis_env ?? 'paper') === 'real' ? 'real' : 'paper'

    const acct = await loadAccountRef(env, String(values.kis_account_product_code ?? '03'))
    if (!acct) {
      return NextResponse.json({
        ok: false,
        why: '증권사 계좌번호가 아직 없습니다',
        how: '트레이딩 설정의 증권사 자격증명에서 선물옵션 계좌번호를 넣어 주세요',
        code: null,
      }, { status: 409 })
    }
    const credential = await loadAppCredential(env)
    if (!credential) {
      return NextResponse.json({
        ok: false,
        why: '증권사 앱 키가 아직 없습니다',
        how: '트레이딩 설정의 증권사 자격증명을 먼저 채워 주세요',
        code: null,
      }, { status: 409 })
    }
    const token = await getAccessToken({
      env,
      refreshMarginMinutes: Number(values.kis_token_refresh_margin_minutes) || 30,
      runId: 'account-view',
      now: new Date(),
    })
    if (!token.ok) {
      // 토큰을 못 받으면 계좌를 못 묻는다. 증권사 원문 대신 우리가 적은 말을 준다
      return NextResponse.json({ ok: false, ...accountFailureView(token.reason) }, { status: 502 })
    }

    const client = createAccountClient({
      env,
      auth: { accessToken: token.accessToken, appKey: credential.appKey, appSecret: credential.appSecret },
      acct,
      minIntervalMs: Number(values.kis_min_interval_ms) || 200,
      isNight: isNightHour(new Date()),
    })

    /* 조회 둘만 부른다. 주문 쪽은 이름도 안 가져온다 */
    const [deposit, positions] = await Promise.all([client.deposit(), client.positions()])
    if (!deposit.ok && !positions.ok) {
      // 둘 다 실패면 같은 원인이다. 증권사 원문은 안 싣고 코드와 우리 말만 싣는다
      return NextResponse.json({ ok: false, ...accountFailureView(deposit.reason) }, { status: 502 })
    }

    /* 한쪽만 실패했으면 그 사실을 말한다 — 빈 목록을 「없다」로 읽으면 안 된다 */
    const halfFailed = !deposit.ok ? deposit.reason : !positions.ok ? positions.reason : null
    return NextResponse.json({
      ok: true,
      money: moneyRows(deposit.ok ? deposit.value : null),
      positions: positions.ok ? positionRows(positions.value) : [],
      partial: halfFailed === null ? null : accountFailureView(halfFailed),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    return NextResponse.json({ ok: false, ...accountFailureView(message) }, { status: 502 })
  }
}
