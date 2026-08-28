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
