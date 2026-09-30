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
  /**
   * 이 녹음을 켠 사람. 배경 일꾼이 돌려도 그 회의의 주인은 있다.
   *
   * 선택이 아니라 필수인 이유: 실측 2026-09-20 원장 50,243건이 전부 주인이 비어 있었다.
   * 선택으로 두면 «이 호출부는 다음에» 가 남고, 그 다음은 안 온다.
   */
  actorId: string | null
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
  /**
   * 업체가 **힌트를 문제 삼았나.** 힌트는 빼면 되는 것이라 이 한 가지만 따로 센다 —
   * 재시도 여부(`retryable`)와는 다른 질문이다. 이건 「같은 것을 다시」가 아니라
   * 「덜어 내고 다시」다.
   */
  readonly promptRejected: boolean

  constructor(
    reason: SttFailureReason,
    userMessage: string,
    retryable: boolean,
    promptRejected = false,
  ) {
    super(`${reason}: ${userMessage}`)
    this.name = 'SttError'
    this.reason = reason
    this.userMessage = userMessage
    this.retryable = retryable
    this.promptRejected = promptRejected
  }
}

/** 한 구간 전사가 매달릴 수 있는 최대 시간. 10분 오디오는 실측 수 초라 넉넉한 값이다. */
export const STT_TIMEOUT_MS = 120_000

/** 정확도 우선. turbo 는 빠르지만 1~2%p 손해라 기본으로 쓰지 않는다. */
import { guardedMedia, type AiLedger } from '../ai/guarded-call.ts'
import { serverAiLedger } from '../ai/ledger.ts'
import { serverKnownNames } from '../ai/known-names.ts'
import { withProviderKeys, type KeyRotationDeps } from '../ai/key-rotation.ts'
import { isAiProviderId } from '../ai/provider-catalog.ts'

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
/**
 * 업체가 받아 주는 힌트(prompt) 상한.
 *
 * Whisper 계열은 224 토큰까지이고 업체는 그것을 **896자**로 환산해 거절한다
 * (실측 원문: `prompt length must be 896 characters or fewer`).
 * 여유를 두고 자른다 — 자르는 것이 첫 겹이고, 그래도 거절당하면 **빼고 다시 보내는 것**이 둘째 겹이다.
 */
export const MAX_PROMPT_CHARS = 880

/**
 * 이 400 이 **힌트 탓인가.**
 *
 * 아무 400 이나 힌트 탓으로 돌리면, 형식이 틀린 파일을 두 번 보내게 된다.
 * 반대로 안 가리면 힌트 하나 때문에 10분치 소리를 버린다 — 2026-09-30 에 실제로 그랬다.
 */
export function isPromptRejection(status: number, body: string): boolean {
  return status === 400 && /prompt/i.test(body)
}

/** 보낸 힌트의 사정 — 사유에 길이를 남겨야 다음 실패가 스스로 원인을 말한다 */
export interface PromptTrace {
  chars: number
  sent: boolean
}

