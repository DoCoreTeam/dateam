import { UNSPLIT_SPEAKER } from '../meeting/speaker-split.ts'
/**
 * 음성 인식(STT) 프로바이더 — 오픈소스 모델을 서버리스로 (사용자 결정 D1·D7)
 *
 * **왜 GPU 를 안 사는가** (D7 원문: "왠 GPU가 필요해 녹음 자체는 그냥 녹음이니깐")
 * 오픈소스 모델을 쓰는 것과 그 모델을 우리가 돌리는 것은 다른 결정이다.
 * 서버리스 프로바이더는 같은 오픈소스 가중치를 남의 GPU 에서 돌려 준다 —
 * 우리는 살 것도 운영할 것도 없고, 1시간 오디오가 약 15초에 끝난다.
 *
 * **왜 whisper-large-v3 인가** (D1 원문: "이거 좀 매우 정확한 오픈소스 모델")
 * 2026 Open ASR 리더보드 상위권은 전부 영어 벤치마크이고 다국어 폭이 좁다
 * (Canary-Qwen 영어 전용 · Granite 6개 언어 · Parakeet 25개 유럽어).
 * 한국어를 명시적으로 지원하면서 런타임 생태계가 갖춰진 것은 whisper-large-v3(99개 언어, MIT)다.
 * `turbo` 는 6배 빠르지만 정확도가 1~2%p 떨어져 쓰지 않는다 — 정확도를 요구받았다.
 *
 * **왜 브라우저에서 안 하는가**: 브라우저에 올릴 수 있는 모델은 작아 정확도가 떨어지고,
 * 무엇보다 **탭을 닫는 순간 남은 구간이 영원히 전사되지 않는다.**
 * "자리를 떠도 끝나 있다"가 이 기능의 핵심 가치다.
 *
 * 프로바이더를 바꾸고 싶으면 이 파일에 함수 하나를 더한다. 호출부는 인터페이스만 안다 —
 * 사내 whisper.cpp 로 옮기는 것도 같은 방식이다.
 */

/** 전사 한 줄 */
export interface SttSegment {
  /** 구간 안에서의 시작 시각(ms). 전체 시간축 오프셋은 호출부가 더한다 */
  startMs: number
  endMs: number
  speaker: string
  text: string
}

export interface SttResult {
  segments: SttSegment[]
  /** 실제로 쓴 모델 — 기록에 남겨야 나중에 "왜 이 결과가 나왔는지"를 설명할 수 있다 */
  model: string
}

export interface SttInput {
  bytes: Buffer
  mimeType: string
  filename: string
  /** 언어 힌트. 한국어 회의는 'ko' 를 준다 — 자동 감지에 맡기면 짧은 구간에서 영어로 튄다 */
  language?: string
  /**
   * 앞 구간의 마지막 몇 줄. 모델에 문맥으로 준다.
   * 안 주면 구간마다 화자 이름이 새로 시작해 "화자1"이 매번 다른 사람이 된다.
   */
  priorContext?: string
}

export interface SttProvider {
  readonly vendor: string
  readonly model: string
  transcribe(input: SttInput): Promise<SttResult>
}

/** 실패를 조용히 넘기지 않는다 — 사용자가 읽을 말과 원인을 함께 갖는다 */
export type SttFailureReason = 'auth' | 'quota' | 'too_large' | 'timeout' | 'network' | 'server' | 'empty'

export class SttError extends Error {
  readonly reason: SttFailureReason
  readonly userMessage: string
  /** 다시 시도해서 풀릴 종류인가 — 아니면 재시도가 그냥 같은 실패를 반복한다 */
  readonly retryable: boolean

  constructor(reason: SttFailureReason, userMessage: string, retryable: boolean) {
    super(`${reason}: ${userMessage}`)
    this.name = 'SttError'
    this.reason = reason
    this.userMessage = userMessage
    this.retryable = retryable
  }
}

/** 한 구간 전사가 매달릴 수 있는 최대 시간. 10분 오디오는 실측 수 초라 넉넉한 값이다. */
export const STT_TIMEOUT_MS = 120_000

