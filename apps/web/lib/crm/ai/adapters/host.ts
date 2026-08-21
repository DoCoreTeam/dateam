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
import type { ProviderId } from '../../../ai-chat/provider.ts'
import { CrmError } from '../../domain/errors.ts'

/** 사람이 기다릴 수 있는 한계. 넘으면 실패로 말한다 — 무한정 도는 건 실패보다 나쁘다 */
const TIMEOUT_MS = 60_000

/**
 * 웹 검색을 켜면 모델이 실제로 페이지를 읽고 오므로 더 걸린다.
 * 같은 60초를 쓰면 **검색이 되던 것도 시간 초과로 실패한다** — 기다리는 이유가 다르면 한계도 달라야 한다.
 */
const WEB_SEARCH_TIMEOUT_MS = 90_000

/** 호스트 META 를 읽어 오는 함수 — 서버에서 주입한다(이 파일은 DB 를 모른다) */
export type MetaReader = () => Promise<Record<string, unknown>>

const PROVIDERS: ProviderId[] = ['gemini', 'claude', 'openai']

function isProviderId(v: string): v is ProviderId {
  return (PROVIDERS as string[]).includes(v)
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
   * 모델이 **인터넷을 보게 한다**(Gemini google_search · Claude web_search).
   *
   * 켜지 않으면 모델은 학습 시점의 기억으로만 답한다. 회사 정보처럼
   * "지금 웹에 있는 사실"을 물을 때 기억으로 답하면 그럴듯한 거짓이 들어온다.
   */
  webSearch?: boolean
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
): Promise<AiAdapter> {
  const meta = await readMeta()
  const id = resolveProvider(meta, setting)
  const cfg = getProviderConfig(meta, id)
  if (!cfg) {
    throw new CrmError('VALIDATION_FAILED',
      `${id} 설정이 완전하지 않습니다. 시스템 설정 → 통합에서 모델까지 지정해 주세요.`)
  }

  // 프로바이더 구현은 호스트 것을 그대로 쓴다 — CRM 이 HTTP 호출을 다시 짜지 않는다
  const { getProvider } = await import('../../../ai-chat/registry.ts')
  const provider = getProvider(id)

  const webSearch = opts.webSearch === true

  /**
   * 검색을 못 하는 프로바이더면 **조용히 넘어가지 않는다.**
   *
   * 그냥 진행하면 모델은 기억으로 답하고 출처는 비고, 화면에는 "AI 가 찾았다"고 뜬다.
   * 사용자는 검색해서 확인한 값이라고 믿는다 — 실패보다 나쁜 결과다.
   */
  if (webSearch && !provider.capabilities.tools) {
    throw new CrmError('VALIDATION_FAILED',
      `${provider.label}는 웹 검색을 지원하지 않습니다. CRM 설정의 ai.model.extract 를 gemini 또는 claude 로 바꿔 주세요.`)
  }

  return {
    model: cfg.model,
    async complete(prompt: string) {
      /**
       * 호스트 프로바이더는 스트리밍 계약이다(화면이 글자를 흘려 보여 주려고).
       * CRM 추출은 JSON 한 덩이가 필요하니 끝까지 모아 한 번에 돌려준다 —
       * 부분 JSON 은 파싱이 안 되고, 파싱 실패는 러너가 "이해하지 못했다"로 오해한다.
       */
      // 출처는 스트림 도중에 온다. 끝나고 한 번에 오지 않으므로 흘러올 때 모은다.
      const sources: AiSource[] = []
      const seen = new Set<string>()

      const res = await provider.streamChat({
        apiKey: cfg.apiKey,
        model: cfg.model,
        turns: [{ role: 'user', content: prompt }],
        // 추출은 창작이 아니다. 같은 명함이 매번 다르게 읽히면 사용자가 결과를 못 믿는다.
        signal: AbortSignal.timeout(webSearch ? WEB_SEARCH_TIMEOUT_MS : TIMEOUT_MS),
        tools: webSearch ? { webSearch: true } : undefined,
        onDelta: () => {},
        onCitation: (c) => {
          if (!c.url || seen.has(c.url)) return
          seen.add(c.url)
          sources.push({ url: c.url, title: c.title || c.url })
        },
      })

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
      }
    },
  }
}