export function classifyHttpFailure(status: number, body: string, prompt?: PromptTrace): SttError {
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
  /*
    사유에 **힌트 길이**를 적는다. 2026-09-30 의 실패는 업체가 「936자를 보냈다」고 말해 줬는데
    우리 쪽 사유에는 그 숫자가 없어서, 어디서 936 이 나왔는지를 코드만 보고는 못 맞췄다.
    몸통은 120자까지만 싣는다 — 응답 원문을 통째로 남기면 내부 구조가 그대로 따라 나온다.
  */
  const hint = !prompt || prompt.chars === 0
    ? ''
    : prompt.sent
      ? ` (힌트 ${prompt.chars}자)`
      : ` (힌트 ${prompt.chars}자를 빼고도 실패)`
  return new SttError(
    'server',
    `음성 인식에 실패했습니다 (${status}).${hint} ${body.slice(0, 120)}`,
    false,
    isPromptRejection(status, body),
  )
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
  /** 안 주면 서버 원장. 녹음이 밖으로 나간 사실은 어느 길로 가도 남는다 */
  ledger?: AiLedger
  /**
   * 이 업체에 등록된 키 여러 개. 안 주면 표에서 읽는다.
   *
   * 회의 녹음은 **구간을 이어서** 보낸다. 중간에 키가 마르면 그 회의만 반쯤 전사된
   * 상태로 남고, 사용자는 뒷부분이 왜 비었는지 알 수 없다 — 그래서 여기가 특히 필요하다.
   */
  keys?: KeyRotationDeps
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

      /**
       * 요청 몸통을 **시도마다 새로 만든다.**
       *
       * 둘 다를 위해서다 — 힌트를 뺀 판을 보내려면 다른 몸통이 필요하고,
       * 키를 갈아 가며 보낼 때 한 번 쓴 몸통을 다시 쓰면 스트림이 이미 소비돼 있다.
       */
      const promptChars = input.priorContext
        ? Math.min(input.priorContext.length, MAX_PROMPT_CHARS)
        : 0
      const buildForm = (withPrompt: boolean): FormData => {
        const form = new FormData()
        form.append('file', new Blob([new Uint8Array(input.bytes)], { type: input.mimeType }), input.filename)
        form.append('model', opts.model)
        form.append('response_format', 'verbose_json')
        if (input.language) form.append('language', input.language)
        // 앞 구간의 끝을 문맥으로 준다 — 고유명사·회사명이 구간 경계에서 흔들리는 걸 줄인다.
        // **있으면 좋은 것이지 필요한 것이 아니다.** 거절당하면 이것부터 버린다
        if (withPrompt && input.priorContext) {
          form.append('prompt', input.priorContext.slice(0, MAX_PROMPT_CHARS))
        }
        return form
      }

      /*
        녹음은 **소리**라 글자 가림이 애초에 안 닿는다. 가린 척하지 않고
        나간 사실과 크기와 매체를 원장에 남긴다 — 회의 녹음이 어느 업체로
        언제 나갔는지는 사고가 났을 때 가장 먼저 묻는 것이다.

        돌아온 전사에는 사람 이름이 그대로 실려 온다. 그것을 **지우지는 않는다** —
        말한 사람 이름을 지우면 회의록이 못 읽을 것이 된다. 몇 개였는지만 센다.
      */
      /*
        **키를 바꿔 가며 부른다.** 한도(429)와 인증(401)은 그 키의 문제라 다음 키로 같은
        녹음을 다시 보내면 된다. 그 밖의 실패는 키를 바꿔도 같으니 그대로 올린다.

        원장은 **시도마다** 남는다 — 429 를 맞았어도 녹음은 이미 그 업체로 나갔다.
        한 번만 남기면 「어디로 몇 번 나갔나」가 실제와 달라진다.

        이 업체가 등록된 공급자가 아니면(예: 나중에 붙는 다른 전사 업체) 키 교체 없이
        한 번만 부른다 — 표에 그 공급자 칸이 없으니 고를 것도 없다.
        분류는 우리가 이미 SttError 로 해 두었으므로 문구로 되돌려 추측하게 하지 않는다.
      */
      const providerId = isAiProviderId(opts.vendor) ? opts.vendor : null
      const send = async (apiKey: string, keyRef: string | null, withPrompt: boolean): Promise<SttResult> => {
      const out = await guardedMedia(
        input.bytes.byteLength,
        {
          surface: 'meeting/stt', purpose: 'transcribe', media: 'audio',
          actorId: input.actorId,
          providerId: opts.vendor, modelName: opts.model,
          // 어느 키로 나갔는지 남긴다 — 이름이지 원문이 아니다
          keyRef,
          knownNames: await serverKnownNames(),
        },
        opts.ledger ?? serverAiLedger(),
        async () => {
          const ctl = new AbortController()
          const timer = setTimeout(() => ctl.abort(), STT_TIMEOUT_MS)
          let res: Response
          try {
            res = await fetch(opts.endpoint, {
              method: 'POST',
              headers: { Authorization: `Bearer ${apiKey}` },
              body: buildForm(withPrompt),
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
            throw classifyHttpFailure(res.status, await res.text().catch(() => ''), {
              chars: promptChars, sent: withPrompt,
            })
          }
          // 관문은 글자를 기다리지만 우리가 쓸 것은 구간이다 — 원문을 같이 들고 나간다
          const raw = await res.json()
          return { text: JSON.stringify(raw), raw }
        },
      )

      const segments = mapVerboseJson(JSON.parse(out.text))
      if (segments.length === 0) {
        // 소리가 거의 없을 때다. 지어내지 않고 사실대로 말한다.
        throw new SttError('empty', '이 구간에서 말소리를 찾지 못했습니다. 마이크가 꺼져 있었을 수 있어요.', false)
      }
      return { segments, model: opts.model }
      }

      /**
       * **힌트가 거절당하면 힌트를 빼고 다시 보낸다.**
       *
       * 실측 2026-09-30: 52분 회의의 한 구간이 `prompt length must be 896 characters or fewer`
       * 400 으로 통째로 버려졌다. 힌트는 고유명사를 덜 흔들리게 하려고 얹는 것이지
       * 전사에 필요한 것이 아니다. **있으면 좋은 것 때문에 본문을 잃지 않는다.**
       *
       * 힌트를 안 보냈으면 뺄 것이 없으니 다시 보내지 않는다 —
       * 그러면 같은 실패를 두 배로 치를 뿐이다.
       */
      const runOnce = async (apiKey: string, keyRef: string | null): Promise<SttResult> => {
        try {
          return await send(apiKey, keyRef, true)
        } catch (e) {
          const hintCouldBeTheCause = promptChars > 0
            && e instanceof SttError
            && e.promptRejected
          if (!hintCouldBeTheCause) throw e
          return send(apiKey, keyRef, false)
        }
      }

      if (!providerId) return runOnce(opts.apiKey, null)
      return withProviderKeys(providerId, opts.apiKey, (apiKey, entry) => runOnce(apiKey, entry.label), {
        ...opts.keys,
        outcomeOf: (e) => (e instanceof SttError && (e.reason === 'quota' || e.reason === 'auth') ? e.reason : 'transient'),
      })
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
