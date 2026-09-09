/**
 * 호스트 공급자로 실제 모델을 부른다 (ModelCaller 구현)
 *
 * ## 왜 채팅 어댑터를 재사용하나
 *
 * 키·모델·스트리밍 처리는 `lib/ai-chat/providers/*` 에 이미 한 벌 있고 사내 전체가 그걸 쓴다.
 * RFP 가 자기 HTTP 호출을 또 쓰면 어느 한쪽만 고쳐지는 날이 온다 —
 * 이 저장소에서 이미 겪은 일이다(market/refresh 가 SSOT 사본을 들고 있다가 옛 코드로 돌았다).
 *
 * 여기서 하는 일은 셋뿐이다: 스트림을 모아 한 덩이로 만들고, 토큰 수를 세고, 시간을 잰다.
 * **등급 관문은 여기 없다** — gateway 가 부르기 전에 이미 판정한다(그게 유일한 길목이어야 한다).
 */

import { getProvider } from '../../ai-chat/registry.ts'
import type { ProviderId } from '../../ai-chat/provider.ts'
import type { AiModel } from './models.ts'
import type { CallRequest, RawCallResult } from './gateway.ts'
import type { HostProvider } from './host-providers.ts'

/** 모델 하나에 이만큼 기다린다. 없으면 200쪽 문서 하나가 워커를 통째로 잡는다 */
export const CALL_TIMEOUT_MS = 90_000

/** 리포트 한 칸은 길지 않다. 크게 열면 비용만 커지고 근거는 안 늘어난다 */
export const MAX_OUTPUT_TOKENS = 4096

export interface HostCallerDeps {
  /** 공급자 id → 키와 모델. 관리자 설정에서 온다 */
  providers: readonly HostProvider[]
  timeoutMs?: number
}

/**
 * 토큰 수를 못 받았을 때 쓰는 어림.
 *
 * 0 으로 두면 비용이 0 원으로 기록되고, 그러면 한도가 영원히 안 찬다 —
 * 「비용이 안 보인다」보다 「비용이 없다고 나온다」가 나쁘다.
 */
export function estimateTokens(text: string): number {
  // 한국어는 한 글자가 대략 한 토큰에 가깝다. 영문 위주면 과대 추정이지만
  // 과소 추정보다 낫다 — 한도는 넘치는 쪽으로 틀려야 안전하다
  return Math.max(1, Math.ceil(text.length / 2))
}

/** 게이트웨이에 끼울 실제 호출부를 만든다 */
export function makeHostCaller(deps: HostCallerDeps) {
  const byId = new Map(deps.providers.map((p) => [p.id, p]))
  const timeoutMs = deps.timeoutMs ?? CALL_TIMEOUT_MS

  return async function call(
    model: AiModel, prompt: string, req: CallRequest,
  ): Promise<RawCallResult> {
    const conf = byId.get(model.vendorId)
    if (!conf) throw new Error(`관리자 설정에 없는 공급자다: ${model.vendorId}`)

    const provider = getProvider(conf.id as ProviderId)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const out = await provider.streamChat({
        apiKey: conf.apiKey,
        // 모델 이름은 RFP 표가 정한다 — 채팅 기본 모델과 다를 수 있다
        model: model.modelName || conf.model,
        turns: [{ role: 'user', content: prompt }],
        maxOutputTokens: req.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        signal: controller.signal,
        onDelta: () => {},
      })

      if (out.stopped) throw new Error(`${timeoutMs / 1000}초 안에 답이 안 왔다`)

      return {
        text: out.text,
        inputTokens: out.usage.promptTokens || estimateTokens(prompt),
        outputTokens: out.usage.outputTokens || estimateTokens(out.text),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
