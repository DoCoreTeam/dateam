/**
 * 개발자센터 「직접 실행」의 말 (용어집 §0-2)
 *
 * ## 왜 필요한가 (실측 2026-10-24)
 *
 * 틀린 키로 「견적 계산」을 누르면 화면이 401 대신 「GPU 구성을 찾지 못했습니다」라고 했다.
 * 응답 상태를 안 보고 본문만 읽었기 때문이다. 성공 배지는 실제 상태와 상관없이 「200 OK」였고,
 * 실패는 「오류」 한 낱말뿐이었다. 사람은 키가 틀렸는지 서버가 죽었는지 가를 길이 없었다.
 *
 * 그래서 상태 번호에서 문장을 고르는 일을 여기 한 곳에서 한다. 화면은 받아 적기만 한다.
 */

import { ACTION, progress } from './action.ts'

/** 1분이 넘는 Retry-After 도 그대로 초로 말한다. 이 값 위로는 숫자를 믿지 않는다 */
const RETRY_AFTER_MAX_SECONDS = 86_400

/** 「복사됨」을 보여 주는 시간 */
export const COPY_FEEDBACK_MS = 1_500

export const DEMO = {
  /** 값이 비어 있는 칸 */
  empty: '없음',
  copy: '복사',
  copied: '복사됨',
  copyFailed: '복사하지 못했습니다. 「JSON 보기」에서 직접 골라 복사해 주세요.',
  showRaw: 'JSON 보기',
  showUi: 'UI 보기',
  running: progress('실행'),
  keyMissing: 'API 키를 입력해 주세요. 「내 키 관리」에서 발급할 수 있습니다.',
  noProduct: '견적을 낼 GPU 구성을 찾지 못했습니다. 먼저 「GPU 목록」을 실행해 보세요.',
  /** 요청을 보내기 전에 막았을 때의 배지 */
  notSent: '보내지 않음',
  unreachableBadge: '연결 실패',
  failedDefault: '요청을 처리하지 못했습니다.',
  keyHelp: 'API 키 확인',
  emptyResult: '결과가 0건입니다',
  emptyResultHint: '다른 데모를 실행하거나 API 키를 확인해 주세요.',
} as const

/** 결과 머리의 상태 배지 */
export function demoStatusBadge(status: number): string {
  return `HTTP ${status}`
}

export interface DemoFailure {
  /** 배지에 들어갈 짧은 말 */
  readonly badge: string
  /** 사람이 읽는 이유와 다음 행동 */
  readonly message: string
}

function retryAfterSeconds(retryAfter: string | null | undefined): number | null {
  if (!retryAfter || !/^\d+$/.test(retryAfter.trim())) return null
  const n = Number(retryAfter.trim())
  return n > 0 && n <= RETRY_AFTER_MAX_SECONDS ? n : null
}

function reasonFor(status: number, retryAfter: string | null | undefined): string {
  if (status === 401) return 'API 키가 맞지 않거나 만료됐습니다. 「내 키 관리」에서 키를 확인해 주세요.'
  if (status === 403) return '이 키에는 이 기능을 쓸 권한이 없습니다. 「내 키 관리」에서 키의 권한 범위를 확인해 주세요.'
  if (status === 429) {
    const sec = retryAfterSeconds(retryAfter)
    return sec != null
      ? `요청이 너무 많습니다. ${sec}초 뒤에 ${ACTION.retry}해 주세요.`
      : `요청이 너무 많습니다. 잠시 후 ${ACTION.retry}해 주세요.`
  }
  if (status >= 500) return `서버가 요청을 처리하지 못했습니다. 잠시 후 ${ACTION.retry}해 주세요.`
  return `요청이 처리되지 않았습니다. 응답 상태는 ${status}입니다.`
}

/**
 * 응답을 보고 실패인지와 그 이유를 고른다. 실패가 아니면 null.
 *
 * - status 0: 서버에 닿지 않았다 (fetch 자체가 실패)
 * - 2xx 가 아니면: 상태별 이유
 * - 2xx 인데 JSON 이 아니면: 결과를 그릴 수 없다고 말한다 (원문 HTML 을 화면에 그리지 않는다)
 */
export function describeDemoFailure(
  status: number,
  bodyIsJson: boolean,
  retryAfter?: string | null,
): DemoFailure | null {
  if (status === 0) {
    return { badge: DEMO.unreachableBadge, message: `서버에 연결하지 못했습니다. 네트워크를 확인하고 ${ACTION.retry}해 주세요.` }
  }
  const ok = status >= 200 && status < 300
  if (!ok) return { badge: demoStatusBadge(status), message: reasonFor(status, retryAfter) }
  if (!bodyIsJson) {
    return { badge: demoStatusBadge(status), message: '응답이 JSON 형식이 아니어서 결과를 표시할 수 없습니다. 「JSON 보기」에서 받은 내용을 확인할 수 있습니다.' }
  }
  return null
}

export interface DemoBody {
  readonly isJson: boolean
  /** JSON 객체일 때만 값이 있다. 배열이나 원시값은 결과로 그리지 않는다 */
  readonly body: Record<string, unknown> | null
}

/** 응답 본문 글을 JSON 으로 읽어 본다. 실패해도 던지지 않는다 (원문은 글로만 보여 준다) */
export function readDemoBody(text: string): DemoBody {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { isJson: true, body: parsed as Record<string, unknown> }
    }
    return { isJson: false, body: null }
  } catch {
    return { isJson: false, body: null }
  }
}

export interface DemoOutcome {
  /** 받은 HTTP 상태. 보내기 전에 막았거나 서버에 닿지 않았으면 null */
  readonly status: number | null
  readonly body: Record<string, unknown> | null
  /** 받은 본문 원문. 화면에는 글로만 보여 준다 */
  readonly text: string
  readonly failure: DemoFailure | null
}

/** 받은 응답(상태, 본문 글, Retry-After)을 화면이 그릴 결과로 바꾼다 */
export function interpretDemoResponse(
  status: number,
  text: string,
  retryAfter?: string | null,
): DemoOutcome {
  const { isJson, body } = readDemoBody(text)
  return { status, body, text, failure: describeDemoFailure(status, isJson, retryAfter) }
}

/** 요청을 보내기 전에 막았을 때 (키 없음, 키 형식, 앞 단계 값 없음) */
export function blockedDemoOutcome(message: string): DemoOutcome {
  return { status: null, body: null, text: '', failure: { badge: DEMO.notSent, message } }
}