/** 정확도 우선. turbo 는 빠르지만 1~2%p 손해라 기본으로 쓰지 않는다. */
export const DEFAULT_STT_MODEL = 'whisper-large-v3'

/** 설정에 없을 때 쓰는 프로바이더 */
export const DEFAULT_STT_PROVIDER = 'groq'

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions'

/** 프로바이더가 받아 주는 한 요청의 상한. 우리 구간은 2~3MB라 여유가 있다. */
export const MAX_STT_BYTES = 24 * 1024 * 1024

interface VerboseJson {
  text?: string
  segments?: { start?: number; end?: number; text?: string }[]
}

/**
 * 응답을 우리 세그먼트로 옮긴다.
 *
 * 순수 함수로 뺀 이유: 프로바이더 응답이 조금씩 다르고, 여기가 틀리면
 * **전사는 됐는데 화면이 비는** 상태가 된다. 그건 실브라우저에서 원인을 못 찾는다.
 *
 * **여기서는 화자를 안 나눈다.** 지어내지 않고 `UNSPLIT_SPEAKER` 로 두고,
 * 나중에 `lib/meeting/speaker-split.ts` 가 말차례로 나누거나 사람이 이름을 지정한다 —
 * 목소리로 사람을 특정해 틀리면 잘못된 참석자가 CRM 에 들어간다.
 * (whisper-large-v3 는 화자 분리를 주지 않는다. 이건 «못 하는 것»이지 «안 한 것»이 아니다.)
 */
export function mapVerboseJson(raw: unknown): SttSegment[] {
  const body = (raw ?? {}) as VerboseJson
  const rows = Array.isArray(body.segments) ? body.segments : []

  const out: SttSegment[] = []
  for (const r of rows) {
    const text = (r.text ?? '').trim()
    if (!text) continue
    const startMs = Math.max(0, Math.round((r.start ?? 0) * 1000))
    // DB 가 end > start 를 요구한다(마이그 217). 같거나 뒤집힌 값이 오면 1ms 를 준다 —
    // 여기서 막지 않으면 저장 단계에서 구간 전체가 통째로 실패한다.
    const rawEnd = Math.round((r.end ?? 0) * 1000)
    const endMs = rawEnd > startMs ? rawEnd : startMs + 1
    out.push({ startMs, endMs, speaker: UNSPLIT_SPEAKER, text })
  }

  // segments 가 아예 없고 text 만 온 경우 — 통짜로라도 살린다. 버리면 회의가 통째로 사라진다.
  if (out.length === 0) {
    const whole = (body.text ?? '').trim()
    if (whole) out.push({ startMs: 0, endMs: 1, speaker: UNSPLIT_SPEAKER, text: whole })
  }
  return out
}

/** HTTP 상태를 사람이 읽을 실패로 옮긴다 — "다시 시도"가 100% 또 실패할 것은 그렇게 말하지 않는다 */
export function classifyHttpFailure(status: number, body: string): SttError {
  if (status === 401 || status === 403) {
    return new SttError('auth', '음성 인식 키가 올바르지 않습니다. 시스템 설정 → 통합에서 확인해 주세요.', false)
  }
  if (status === 413) {
    return new SttError('too_large', '녹음 구간이 너무 큽니다. 더 짧게 나눠 주세요.', false)
  }
  if (status === 429) {
    return new SttError('quota', '음성 인식 사용량 한도에 걸렸습니다. 잠시 후 자동으로 다시 시도합니다.', true)
  }
  if (status >= 500) {
    return new SttError('server', '음성 인식 서비스가 응답하지 않습니다. 잠시 후 자동으로 다시 시도합니다.', true)
  }
  return new SttError('server', `음성 인식에 실패했습니다 (${status}). ${body.slice(0, 120)}`, false)
}

