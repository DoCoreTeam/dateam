/**
 * 호스트 AI 어댑터 — 이미 있는 키를 그대로 쓴다 (dacrm 정정판)
 *
 * **왜 이 파일이 생겼나**: CRM 이 자기 API 키를 따로 받게 만들어 놨었다.
 * 그런데 호스트에는 이미 Gemini·Claude·OpenAI 키가 등록돼 있고
 * (시스템 설정 → 통합, `org_content` META 의 `gemini_api_key` 등),
 * AI 채팅·GPU 추출·회의록이 전부 그 키로 돌고 있다.
 *
 * 같은 키를 두 곳에서 받으면 사용자는 같은 값을 두 번 넣어야 하고,
 * 한쪽만 바꾸면 CRM 만 조용히 옛 키로 돈다. 그게 이 저장소가 금지한
 * "같은 처리를 새로 짜지 말고 단일 구현을 import 한다"(재사용·단일구현 정책)의 정확한 사례다.
 *
 * 그래서 CRM 은 **키를 갖지 않는다.** 호스트 레지스트리(`lib/ai-chat/registry`)에
 * 어떤 프로바이더가 살아 있는지 묻고, 그 프로바이더로 호출한다.
 * 모델을 고르고 싶으면 CRM 설정의 `ai.model.extract` 에 프로바이더 이름을 적는다 —
 * 키가 아니라 **어느 것을 쓸지**만 CRM 의 결정이다.
 */

import type { AiAdapter, AiSource } from '../runner.ts'
import { getAvailableProviders, getProviderConfig, getDefaultProvider } from '../../../ai-chat/registry.ts'
import type { ProviderId, AttachmentInput } from '../../../ai-chat/provider.ts'
import { isAiProviderId } from '../../../ai/provider-catalog.ts'
import { CrmError } from '../../domain/errors.ts'
import { classifyProviderError } from '../../../ai-chat/provider-errors.ts'
import { streamChatWithKeys } from '../../../ai-chat/stream-with-keys.ts'
import {
  buildModelChain, pruneChain, meetsRequirements,
  type ChainCandidate, type ChainCatalogEntry, type ChainRequirements,
} from '../../../ai-chat/model-chain.ts'

/** 사람이 기다릴 수 있는 한계. 넘으면 실패로 말한다 — 무한정 도는 건 실패보다 나쁘다 */
const TIMEOUT_MS = 60_000

/**
 * 웹 검색을 켜면 모델이 실제로 페이지를 읽고 오므로 더 걸린다.
 * 같은 60초를 쓰면 **검색이 되던 것도 시간 초과로 실패한다** — 기다리는 이유가 다르면 한계도 달라야 한다.
 */
const WEB_SEARCH_TIMEOUT_MS = 90_000

/** 호스트 META 를 읽어 오는 함수 — 서버에서 주입한다(이 파일은 DB 를 모른다) */
export type MetaReader = () => Promise<Record<string, unknown>>

/**
 * 모델 카탈로그를 읽어 오는 함수 — 마찬가지로 주입한다.
 *
 * **안 주면 빈 목록이다.** 그래도 공급자를 넘는 것은 그대로 동작한다(설정 모델끼리 넘어간다).
 * 카탈로그가 있으면 죽은 모델을 빼고 한도에 걸렸던 것을 뒤로 미는 것까지 된다.
 */
export type CatalogReader = () => Promise<ChainCatalogEntry[]>

// 허용 목록을 여기 또 적지 않는다 — 명세(lib/ai/provider-catalog)가 원본이다.
// 예전엔 세 개가 손으로 적혀 있어서, 호스트에 Groq 을 등록해도 CRM 만 그것을 몰랐다.
function isProviderId(v: string): v is ProviderId {
  return isAiProviderId(v)
}

/**
 * 설정값을 프로바이더로 해석한다.
 *
 * - `'auto'`(또는 빈 값): 호스트가 기본으로 쓰는 프로바이더를 따른다.
 *   CRM 만 다른 모델로 도는 상황을 만들지 않는 게 기본값이어야 한다.
 * - `'gemini' | 'claude' | 'openai'`: 그것으로 고정한다.
 * - 그 밖의 값: **조용히 넘어가지 않는다.** 오타를 mock 으로 흘리면
 *   "AI 가 왜 이래?"를 아무도 설명하지 못한다.
 */
