import type { ProbeModelResult } from './provider.ts'

function unavailableReason(providerLabel: string): string {
  return `${providerLabel}에서 현재 지원되지 않는 모델입니다.`
}

// 계정(키) 단위 실패 — 모델을 바꿔도 똑같이 실패한다. 대표적으로 OpenAI insufficient_quota는
// HTTP 429로 오지만 "잠시 후 재시도"로 절대 풀리지 않는다(크레딧 소진·결제수단 미등록).
// 모델별 한도 초과와 반드시 구분해야 사용자가 진짜 원인(결제)을 볼 수 있다.
//
// **두 갈래로 본다** — 기계 코드와 본문 문구.
// 실측 2026-10-01: OpenAI 가 `type: insufficient_quota` · `code: credit_balance_exhausted` ·
// 「You have no credits remaining」을 돌려줬는데, 문구 목록이 옛말(`exceeded your current quota`)만
// 알아서 모델 91개가 전부 「잠시 후 다시 확인하세요」로 적혔다. 공급자는 문구를 바꾼다.
// 그래서 문구에만 기대지 않고 **기계 코드(code·type)를 먼저 본다**.
/*
  **돈이 떨어진 것**만 여기 적는다. 시간이 지나도 안 풀리고 결제가 붙어야 풀리는 신호다.
  이 목록이 「결제하세요」라는 말의 유일한 근거다.
*/
const CREDIT_EXHAUSTED_CODES = [
  'insufficient_quota',        // OpenAI error.type (예전에는 code 로도 왔다)
  'credit_balance_exhausted',  // OpenAI error.code, 실측 2026-10-01
  'billing_not_active',
  'billing_hard_limit_reached',
]

const CREDIT_EXHAUSTED_PHRASES = [
  'insufficient_quota',
  'billing_not_active',
  'credit balance is too low',
  'no credits remaining',   // 실측 2026-10-01
  'add credits to continue',
]

/*
  **애매한 옛 문구.** 젬민 무료 등급은 하루치 한도를 다 쓰면 이 말을 하고, 자정이면 풀린다.
  결제를 권하는 말투지만 돈이 떨어진 것이 아니다 — 그래서 사용자에게 「결제하세요」라고
  말하는 근거로는 쓰지 않는다 (실측 가드: lib/crm/ai/provider-quota.test.ts).

  그래도 **훑기를 멈추는 신호로는** 쓴다. 이 답이 온 키로는 다음 모델도 같은 답이 오므로
  모델 수만큼 더 찔러 봐야 결과가 같다. 멈추는 판단과 말하는 판단은 다른 질문이다.
*/
const SPENT_QUOTA_PHRASES = [
  'exceeded your current quota',
  'check your plan and billing',
]

function hits(raw: string, phrases: string[], codes: string[], code?: string, type?: string): boolean {
  for (const signal of [code, type]) {
    if (signal && codes.includes(signal)) return true
  }
  return phrases.some((phrase) => raw.includes(phrase))
}

/**
 * **돈이 떨어졌는가** — 기다려도 안 풀리고 결제가 붙어야 풀리는 실패인가.
 *
 * 내보내는 이유: 같은 질문을 채팅 쪽(`provider-errors`)에서도 한다. 목록을 두 벌 두면
 * 모델 선택 창은 「결제하세요」라고 하는데 채팅은 「잠시 후 다시」라고 하는 날이 온다.
 */
export function isCreditExhaustedFailure(raw: string, code?: string, type?: string): boolean {
  return hits(raw, CREDIT_EXHAUSTED_PHRASES, CREDIT_EXHAUSTED_CODES, code, type)
}

/**
 * **이 키로는 더 물어봐야 소용없는가** — 훑기를 멈출지 정하는 질문.
 * 돈이 떨어진 경우를 포함하고, 거기에 「할당량을 다 썼다」는 애매한 답까지 센다.
 */
export function isAccountQuotaFailure(raw: string, code?: string, type?: string): boolean {
  return isCreditExhaustedFailure(raw, code, type)
    || hits(raw, SPENT_QUOTA_PHRASES, [], code, type)
}