/**
 * OpenAI 호환 전사 API 로 오픈소스 Whisper 를 부른다.
 *
 * 엔드포인트 모양이 같은 프로바이더가 여럿이라 하나로 쓴다 —
 * 프로바이더를 바꿔도 여기 URL 과 모델명만 달라진다.
 */
export function openAiCompatibleStt(opts: {
  vendor: string
  endpoint: string
  apiKey: string
  model: string
}): SttProvider {
  return {
    vendor: opts.vendor,
    model: opts.model,
    async transcribe(input: SttInput): Promise<SttResult> {
      if (input.bytes.byteLength === 0) {
        throw new SttError('empty', '녹음 파일이 비어 있습니다.', false)
      }
      if (input.bytes.byteLength > MAX_STT_BYTES) {
        throw new SttError('too_large', '녹음 구간이 너무 큽니다. 더 짧게 나눠 주세요.', false)
      }

      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename)
      form.append('model', opts.model)
      form.append('response_format', 'verbose_json')
      if (input.language) form.append('language', input.language)
      // 앞 구간의 끝을 문맥으로 준다 — 고유명사·회사명이 구간 경계에서 흔들리는 걸 줄인다
      if (input.priorContext) form.append('prompt', input.priorContext.slice(0, 800))

      const ctl = new AbortController()
      const timer = setTimeout(() => ctl.abort(), STT_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(opts.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: ctl.signal,
        })
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          throw new SttError('timeout', '음성 인식이 너무 오래 걸려 중단했습니다. 잠시 후 다시 시도합니다.', true)
        }
        throw new SttError('network', '음성 인식 서비스에 연결하지 못했습니다.', true)
      } finally {
        clearTimeout(timer)
      }

      if (!res.ok) {
        throw classifyHttpFailure(res.status, await res.text().catch(() => ''))
      }

      const segments = mapVerboseJson(await res.json())
      if (segments.length === 0) {
        // 소리가 거의 없을 때다. 지어내지 않고 사실대로 말한다.
        throw new SttError('empty', '이 구간에서 말소리를 찾지 못했습니다. 마이크가 꺼져 있었을 수 있어요.', false)
      }
      return { segments, model: opts.model }
    },
  }
}

export interface SttSettings {
  provider: string
  apiKey: string
  model: string
}

/**
 * 호스트 시스템 설정(org_content META)에서 STT 설정을 읽는다.
 *
 * **CRM 은 키를 갖지 않는다**는 기존 원칙과 같은 자리다 — Gemini·Claude·OpenAI 키가
 * 이미 거기 있고, 회의노트(사내)와 CRM 이 같은 키를 쓴다.
 * 키가 없으면 조용히 넘어가지 않는다. 넘어가면 "녹음은 되는데 전사가 영영 안 되는" 상태가 된다.
 */
export function readSttSettings(meta: Record<string, unknown>): SttSettings | null {
  const apiKey = typeof meta.stt_api_key === 'string' ? meta.stt_api_key.trim() : ''
  if (!apiKey) return null
  const provider = (typeof meta.stt_provider === 'string' && meta.stt_provider.trim()) || DEFAULT_STT_PROVIDER
  const model = (typeof meta.stt_model === 'string' && meta.stt_model.trim()) || DEFAULT_STT_MODEL
  return { provider, apiKey, model }
}

/**
 * 설정이 가리키는 프로바이더를 만든다.
 *
 * 안 붙은 프로바이더를 고르면 **조용히 다른 것으로 돌지 않고 사실을 말한다** —
 * 조용히 넘어가면 사용자는 자기가 고른 것으로 돌아갔다고 믿는다.
 */
export function sttProviderFor(settings: SttSettings): SttProvider {
  const v = settings.provider.trim().toLowerCase()
  if (v === 'groq') {
    return openAiCompatibleStt({
      vendor: 'groq', endpoint: GROQ_ENDPOINT, apiKey: settings.apiKey, model: settings.model,
    })
  }
  throw new SttError(
    'server',
    `음성 인식 업체(${settings.provider})가 아직 연결되지 않았습니다. 시스템 설정에서 다시 골라 주세요.`,
    false,
  )
}
