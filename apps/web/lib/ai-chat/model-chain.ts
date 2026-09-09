// AI 채팅 폴백 체인 — 무엇을 어떤 순서로 시도할지 정하는 SSOT (순수 함수, 테스트 대상)
//
// ## 왜 생겼나 (실측 v0.7.715)
//
// 다른 기능 7개는 `lib/ai/gemini-call.ts` 위에 있다. 모델 체인 5단 + 재시도 + 공급자 폴백 +
// 데드라인이 거기 다 들어 있어서, 모델 하나가 막혀도 화면이 산다.
//
// **AI 채팅만 그 위에 없었다.** `providers/gemini.ts` 가 자기 fetch 를 1회 부르고 끝이라
// 폴백 0단이다. 그래서 화면에 남는 말이 이거였다 —
// 「이 모델은 현재 요금제에서 사용할 수 없습니다. 다른 모델을 선택하세요」(provider-errors.ts).
// **사람에게 모델 고르기를 떠넘기는 안내**인데, 정작 사용자는 어느 모델이 살아 있는지 알 방법이 없다.
//
// ## 왜 공급자까지 넘어가나
//
// 모델만 바꿔서는 안 풀리기 때문이다. 무료 티어 한도는 **프로젝트별로 모델마다** 걸린다 —
// 실측(2026-08-27, `lib/ai/fallback-text.ts` 머리주석)에서 flash 계열 3종이 동시에 429였다.
// 채팅은 이미 Gemini · Claude · OpenAI 셋을 `registry.ts` 에 등록해 두고도 넘어가지 않았다.
// 키가 이미 있는 곳으로 넘어가는 것이라 새 계약도 새 결제도 없다.
//
// ## 여기 없는 것
//
// **호출도 재시도도 여기서 안 한다** — 이 파일은 순서만 만든다. 실제 시도는 스트림 라우트가 한다.
// **실패 분류도 여기 없다** — `provider-errors.ts` 의 `classifyProviderError` 하나뿐이다.
// 두 곳에서 분류하면 "429인데 같은 공급자로 넘어가 또 429" 같은 것이 조용히 생긴다.

import type { ProviderId } from './provider.ts'
import type { ProviderFailureScope } from './provider-errors.ts'
import { isChatModel } from './model-tier.ts'

/** 후보 하나 — 이 공급자의 이 모델을 이 키로 부른다 */
export interface ChainCandidate {
  provider: ProviderId
  model: string
  apiKey: string
}

/** `registry.getAvailableProviders` 가 주는 모양(키와 기본 모델이 확정된 공급자) */
export interface ChainProviderConfig {
  id: ProviderId
  apiKey: string
  model: string
}

/** `ai_model_catalog` 한 행에서 순서 결정에 쓰는 것만 */
export interface ChainCatalogEntry {
  provider: string
  model_id: string
  label?: string | null
  is_active?: boolean | null
  availability?: string | null
}

/** 이 요청이 공급자에게 요구하는 능력 — 못 채우는 공급자는 후보에서 아예 뺀다 */
export interface ChainRequirements {
  vision?: boolean
  tools?: boolean
}

/** 전체 후보 상한. 늘리면 막혔을 때 사용자가 기다리는 시간이 그만큼 늘어난다 */
export const MAX_CHAIN_CANDIDATES = 6
/** 공급자당 상한. 한 공급자가 죽어 있을 때 그 공급자 모델로 체인을 다 채우지 않게 한다 */
export const MAX_PER_PROVIDER = 2

/** 카탈로그가 "이건 지금 못 쓴다"고 말한 상태 */
function isDeadInCatalog(e: ChainCatalogEntry): boolean {
  return e.is_active === false || e.availability === 'unavailable'
}

/** 한도에 걸려 있던 모델 — 후보에서 빼지는 않고 **뒤로 민다**(한도는 시간이 지나면 풀린다) */
function isDemoted(e: ChainCatalogEntry): boolean {
  return e.availability === 'limited'
}

function meetsRequirements(
  caps: { vision: boolean; tools: boolean } | undefined,
  requires: ChainRequirements,
): boolean {
  if (!caps) return false
  if (requires.vision && !caps.vision) return false
  if (requires.tools && !caps.tools) return false
  return true
}

export interface BuildModelChainArgs {
  /** 사용자가 대화에 걸어 둔 공급자와 모델 */
  chosen: { provider: ProviderId; model: string }
  /** 키와 기본 모델이 확정된 공급자들. **배열 순서가 곧 폴백 순서다** */
  providers: ChainProviderConfig[]
  catalog: ChainCatalogEntry[]
  capabilities: Partial<Record<ProviderId, { vision: boolean; tools: boolean }>>
  requires?: ChainRequirements
  maxCandidates?: number
  maxPerProvider?: number
}

/**
 * 시도 순서를 만든다.
 *
 * 1. 사용자가 고른 것 — 카탈로그가 죽었다고 말한 경우에만 뺀다
 * 2. 같은 공급자의 다른 모델 — 카탈로그 순서를 지키되 한도에 걸렸던 것은 뒤로
 * 3. 다른 공급자 — `providers` 순서대로, 각 공급자의 설정 모델을 먼저
 *
 * 능력(첨부 · 웹 검색)을 못 채우는 공급자는 2·3에서 통째로 빠진다. 넘어가 봐야 400이다.
 * 후보가 0개일 수 있다 — 호출측이 그 경우를 사용자에게 말해야 한다(조용히 빈손으로 끝내지 말 것).
 */