export function resolveProvider(
  meta: Record<string, unknown>,
  setting: string | null | undefined,
): ProviderId {
  const want = (setting ?? '').trim().toLowerCase()
  const available = getAvailableProviders(meta).map((p) => p.id)

  if (available.length === 0) {
    throw new CrmError('VALIDATION_FAILED',
      'AI 키가 아직 등록되지 않았습니다. 시스템 설정 → 통합에서 Gemini·Claude·OpenAI 중 하나를 등록해 주세요.')
  }

  if (!want || want === 'auto') {
    const def = getDefaultProvider(meta)
    if (!def) {
      throw new CrmError('VALIDATION_FAILED',
        'AI 키가 아직 등록되지 않았습니다. 시스템 설정 → 통합에서 등록해 주세요.')
    }
    return def.id
  }

  if (!isProviderId(want)) {
    throw new CrmError('VALIDATION_FAILED',
      `설정된 AI(${setting})를 모르겠습니다. gemini · claude · openai · auto · mock 중에서 골라 주세요.`)
  }

  if (!available.includes(want)) {
    throw new CrmError('VALIDATION_FAILED',
      `${want} 키가 시스템 설정에 없습니다. 시스템 설정 → 통합에서 등록하거나 다른 AI를 골라 주세요.`)
  }

  return want
}

export interface HostAdapterOptions {
  /**
   * 이 붙임쇠를 만든 실행의 주인. 배경 잡이면 null 이고 그때도 적는다.
   *
   * 붙임쇠는 한 번 만들어 여러 번 부를 수 있지만, 한 번의 실행에 한 번 만들어 쓰므로
   * 여기 실린 주인이 그 실행의 주인이다.
   */
  actorId?: string | null
  /**
   * 모델이 **인터넷을 보게 한다**(Gemini google_search · Claude web_search).
   *
   * 켜지 않으면 모델은 학습 시점의 기억으로만 답한다. 회사 정보처럼
   * "지금 웹에 있는 사실"을 물을 때 기억으로 답하면 그럴듯한 거짓이 들어온다.
   */
  webSearch?: boolean
  /**
   * 모델에게 **그림째 보여 줄** 파일.
   *
   * 스캔한 견적서·표를 캡처한 이미지처럼 «글자 레이어가 없는 문서»가 있다.
   * 파서는 그런 파일을 «빈 문서를 성공으로» 돌려주므로, 텍스트만 보내면
   * 모델은 빈 문서를 읽고 「항목이 없다」고 답한다.
   *
   * 첨부를 모델 형식으로 바꾸는 일은 호스트 첨부 계층(`lib/ai-chat/attachments`)이
   * 이미 한다 — CRM 이 프로바이더별 변환을 다시 짜지 않는다(재사용·단일구현 정책).
   */
  attachments?: AttachmentInput[]
}

/**
 * 호스트 프로바이더로 CRM 어댑터를 만든다.
 *
 * 토큰 수는 프로바이더가 돌려주는 값을 그대로 쓴다 — 우리가 추정하면
 * 예산(§3.6)이 실제 비용과 어긋나고, 어긋난 예산은 안 지켜진다.
 */
