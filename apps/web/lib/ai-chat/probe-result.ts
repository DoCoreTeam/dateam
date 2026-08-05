import type { ProbeModelResult } from './provider.ts'

function unavailableReason(providerLabel: string): string {
  return `${providerLabel}에서 현재 지원되지 않는 모델입니다.`
}

/** 최소 생성 호출의 실패를 모델 가용 상태로 변환하는 SSOT. */
export function classifyModelProbeFailure(
  providerLabel: string,
  status: number | undefined,
  detail: string,
): ProbeModelResult {
  const raw = detail.toLowerCase()
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
  if (status === 401 || status === 403) {
    return { usable: true, availability: 'unknown', reason: 'API 키 권한 문제로 모델 상태를 확인하지 못했습니다.' }
  }
  return {
    usable: true,
    availability: 'unknown',
    reason: status ? `공급자 상태를 확인하지 못했습니다. (${status})` : '네트워크 오류로 상태를 확인하지 못했습니다.',
  }
}

export function getProviderErrorDetail(error: unknown): { status: number | undefined; detail: string } {
  const candidate = error as { status?: unknown; message?: unknown; error?: { message?: unknown } } | null
  const status = typeof candidate?.status === 'number' ? candidate.status : undefined
  const detail = typeof candidate?.error?.message === 'string'
    ? candidate.error.message
    : typeof candidate?.message === 'string' ? candidate.message : String(error ?? '')
  return { status, detail }
}
