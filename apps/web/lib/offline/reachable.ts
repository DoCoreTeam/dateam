/**
 * lib/offline/reachable.ts — 「우리 서버에 닿나」 SSOT
 *
 * **왜 생겼나 (실측 2026-09-30)**: 사용자가 CRM 첫 화면에서 「녹음 시작」을 눌렀고
 * 화면이 내놓은 말이 **「Failed to fetch」** 였다. 그 화면은 전날 그려진 것이었고
 * (딜이 「32일째」라고 적혀 있었는데 그날 서버가 세면 33일째다) 서버는 그 사이 내려가 있었다.
 * 화면은 그 동안 한 마디도 하지 않았다 — 멀쩡한 앱과 죽은 앱이 눈으로 같았다.
 *
 * 원인은 연결 판정을 `navigator.onLine` 으로 한 것이다. 그 값은 **기기 쪽**을 말한다.
 * 와이파이는 멀쩡했으므로 true 였고, 배너는 뜰 이유가 없었다.
 *
 * 그래서 여기서 재는 것은 딱 하나다 — **보내 봤더니 답이 왔나.**
 * 이 판정은 화면 둘(배너·창구 실패 문구)이 같이 쓰므로 한 곳에 둔다.
 */

/** 재는 창구 — 값이 하나도 없는 자리여야 한다(app/api/ping) */
export const PING_PATH = '/api/ping'

/** 이만큼 지나도 답이 없으면 「모름」이 아니라 「안 닿음」으로 센다 */
export const PING_TIMEOUT_MS = 4000

/**
 * 연속 몇 번 실패해야 「안 닿는다」고 말하나.
 *
 * 1 로 두면 안 된다. 한 번 튄 요청에 경고가 깜빡이면 그 배너는 안내가 아니라 고장 신호가 된다
 * (실제 지적 2026-08-31: "이거 연결 없음 뭐야? 장애인 거 같은데 인터넷 다 연결 되어 있어").
 */
export const UNREACHABLE_STREAK = 2

/**
 * 창구가 통째로 안 닿을 때 사용자에게 가는 말.
 *
 * 브라우저가 주는 원문은 「Failed to fetch」다. 그 말은 영어인 데다,
 * **무엇이 잘못됐는지도 무엇을 하면 되는지도** 말하지 않는다.
 */
export const SERVER_UNREACHABLE_MESSAGE =
  '서버에 닿지 못했어요. 연결이 끊겼거나 서버가 내려간 것입니다. 잠시 뒤 다시 눌러 주세요.'

/**
 * **답이 하나도 안 왔다**는 실패. 서버가 답하고 거절한 것과는 다른 종류다.
 *
 * 형으로 갈라 두는 이유: 부르는 쪽이 이 둘에 **다르게 대응한다.**
 * 못 닿은 것은 기기에 쌓아 두고 나중에 보내면 되고, 거절당한 것은 사람이 고쳐야 한다.
 * 문구를 비교해서 가르면 문구를 다듬는 순간 그 분기가 조용히 죽는다.
 */
export class ServerUnreachableError extends Error {
  constructor(message: string = SERVER_UNREACHABLE_MESSAGE) {
    super(message)
    this.name = 'ServerUnreachableError'
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/**
 * 한 번 물어본다.
 *
 * **매달린 요청을 「닿음」으로 세지 않는다.** 답이 안 오는 것과 안 닿는 것은
 * 사용자에게 같은 일이다 — 둘 다 지금 누르면 실패한다.
 * 그래서 시간 제한을 경쟁시키고, 제한에 걸리면 실제 요청도 끊는다.
 */
export async function pingServer(
  fetchImpl: FetchLike,
  timeoutMs: number = PING_TIMEOUT_MS,
): Promise<boolean> {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null
  let timer: ReturnType<typeof setTimeout> | undefined

  const giveUp = new Promise<false>((resolve) => {
    timer = setTimeout(() => {
      ctl?.abort()
      resolve(false)
    }, timeoutMs)
  })

  try {
    const answered = fetchImpl(PING_PATH, {
      method: 'GET',
      // 캐시된 200 은 「서버가 살아 있다」의 증거가 아니다
      cache: 'no-store',
      signal: ctl?.signal,
    })
      .then((res) => res.ok)
      .catch(() => false)

    return await Promise.race([answered, giveUp])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 실패가 몇 번째로 이어졌나. 한 번이라도 닿으면 0 으로 돌아간다 */
export function nextFailureStreak(prev: number, answered: boolean): number {
  return answered ? 0 : prev + 1
}

/** 그 셈이 말할 만큼 쌓였나 */
export function isUnreachable(streak: number): boolean {
  return streak >= UNREACHABLE_STREAK
}