/** 최소 생성 호출의 실패를 모델 가용 상태로 변환하는 SSOT. */
export function classifyModelProbeFailure(
  providerLabel: string,
  status: number | undefined,
  detail: string,
  code?: string,
  type?: string,
): ProbeModelResult {
  const raw = detail.toLowerCase()

  // 계정 단위 실패는 status 분기보다 우선 — 남은 모델을 더 찔러봐야 결과가 같다(조기 중단 신호).
  if (isAccountQuotaFailure(raw, code?.toLowerCase(), type?.toLowerCase())) {
    return {
      usable: false,
      availability: 'unavailable',
      reason: `${providerLabel} 계정의 크레딧이 소진되었거나 결제가 설정되지 않았습니다. 공급자 콘솔에서 결제 상태를 확인하세요.`,
      accountLevel: true,
      // 결제가 붙으면 풀린다. 사람이 키를 고칠 일이 아니므로 쉬게만 두고 다음 키로 넘어간다
      keyOutcome: 'quota',
    }
  }

  const modelUnavailable = [
    'model not found', 'model_not_found', 'does not exist', 'no longer available',
    'not supported', 'unsupported model', 'deprecated', 'invalid model',
  ].some((token) => raw.includes(token))

  if (status === 404 || modelUnavailable) {
    return { usable: false, availability: 'unavailable', reason: unavailableReason(providerLabel) }
  }
  if (status === 429) {
    const noQuota = raw.includes('limit: 0') || raw.includes('quota: 0') || raw.includes('quota limit is 0')
    return noQuota
      ? { usable: false, availability: 'unavailable', reason: '현재 요금제에 이 모델의 할당량이 없습니다.' }
      : { usable: false, availability: 'limited', reason: '현재 요청 또는 토큰 한도에 도달했습니다. 잠시 후 다시 확인하세요.' }
  }
  if (status === 401) {
    // 키 자체가 무효 → 다른 모델도 전부 같은 결과. 조기 중단 대상.
    return {
      usable: true,
      availability: 'unknown',
      reason: 'API 키가 유효하지 않아 모델 상태를 확인하지 못했습니다.',
      accountLevel: true,
      // 기다려도 안 풀린다. 사람이 키를 바꿔야 하므로 그렇게 적는다
      keyOutcome: 'auth',
    }
  }
  if (status === 403) {
    // 403은 계정 단위가 아닐 수 있다 — OpenAI·Anthropic 모두 "조직 인증/접근 등급이 필요한 개별 모델"에
    // 403을 준다. 이걸 계정 실패로 보면 등급 제한 모델 하나가 나머지 전 모델의 확인을 막아버린다.
    return {
      usable: true,
      availability: 'unknown',
      reason: '접근 권한이 없어 확인하지 못했습니다(키 권한 또는 이 모델의 접근 등급).',
    }
  }
  return {
    usable: true,
    availability: 'unknown',
    reason: status ? `공급자 상태를 확인하지 못했습니다. (${status})` : '네트워크 오류로 상태를 확인하지 못했습니다.',
  }
}

export function getProviderErrorDetail(error: unknown): {
  status: number | undefined
  detail: string
  code: string | undefined
  type: string | undefined
} {
  const candidate = error as {
    status?: unknown
    code?: unknown
    type?: unknown
    message?: unknown
    error?: { message?: unknown; code?: unknown; type?: unknown }
  } | null
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined
  const detail = typeof candidate?.error?.message === 'string'
    ? candidate.error.message
    : typeof candidate?.message === 'string' ? candidate.message : String(error ?? '')
  // OpenAI/Anthropic SDK는 기계판독 코드를 error.code(또는 code)에 담는다 — 문구 변경에 안 흔들리는 판정 근거.
  const rawCode = candidate?.error?.code ?? candidate?.code
  const code = typeof rawCode === 'string' ? rawCode : undefined
  /*
    `type` 도 같이 꺼낸다. OpenAI 는 크레딧 소진을 `type: insufficient_quota` 로 말하고
    `code` 쪽은 사정에 따라 바꾼다(실측 2026-10-01 `credit_balance_exhausted`).
    code 하나만 보면 공급자가 code 를 바꿀 때마다 계정 실패가 모델 한도로 둔갑한다.
  */
  const rawType = candidate?.error?.type ?? candidate?.type
  const type = typeof rawType === 'string' ? rawType : undefined
  return { status, detail, code, type }
}