export function buildModelChain(args: BuildModelChainArgs): ChainCandidate[] {
  const {
    chosen,
    providers,
    catalog,
    capabilities,
    requires = {},
    maxCandidates = MAX_CHAIN_CANDIDATES,
    maxPerProvider = MAX_PER_PROVIDER,
  } = args

  const out: ChainCandidate[] = []
  const seen = new Set<string>()
  const perProvider = new Map<ProviderId, number>()

  const push = (provider: ProviderId, model: string, apiKey: string): void => {
    if (out.length >= maxCandidates) return
    const key = `${provider}:${model}`
    if (seen.has(key)) return
    if ((perProvider.get(provider) ?? 0) >= maxPerProvider) return
    seen.add(key)
    perProvider.set(provider, (perProvider.get(provider) ?? 0) + 1)
    out.push({ provider, model, apiKey })
  }

  const configOf = (id: ProviderId) => providers.find((p) => p.id === id)
  const entryOf = (provider: ProviderId, model: string) =>
    catalog.find((e) => e.provider === provider && e.model_id === model)

  /**
   * 카탈로그가 죽었다고 말하지 않은 것만 넣는다.
   * 카탈로그에 아예 없는 모델은 통과시킨다 — **모른다는 것과 못 쓴다는 것은 다르다.**
   */
  const pushIfAlive = (provider: ProviderId, model: string, apiKey: string): void => {
    const entry = entryOf(provider, model)
    if (entry && isDeadInCatalog(entry)) return
    push(provider, model, apiKey)
  }

  /**
   * 이 공급자의 카탈로그 모델을 순서대로 — 한도에 걸렸던 것은 뒤로 민다.
   *
   * **대화용이 아닌 모델은 여기서 뺀다**(`isChatModel`). 사용자가 고른 것은 존중하지만,
   * 자동으로 갈아탈 때 고르는 것은 다르다 — 실측 v0.7.716 에서 Gemma 로 넘어간 뒤
   * 모델이 자기 초안("Option 1 (Literal): …")을 답으로 뱉었고 사용자는 그걸 고장으로 봤다.
   */
  const catalogModelsOf = (provider: ProviderId): string[] => {
    const rows = catalog.filter(
      (e) => e.provider === provider && !isDeadInCatalog(e) && isChatModel({ modelId: e.model_id, label: e.label }),
    )
    return [...rows.filter((e) => !isDemoted(e)), ...rows.filter(isDemoted)].map((e) => e.model_id)
  }

  // 1) 고른 것
  const chosenConfig = configOf(chosen.provider)
  if (chosenConfig) {
    const entry = entryOf(chosen.provider, chosen.model)
    // 카탈로그에 없으면(아직 훑지 않은 모델) 그대로 존중한다 — 모른다고 막지 않는다
    const dead = entry ? isDeadInCatalog(entry) : false
    if (!dead) push(chosen.provider, chosen.model, chosenConfig.apiKey)
  }

  // 2) 같은 공급자의 다른 모델
  if (chosenConfig && meetsRequirements(capabilities[chosen.provider], requires)) {
    for (const model of catalogModelsOf(chosen.provider)) {
      push(chosen.provider, model, chosenConfig.apiKey)
    }
    pushIfAlive(chosen.provider, chosenConfig.model, chosenConfig.apiKey)
  }

  // 3) 다른 공급자
  for (const cfg of providers) {
    if (cfg.id === chosen.provider) continue
    if (!meetsRequirements(capabilities[cfg.id], requires)) continue
    pushIfAlive(cfg.id, cfg.model, cfg.apiKey)
    for (const model of catalogModelsOf(cfg.id)) push(cfg.id, model, cfg.apiKey)
  }

  return out
}

/**
 * 방금 실패한 후보를 근거로 **남은 후보에서 무엇을 더 뺄지** 정한다.
 *
 * 이걸 안 하면 429를 맞고 같은 공급자의 다음 모델로 넘어가 또 429를 맞는다.
 * 한 번 맞은 벽은 다시 치지 않는다.
 */
export function pruneChain(
  rest: readonly ChainCandidate[],
  failed: ChainCandidate,
  scope: ProviderFailureScope,
): ChainCandidate[] {
  if (scope === 'provider') return rest.filter((c) => c.provider !== failed.provider)
  return rest.filter((c) => !(c.provider === failed.provider && c.model === failed.model))
}

/**
 * 갈아탄 사실을 사용자에게 말하는 한 줄.
 *
 * **조용히 바꾸지 않는다.** 비용과 품질이 달라지는 일이라 모르고 지나가면 안 된다
 * (`gemini-model.ts` 의 `describeModelIssue` 도 같은 이유로 있다).
 */
export function formatFallbackNotice(args: {
  fromLabel: string
  fromModel: string
  toLabel: string
  toModel: string
}): string {
  return `${args.fromLabel} ${args.fromModel} 사용 불가, ${args.toLabel} ${args.toModel} 로 답했습니다`
}
