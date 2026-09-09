/**
 * 사내 서빙 어댑터 (설계서 3.6.3)
 *
 * ## GPU 가 필요한 자리는 여기 하나다
 *
 * 사용자가 물었던 「GPU 가 필요한 기능이 뭐냐」의 답이 이 파일이다.
 * NDA 문서는 밖으로 못 보내니 **사내에서 돌리는 모델**이 있어야 처리할 수 있다.
 * 그런데 이 시스템은 GPU 를 직접 붙들지 않는다 — **OpenAI 호환 주소 하나**만 알면 된다.
 * 그 주소 뒤에 vLLM 이 있든 Ollama 가 있든 다른 회사 사내 서버가 있든 상관없다.
 *
 * ## 등록 전에는 후보에서 빠진다
 *
 * 주소가 없는 내부 벤더를 후보에 남겨 두면 «사내 모델이 있다» 고 화면이 말하고,
 * NDA 문서를 올린 사용자가 그 말을 믿고 기다린다. 없으면 없다고 해야 한다.
 */

import type { DocClass } from '../domain/doc-class.ts'
import type { AiModel } from './models.ts'
import type { RawCallResult, CallRequest } from './gateway.ts'

/** 내부 벤더 등록에 필요한 것 — 이 셋이면 끝이다 */
export interface SelfHostedEndpoint {
  /** OpenAI 호환 주소. `/v1/chat/completions` 앞까지 */
  baseUrl: string
  /** 없어도 되는 서버가 있다(사내망 전용). 빈 값이면 헤더를 안 붙인다 */
  apiKey: string | null
  /** 서버가 아는 모델 이름 */
  modelName: string
}

export type EndpointProblem = 'missing_base_url' | 'invalid_base_url' | 'missing_model_name' | 'insecure_url'

export type EndpointCheck =
  | { ok: true; endpoint: SelfHostedEndpoint }
  | { ok: false; problems: EndpointProblem[] }

/**
 * 등록값을 검사한다.
 *
 * 사내망 주소(http)를 막지 않는 이유: 사내 서버는 대개 TLS 가 없다.
 * 대신 **공인 도메인에 http 를 쓰는 것**은 막는다 — 그건 사내망이 아니라 평문 인터넷이다.
 */
export function checkEndpoint(raw: Partial<SelfHostedEndpoint>): EndpointCheck {
  const problems: EndpointProblem[] = []
  const baseUrl = (raw.baseUrl ?? '').trim()
  const modelName = (raw.modelName ?? '').trim()

  if (!baseUrl) problems.push('missing_base_url')
  if (!modelName) problems.push('missing_model_name')

  if (baseUrl) {
    let url: URL | null = null
    try { url = new URL(baseUrl) } catch { problems.push('invalid_base_url') }
    if (url) {
      if (url.protocol !== 'http:' && url.protocol !== 'https:') problems.push('invalid_base_url')
      else if (url.protocol === 'http:' && !isPrivateHost(url.hostname)) problems.push('insecure_url')
    }
  }

  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    endpoint: { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey: raw.apiKey?.trim() || null, modelName },
  }
}

/** 사내망 주소인가 — 여기 해당하면 http 를 허용한다 */
export function isPrivateHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) return true
  if (/^127\./.test(hostname) || /^10\./.test(hostname) || /^192\.168\./.test(hostname)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  return false
}

/**
 * 사내 모델의 기본 등급.
 *
 * 셋 다인 이유는 **사내 서빙이 등급 제한의 대상이 아니라 등급 제한의 해답**이기 때문이다.
 * NDA 를 빼면 이 어댑터를 만든 이유가 사라진다.
 */
export const INTERNAL_DEFAULT_DOC_CLASSES: readonly DocClass[] = ['public', 'restricted', 'nda']

/** 사내 모델은 밖으로 안 나가므로 보존 정책이 «무보존» 이다 */
export const INTERNAL_RETENTION = { noTraining: true, retentionDays: 0, zeroRetention: true } as const

/**
 * 등록값으로 모델 한 벌을 만든다.
 *
 * `internal: true` 가 붙어야 게이트웨이가 외부 전송으로 세지 않는다.
 */
export function toInternalModel(
  id: string, vendorId: string, endpoint: SelfHostedEndpoint,
  over: Partial<AiModel> = {},
): AiModel {
  return {
    id,
    vendorId,
    modelName: endpoint.modelName,
    displayName: over.displayName ?? `사내 ${endpoint.modelName}`,
    allowedDocClasses: over.allowedDocClasses ?? Array.from(INTERNAL_DEFAULT_DOC_CLASSES),
    internal: true,
    retention: { ...INTERNAL_RETENTION },
    // 사내 서빙은 토큰당 요금이 없다. 전기와 GPU 는 여기서 안 센다
    inputKrwPerMTok: over.inputKrwPerMTok ?? 0,
    outputKrwPerMTok: over.outputKrwPerMTok ?? 0,
    multimodal: over.multimodal ?? false,
    enabled: over.enabled ?? true,
    // 사내를 먼저 시도한다 — 등급이 높은 문서일수록 여기밖에 길이 없다
    sortOrder: over.sortOrder ?? 1,
  }
}

/**
 * 등록되지 않은 내부 벤더를 후보에서 뺀다.
 *
 * 「사내 모델이 있다」고 화면이 말하고 사용자가 기다리는 것보다,
 * 「없다」고 말해 관리자가 등록하게 하는 편이 낫다.
 */
export function usableInternalModels(
  models: readonly AiModel[],
  endpoints: ReadonlyMap<string, SelfHostedEndpoint | null>,
): AiModel[] {
  return models.filter((m) => {
    if (!m.internal) return true
    const ep = endpoints.get(m.vendorId)
    return Boolean(ep && checkEndpoint(ep).ok)
  })
}

/** OpenAI 호환 채팅 호출 — 주소 뒤에 무엇이 있든 이 모양이면 된다 */
export function createSelfHostedCaller(
  endpoints: ReadonlyMap<string, SelfHostedEndpoint>,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 120_000,
) {
  return async function call(model: AiModel, prompt: string, req: CallRequest): Promise<RawCallResult> {
    const ep = endpoints.get(model.vendorId)
    if (!ep) throw new Error(`사내 엔드포인트가 등록되지 않았다: ${model.vendorId}`)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(`${ep.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: ep.modelName,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: req.maxOutputTokens ?? 4096,
          temperature: 0,
        }),
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`사내 모델 응답 ${res.status}`)
      const json = await res.json() as {
        choices?: { message?: { content?: string } }[]
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }
      const text = json.choices?.[0]?.message?.content ?? ''
      if (!text) throw new Error('사내 모델이 빈 응답을 줬다')
      return {
        text,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
