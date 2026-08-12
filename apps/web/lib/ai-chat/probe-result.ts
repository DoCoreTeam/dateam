import type { ProbeModelResult } from './provider.ts'

function unavailableReason(providerLabel: string): string {
  return `${providerLabel}에서 현재 지원되지 않는 모델입니다.`
}

// 계정(키) 단위 실패 — 모델을 바꿔도 똑같이 실패한다. 대표적으로 OpenAI insufficient_quota는
// HTTP 429로 오지만 "잠시 후 재시도"로 절대 풀리지 않는다(크레딧 소진·결제수단 미등록).
// 모델별 한도 초과와 반드시 구분해야 사용자가 진짜 원인(결제)을 볼 수 있다.
const ACCOUNT_QUOTA_TOKENS = [
  'insufficient_quota',
  'exceeded your current quota',
  'check your plan and billing',
  'billing_not_active',
  'credit balance is too low',
]

function isAccountQuotaFailure(raw: string, code: string | undefined): boolean {
  if (code && ACCOUNT_QUOTA_TOKENS.includes(code)) return true
  return ACCOUNT_QUOTA_TOKENS.some((token) => raw.includes(token))
}

/** 최소 생성 호출의 실패를 모델 가용 상태로 변환하는 SSOT. */
export function classifyModelProbeFailure(
  providerLabel: string,
  status: number | undefined,
  detail: string,
  code?: string,
): ProbeModelResult {
  const raw = detail.toLowerCase()

  // 계정 단위 실패는 status 분기보다 우선 — 남은 모델을 더 찔러봐야 결과가 같다(조기 중단 신호).
  if (isAccountQuotaFailure(raw, code?.toLowerCase())) {
    return {
      usable: false,
      availability: 'unavailable',
      reason: `${providerLabel} 계정의 크레딧이 소진되었거나 결제가 설정되지 않았습니다. 공급자 콘솔에서 결제 상태를 확인하세요.`,
      accountLevel: true,
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
} {
  const candidate = error as {
    status?: unknown
    code?: unknown
    message?: unknown
    error?: { message?: unknown; code?: unknown }
  } | null
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined
  const detail = typeof candidate?.error?.message === 'string'
    ? candidate.error.message
    : typeof candidate?.message === 'string' ? candidate.message : String(error ?? '')
  // OpenAI/Anthropic SDK는 기계판독 코드를 error.code(또는 code)에 담는다 — 문구 변경에 안 흔들리는 판정 근거.
  const rawCode = candidate?.error?.code ?? candidate?.code
  const code = typeof rawCode === 'string' ? rawCode : undefined
  return { status, detail, code }
}
