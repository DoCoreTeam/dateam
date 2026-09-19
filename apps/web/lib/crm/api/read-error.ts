/**
 * API 오류 봉투에서 사람이 읽을 문장을 꺼낸다 (SSOT).
 *
 * **왜 한 곳인가**: 봉투는 `{ error: { code, message, details } }` 인데
 * 화면마다 `body.message` 를 읽으면 **서버가 준 이유가 통째로 버려진다** —
 * 사용자는 「잠시 후 다시 시도해 주세요」만 보고 같은 값을 다시 넣는다.
 * (실브라우저에서 잡았다: 현물이 사업비를 넘어 막혔는데 그 사실이 화면에 안 떴다)
 */

export interface CrmErrorBody {
  error?: { code?: string; message?: string; details?: Record<string, unknown> }
  /** 옛 라우트가 평평하게 보내는 경우도 받아 준다 */
  message?: string
}

export function readApiError(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const b = body as CrmErrorBody
    const m = b.error?.message ?? b.message
    if (typeof m === 'string' && m.trim() !== '') return m
  }
  return fallback
}

/** 코드로 분기해야 할 때 — 기계는 코드를 읽고 사람은 문장을 읽는다 */
export function readApiErrorCode(body: unknown): string | null {
  if (body && typeof body === 'object') {
    const c = (body as CrmErrorBody).error?.code
    if (typeof c === 'string') return c
  }
  return null
}

/**
 * `fetch` 자체가 실패했을 때 — **서버가 응답조차 못 한 상황**이다.
 *
 * **왜 구분하나**: 지금까지 화면들은 `catch` 에서 「…하지 못했습니다. 잠시 후 다시
 * 시도해 주세요」를 띄웠다. 그런데 그 문장은 «서버가 오류를 줬다»는 뜻으로 읽힌다.
 * 실제로는 서버가 꺼졌거나 인터넷이 끊긴 것일 수 있고, 그때 사용자가 할 일은 전혀 다르다 —
 * 다시 눌러 봐야 똑같이 실패한다.
 * (실측: 검증용 서버를 끄자 딜 목록이 「딜을 불러오지 못했습니다. 잠시 후 다시 시도해
 *  주세요」라고만 말했다. 서버가 없다는 사실은 어디에도 없었다.)
 *
 * `navigator.onLine` 은 «랜선이 꽂혀 있나» 수준이라 완벽하지 않다.
 * 그래도 **끊긴 것이 확실할 때** 그렇게 말해 주는 것이, 늘 같은 말을 하는 것보다 낫다.
 */
export function describeFetchFailure(objectLabel: string): string {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  if (offline) {
    return `인터넷 연결이 끊겨 ${objectLabel}${eulReulLocal(objectLabel)} 불러오지 못했어요. 연결을 확인한 뒤 다시 시도해 주세요.`
  }
  return `서버에 연결하지 못해 ${objectLabel}${eulReulLocal(objectLabel)} 불러오지 못했어요. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.`
}

/**
 * 받침에 따라 을/를.
 *
 * `lib/ui/josa.ts` 를 부르지 않는 이유: 이 파일은 화면·서버 양쪽에서 쓰이는
 * 얇은 껍데기라 UI 계층에 의존을 만들지 않는다. 규칙은 한 줄이다.
 */
function eulReulLocal(word: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return '을(를)'
  return (code - 0xAC00) % 28 === 0 ? '를' : '을'
}

/**
 * 응답 하나를 **끝까지** 읽는다 — 본문이 JSON 이 아닐 수도 있다.
 *
 * **왜 필요한가**: 화면들이 `await res.json()` 을 그냥 부른다. 서버가 JSON 을 줄 때는
 * 괜찮지만, 게이트웨이가 끊거나(504) 본문이 너무 커서 막히거나(413) 로그인 화면으로
 * 돌려보내면(HTML) **그 줄에서 예외가 난다.** 그러면 `catch` 로 떨어져
 * 「읽지 못했습니다. 잠시 후 다시 시도해 주세요」 한 마디가 뜬다 —
 * 20MB 짜리를 올렸든 3분을 기다렸든 화면은 **똑같은 말**을 한다. 할 일이 다른데.
 *
 * 본문은 **한 번만** 읽는다(`Response` 는 두 번 못 읽는다). 텍스트로 받아 JSON 이면 풀고,
 * 아니면 상태 코드가 말하는 상황을 문장으로 만든다.
 */
export interface ReadResponse {
  ok: boolean
  status: number
  /** JSON 이면 그 값, 아니면 null */
  body: unknown
  /** 실패했을 때 화면에 띄울 문장. 성공이면 null */
  message: string | null
}

export async function readResponse(res: Response, fallback: string): Promise<ReadResponse> {
  let text = ''
  try { text = await res.text() } catch { /* 본문을 못 읽어도 상태 코드는 있다 */ }

  let body: unknown = null
  if (text.trim() !== '') {
    try { body = JSON.parse(text) } catch { body = null }
  }

  if (res.ok) return { ok: true, status: res.status, body, message: null }
  // 서버가 이유를 줬으면 그 이유가 언제나 우선이다 — 우리가 지어낸 말보다 정확하다
  const fromBody = body === null ? null : readApiError(body, '')
  return {
    ok: false,
    status: res.status,
    body,
    message: fromBody && fromBody.trim() !== '' ? fromBody : describeHttpFailure(res.status, fallback),
  }
}

/**
 * 상태 코드가 말하는 상황 — **다음에 무엇을 하면 되는지**까지 적는다.
 *
 * 문장을 여기 두는 이유는 `describeFetchFailure` 와 같다: 이 파일이 「API 실패를 사람 말로
 * 바꾸는 한 곳」이다. 화면마다 적으면 같은 504 가 화면에 따라 다른 말을 하게 된다.
 */
export function describeHttpFailure(status: number, fallback: string): string {
  if (status === 401 || status === 403) {
    return '로그인이 풀렸거나 권한이 없어요. 새로고침해서 다시 로그인한 뒤 시도해 주세요.'
  }
  if (status === 413) {
    return '파일이 너무 커서 서버가 받지 못했어요. 더 작은 파일로 나눠 올려 주세요.'
  }
  if (status === 429) {
    return '요청이 몰려 잠시 막혔어요. 1~2분 뒤에 다시 시도해 주세요.'
  }
  if (status === 504 || status === 408) {
    return '읽는 데 시간이 너무 오래 걸려 연결이 끊겼어요. 파일을 나누거나 잠시 뒤 다시 시도해 주세요.'
  }
  if (status === 502 || status === 503) {
    return '서버가 지금 응답하지 못하고 있어요. 잠시 뒤 다시 시도하고, 계속되면 관리자에게 알려 주세요.'
  }
  if (status >= 500) {
    return `${fallback} 서버에서 오류가 났어요(${status}). 계속되면 관리자에게 알려 주세요.`
  }
  return fallback
}