export async function hostAdapter(
  readMeta: MetaReader,
  setting: string | null | undefined,
  opts: HostAdapterOptions = {},
  readCatalog: CatalogReader = async () => [],
): Promise<AiAdapter> {
  const meta = await readMeta()
  const id = resolveProvider(meta, setting)
  const cfg = getProviderConfig(meta, id)
  if (!cfg) {
    throw new CrmError('VALIDATION_FAILED',
      `${id} 설정이 완전하지 않습니다. 시스템 설정 → 통합에서 모델까지 지정해 주세요.`)
  }

  // 프로바이더 구현은 호스트 것을 그대로 쓴다 — CRM 이 HTTP 호출을 다시 짜지 않는다
  const { getProvider, getAvailableProviders } = await import('../../../ai-chat/registry.ts')
  const provider = getProvider(id)

  const webSearch = opts.webSearch === true

  /**
   * 검색을 못 하는 프로바이더면 **조용히 넘어가지 않는다.**
   *
   * 그냥 진행하면 모델은 기억으로 답하고 출처는 비고, 화면에는 "AI 가 찾았다"고 뜬다.
   * 사용자는 검색해서 확인한 값이라고 믿는다 — 실패보다 나쁜 결과다.
   */

  const attachments = opts.attachments ?? []

  /**
   * 그림을 못 보는 프로바이더면 **조용히 넘어가지 않는다.**
   *
   * 첨부를 빼고 텍스트만 보내면 모델은 빈 문서를 읽고 「항목이 없다」고 답한다.
   * 화면에는 「읽었는데 항목이 없다」로 뜨고, 사용자는 자기 견적서가 잘못된 줄 안다.
   * 웹 검색과 같은 이유로 여기서 막는다.
   */

  /**
   * 시도할 후보 순서 — **공급자를 넘는다.**
   *
   * ## 왜 모델만 바꿔서는 안 되나 (실측 2026-09-19)
   *
   * 예전 판은 Gemini 모델만 담긴 사슬을 스스로 만들고, 429 를 「다른 모델을 시도하라」로
   * 읽었다. 그런데 무료 티어 한도는 **키 단위로 함께 바닥난다** — 그래서 Gemini 모델 다섯을
   * 차례로 때려 429 를 다섯 번 맞고 포기했다. 그 순간 OpenAI 키는 등록돼 있었고 멀쩡했다.
   *
   * 그 판단은 이미 SSOT 가 있다. `provider-errors.ts` 가 실패를 `scope` 로 나누고
   * (429 는 `key` — 이 키로는 어느 모델도 못 부른다), `model-chain.ts` 가 그 scope 로
   * 공급자를 통째로 건너뛴다. AI 채팅과 심층분석이 이미 그것을 탄다.
   * **CRM 만 자기 사슬을 갖고 있었다.** 이제 같은 것을 쓴다.
   *
   * ## 능력을 못 채우는 후보는 뺀다
   *
   * 첨부가 있으면 그림을 읽는 공급자만, 웹 검색이면 도구를 쓰는 공급자만 남는다.
   * `buildModelChain` 은 «관리자가 고른 것»(1단계)만은 능력과 무관하게 넣으므로
   * 여기서 한 번 더 거른다 — 못 보는 모델에 그림을 보내 봐야 400 이다.
   */
  const requires: ChainRequirements = { vision: attachments.length > 0, tools: webSearch }
  const available = getAvailableProviders(meta)
  const capabilities = Object.fromEntries(
    available.map((p) => [p.id, getProvider(p.id).capabilities]),
  ) as Parameters<typeof buildModelChain>[0]['capabilities']

  const chain = buildModelChain({
    chosen: { provider: id, model: cfg.model },
    providers: available,
    catalog: await readCatalog(),
    capabilities,
    requires,
  }).filter((c) => meetsRequirements(capabilities[c.provider], requires))

  /**
   * 후보가 하나도 없으면 **조용히 끝내지 않는다.**
   *
   * 무엇이 모자란지 말해야 관리자가 고칠 수 있다 — 「AI 응답 실패」로는 키를 넣어야 하는지
   * 모델을 바꿔야 하는지 알 수 없다.
   */
  if (chain.length === 0) {
    throw new CrmError('VALIDATION_FAILED', requires.vision
      ? '그림을 읽을 수 있는 AI 모델이 없습니다. 시스템 설정 → 통합에서 키와 모델을 확인해 주세요.'
      : requires.tools
        ? '웹 검색을 할 수 있는 AI 모델이 없습니다. 시스템 설정 → 통합에서 키와 모델을 확인해 주세요.'
        : '지금 쓸 수 있는 AI 모델이 없습니다. 시스템 설정 → 통합에서 키와 모델을 확인해 주세요.')
  }

  return {
    model: cfg.model,
    webSearch,
    /*
      첨부가 있으면 **매체 갈래**다 — 글자 가림이 그림 안에는 안 닿는다.
      pdf 도 그림으로 본다: 안에 든 글자를 우리가 가릴 방법이 없다는 점에서 같다.
      크기는 base64 가 아니라 **원본 바이트**로 센다(원장이 실제로 나간 양을 말해야 한다).
    */
    media: attachments.length > 0
      ? {
        kind: 'image' as const,
        bytes: attachments.reduce((n, a) => n + Math.floor(a.dataBase64.length * 3 / 4), 0),
      }
      : undefined,
    async complete(prompt: string) {
      /**
       * 호스트 프로바이더는 스트리밍 계약이다(화면이 글자를 흘려 보여 주려고).
       * CRM 추출은 JSON 한 덩이가 필요하니 끝까지 모아 한 번에 돌려준다 —
       * 부분 JSON 은 파싱이 안 되고, 파싱 실패는 러너가 "이해하지 못했다"로 오해한다.
       */
      // 출처는 스트림 도중에 온다. 끝나고 한 번에 오지 않으므로 흘러올 때 모은다.
      const sources: AiSource[] = []
      const seen = new Set<string>()
      /** 실제로 답한 후보. 고른 것과 다를 수 있고, 그 사실이 기록과 화면에 남아야 한다 */
      let used: ChainCandidate | null = null

      /**
       * 후보를 순서대로 밟되, **실패한 이유에 따라 남은 후보를 쳐낸다.**
       *
       * 429 는 `scope: 'provider'` 다 — 그 키로는 뭘 해도 안 되므로 그 공급자의 남은 모델을
       * 전부 뺀다. 이걸 안 하면 「429를 맞고 같은 공급자의 다음 모델로 넘어가 또 429」가 되고,
       * 그동안 사용자는 다섯 배 오래 기다린 뒤 똑같은 실패를 본다(실측 2026-09-19).
       *
       * 쳐내는 규칙은 `pruneChain` 한 곳이고, 분류는 `classifyProviderError` 한 곳이다.
       * 두 곳에서 분류하면 그 어긋남이 조용히 산다.
       */
      let rest: ChainCandidate[] = chain
      let res: Awaited<ReturnType<typeof provider.streamChat>> | null = null
      let lastError: unknown = null

      /**
       * 실제로 두드린 공급자와 키 수. 「전부 막혔다」가 **셀 수 있는 사실**이 되게 한다.
       *
       * 실측 2026-09-21: 등록된 키 넷 가운데 하나만 두드리고 「등록된 공급자가 전부 한도」라고
       * 말했다. 사용자는 유료 키까지 넣어 둔 상태였다. 수를 안 적으면 그 거짓을 아무도 못 센다.
       */
      const providersTried = new Set<ProviderId>()
      let keysTried = 0

      while (rest.length > 0) {
        const cand = rest[0]
        rest = rest.slice(1)
        providersTried.add(cand.provider)
        /** 이 후보에 쓴 키 수. 교체가 일어나면 는다 */
        let keysForCand = 1
        // 앞 후보에서 모은 출처가 섞이지 않게 비운다 — 실패한 시도의 인용은 이 답의 근거가 아니다
        sources.length = 0
        seen.clear()
        try {
          /*
            **후보 하나를 키 여러 개로 붙든다.**

            한도(429)와 인증(401)은 모델이 아니라 **그 키**의 문제다. 여기서 안 하고 바로
            pruneChain 으로 내려가면 그 공급자가 통째로 빠지고, 등록해 둔 나머지 키는 한 번도
            안 쓰인다 — 그것이 2026-09-21 사고의 정확한 모양이다(표의 키 여섯 줄 전부
            last_used_at 이 비어 있었다). 후보 수는 안 는다, 교체는 이 한 칸 안에서 끝난다.
          */
          res = await streamChatWithKeys(cand.provider, cand.apiKey, {
            actorId: opts.actorId ?? null,
            model: cand.model,
            turns: [{
              role: 'user',
              content: prompt,
              ...(attachments.length > 0 ? { attachments } : {}),
            }],
            // 추출은 창작이 아니다. 같은 명함이 매번 다르게 읽히면 사용자가 결과를 못 믿는다.
            signal: AbortSignal.timeout(webSearch ? WEB_SEARCH_TIMEOUT_MS : TIMEOUT_MS),
            tools: webSearch ? { webSearch: true } : undefined,
            onDelta: () => {},
            onCitation: (c) => {
              if (!c.url || seen.has(c.url)) return
              seen.add(c.url)
              sources.push({ url: c.url, title: c.title || c.url })
            },
          }, {
            keys: {
              onSwitch: (from, to) => {
                keysForCand += 1
                // 앞 키가 흘린 출처는 다음 키의 답이 아니다 — 후보를 바꿀 때와 같은 규율
                sources.length = 0
                seen.clear()
                // **키 이름만** 적는다. 원문은 로그에도 안 남긴다
                console.warn('[crm/ai] 키 교체', `${cand.provider}:${cand.model}`,
                  `'${from.label}' → '${to.label}'`)
              },
            },
          })
          used = cand
          break
        } catch (e) {
          lastError = e
          const { scope } = classifyProviderError(e)
          if (rest.length > 0) {
            console.warn('[crm/ai] 후보 교체', `${cand.provider}:${cand.model}`, '→',
              `${rest[0].provider}:${rest[0].model}`, `(${scope})`,
              e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120))
          }
          rest = pruneChain(rest, cand, scope)
        } finally {
          keysTried += keysForCand
        }
      }

      /**
       * 전부 실패했을 때 **무엇이 막혔는지** 말한다.
       *
       * 한도로 전부 막힌 것과 그 밖의 실패는 관리자가 할 일이 다르다 —
       * 앞은 기다리거나 요금제를 올리는 것이고, 뒤는 키·모델을 보는 것이다.
       */
      if (!res) {
        // 한도는 키의 상태다 — `availability` 가 아니라 `keyOutcome` 으로 읽는다.
        // 인증 실패(`auth`)는 여기서 제외한다, 아래 문구가 말하는 처방이 다르다
        if (classifyProviderError(lastError).keyOutcome === 'quota') {
          throw new CrmError('PROVIDER_QUOTA',
            `등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다(공급자 ${providersTried.size}곳, 키 ${keysTried}개 시도). `
            + '한도가 풀릴 때까지 기다리거나 시스템 설정 → 통합에서 다른 공급자 키를 추가해 주세요.')
        }
        throw lastError ?? new CrmError('VALIDATION_FAILED', 'AI 응답을 받지 못했습니다.')
      }

      if (res.stopped) {
        throw new CrmError('VALIDATION_FAILED',
          webSearch
            ? 'AI 가 웹에서 답을 찾는 데 시간이 너무 걸렸습니다. 잠시 후 다시 시도해 주세요.'
            : 'AI 응답이 시간 안에 오지 않았습니다. 잠시 후 다시 시도해 주세요.')
      }

      /**
       * 프로바이더가 결과에 모아 준 인용이 있으면 그것을 우선 쓴다.
       * onCitation 은 스트림 중에만 오는데, 프로바이더에 따라 마지막에 한 번에 채워 주기도 한다 —
       * 둘 중 하나만 보면 출처가 있는데도 없다고 말하게 된다.
       */
      for (const c of res.citations ?? []) {
        if (!c.url || seen.has(c.url)) continue
        seen.add(c.url)
        sources.push({ url: c.url, title: c.title || c.url })
      }

      // 토큰 수는 프로바이더가 보고한 값을 그대로 쓴다 —
      // 우리가 추정하면 예산(§3.6)이 실제 비용과 어긋나고, 어긋난 예산은 안 지켜진다.
      return {
        text: res.text,
        tokensIn: res.usage?.promptTokens ?? 0,
        tokensOut: res.usage?.outputTokens ?? 0,
        sources: webSearch ? sources : undefined,
        // **실제로 답한 것**을 돌려준다. 기록이 고른 것을 적으면 사용량 집계가 거짓이 된다
        usedProvider: used?.provider,
        usedModel: used?.model,
      }
    },
  }
}
