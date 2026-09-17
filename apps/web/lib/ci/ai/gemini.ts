// lib/ci/ai/gemini.ts — Gemini 호출 (CI 전용 얇은 래퍼)
// 나가는 자리는 관문(lib/ai/guarded-gemini) 하나다 — 가림과 원장이 여기서 자동으로 붙는다
// 키·모델은 기존 org_content META를 재사용한다(lib/ci/ai/meta.ts).
// 실패를 예외로 던지지 않는다 — 호출자가 폴백을 고를 수 있어야 한다.

import {
  guardedGeminiParts, GeminiCallError, type GeminiPart as GatePart,
} from '@/lib/ai/guarded-gemini'

const TIMEOUT_MS = 60_000

/** 미디어 파트를 관문이 받는 모양으로. 원격은 camelCase가 아니면 통째로 무시된다. */
function toApiPart(p: GeminiPart): GatePart {
  return p.kind === 'remote'
    ? { fileData: p.mimeType ? { fileUri: p.uri, mimeType: p.mimeType } : { fileUri: p.uri } }
    : { inlineData: { mimeType: p.mimeType, data: p.data } }
}

export type GeminiResult =
  | { ok: true; text: string; promptTokens: number; outputTokens: number }
  | { ok: false; error: string }

/**
 * 프롬프트에 함께 실어 보낼 것. 텍스트 말고 실제 미디어를 넘길 때 쓴다.
 *  - remote: 모델이 직접 가져가는 주소 (YouTube 공개 영상 등)
 *  - inline: 우리가 받아서 base64로 실어 보내는 것 (썸네일 등)
 */
export type GeminiPart =
  | { kind: 'remote'; uri: string; mimeType?: string }
  | { kind: 'inline'; mimeType: string; data: string }

interface CallInput {
  apiKey: string
  model: string
  prompt: string
  temperature?: number
  signal?: AbortSignal
  /**
   * 함께 보낼 미디어. 없으면 예전과 완전히 같은 요청이 나간다.
   */
  parts?: GeminiPart[]
  /**
   * API 버전. 원격 미디어(fileData)는 v1beta가 404로 거절하므로 v1alpha가 필요하다.
   * (실측 2026-08-18: v1beta + fileData → HTTP 404 빈 본문 / v1alpha → 200 + VIDEO 4,997토큰)
   * 지정하지 않으면 예전 그대로 v1beta로 나간다.
   */
  apiVersion?: 'v1beta' | 'v1alpha'
  /** 영상은 오래 걸린다. 지정하지 않으면 기존 60초. */
  timeoutMs?: number
  /**
   * 출력 토큰 상한. 대사 전문 + 자막 수십 줄을 받으면 기본값에서 **잘려서 JSON이 깨진다**
   * (실측 2026-08-18: 21건 중 1건이 그렇게 실패). 지정하지 않으면 모델 기본값 그대로다.
   */
  maxOutputTokens?: number
  /**
   * 모델이 답하기 전에 **얼마나 오래 생각할지**.
   *
   * 왜 필요한가(실측 2026-08-31): 어시스턴트의 명령 해석은 목록에서 하나 고르는 일인데,
   * 기본 설정의 `gemini-3-flash-preview` 는 생각에 1,295토큰을 써서 **7.5초**가 걸렸고
   * 같은 프롬프트가 한 번은 **60초를 채우고 죽었다**. 사용자는 그 사이 빈 화면을 본다.
   * `low` 로 내리면 같은 답을 **4.7초**에 준다 — 고를 항목이 12개뿐인 일에
   * 오래 생각해서 얻는 것이 없다.
   *
   * 반대로 영상 이해·크리에이티브 분석처럼 **판단이 어려운 일에는 주지 않는다.**
   * 지정하지 않으면 모델 기본값 그대로라 기존 호출은 한 글자도 안 바뀐다.
   */
  thinkingLevel?: 'low' | 'high'
}

export async function callGemini(input: CallInput): Promise<GeminiResult> {
  if (!input.apiKey) return { ok: false, error: 'AI 키가 설정되지 않았습니다' }

  /*
    부르는 법은 그대로 두고 **나가는 자리만** 관문으로 옮긴다.
    이 함수는 예외를 안 던지는 것이 계약이라(호출자가 폴백을 고른다)
    관문이 던지는 것을 여기서 받아 예전과 같은 말로 바꾼다.
  */
  const parts: GatePart[] = [{ text: input.prompt }]
  for (const p of input.parts ?? []) parts.push(toApiPart(p))

  try {
    const out = await guardedGeminiParts({
      parts,
      apiKey: input.apiKey, model: input.model,
      surface: 'ci-gemini', purpose: '콘텐츠 분석',
      // 이 길은 산문도 받는다 — JSON 을 강제하면 예전 응답 모양이 바뀐다
      json: false,
      temperature: input.temperature ?? 0.4,
      timeoutMs: input.timeoutMs ?? TIMEOUT_MS,
      apiVersion: input.apiVersion,
      extraConfig: {
        ...(input.maxOutputTokens ? { maxOutputTokens: input.maxOutputTokens } : {}),
        // 생각 수준을 지정한 호출만 실어 보낸다 — 안 주면 요청 본문이 예전과 한 글자도 같다
        ...(input.thinkingLevel ? { thinkingConfig: { thinkingLevel: input.thinkingLevel } } : {}),
      },
    })

    if (!out.text.trim()) return { ok: false, error: 'AI가 빈 응답을 돌려주었습니다' }

    // 길이 상한에 걸려 잘린 응답은 JSON이 깨진 채로 온다.
    // "형식이 이상하다"가 아니라 "길어서 잘렸다"라고 말해야 상한을 올릴 수 있다.
    if (out.finishReason === 'MAX_TOKENS') {
      return { ok: false, error: 'AI 응답이 길이 상한에 걸려 잘렸습니다' }
    }

    return {
      ok: true, text: out.text,
      promptTokens: out.inputTokens, outputTokens: out.outputTokens,
    }
  } catch (e) {
    if (e instanceof GeminiCallError) {
      return { ok: false, error: `AI 응답 실패 (${e.status})` }
    }
    const msg = e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError')
      ? 'AI 응답이 시간 안에 오지 않았습니다'
      : 'AI를 호출하지 못했습니다'
    return { ok: false, error: msg }
  }
}
