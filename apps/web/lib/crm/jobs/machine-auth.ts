/**
 * 잡 입구의 "기계 호출" 판정 — SSOT
 *
 * **왜 이 파일이 생겼나**: 잡 3개(gmail-sync · expire-suggestions · stalled-deals)가
 * `req.headers.get('Authorization') !== \`Bearer ${expected}\`` 를 각자 복붙해 갖고 있었다.
 * 그런데 그 입구는 **크론이 실제로 보내는 요청과 모양이 달랐다.**
 *
 *   · Vercel 크론은 **GET** 으로 부르고 `CRON_SECRET` 을 Bearer 로 실어 보낸다.
 *   · 잡들은 전 워크스페이스 경로를 **POST + CI_WORKER_TOKEN** 에만 열어 두었다.
 *   · GET 은 `resolveCrmAccess()`(로그인 세션) 를 요구했고, 크론에는 세션이 없다.
 *
 * 결과: `vercel.json` 에 15분·1시간·1일로 등록해 둔 잡 셋이 **한 번도 돌지 않았다.**
 * (실측 2026-08-21 프로덕션 로그: 8시간 내내 `GET 403 /api/crm/jobs/gmail-sync`,
 *  `GET 403 /api/crm/jobs/expire-suggestions`. 화면에는 아무 이상이 없어서
 *  아무도 눈치채지 못하는, 이 저장소가 반복해 온 "만들어놓고 안 부르는" 사고의 재현이다.)
 *
 * 판정을 여기 한 곳에 두는 이유: **입구가 여러 개면 한쪽만 잠그게 된다.**
 * 잡이 하나 늘 때 이 함수를 부르기만 하면 크론·외부 스케줄러 양쪽이 같은 규칙을 받는다.
 */
import { timingSafeEqual } from 'crypto'

/**
 * 잡 입구가 인정하는 토큰의 출처.
 *
 * 둘을 함께 보는 이유: `CRON_SECRET` 은 **Vercel 크론이 자동으로 붙여 보내는** 값이고,
 * `CI_WORKER_TOKEN` 은 외부 스케줄러·pg_cron 이 손으로 붙이는 값이다.
 * 하나만 인정하면 나머지 한쪽 경로가 조용히 죽는다 — 그게 이번 사고였다.
 */
const TOKEN_ENVS = ['CRON_SECRET', 'CI_WORKER_TOKEN'] as const

/** 길이가 다르면 timingSafeEqual 이 던지므로 먼저 거른다 */
function safeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** 설정돼 있는 기계 토큰들 — 하나도 없으면 빈 배열(= 입구를 열지 않는다) */
export function machineTokens(): string[] {
  return TOKEN_ENVS
    .map((k) => process.env[k])
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * 이 요청이 기계(크론·스케줄러) 호출인가.
 *
 * 토큰이 **하나도 설정돼 있지 않으면 false** 다. "설정 안 됨 = 무인증 통과"로 두면
 * 전 워크스페이스를 도는 경로가 인터넷에 열린다.
 */
export function isMachineCall(req: { headers: { get(name: string): string | null } }): boolean {
  const auth = req.headers.get('authorization') ?? ''
  if (!auth) return false
  const tokens = machineTokens()
  if (tokens.length === 0) return false
  return tokens.some((t) => safeEq(auth, `Bearer ${t}`))
}

/** 기계 입구를 아예 쓸 수 없는 상태인지 — 호출부가 500 으로 알리기 위해 */
export function machineAuthUnconfigured(): boolean {
  return machineTokens().length === 0
}
