// lib/ai-chat/stream-with-keys.ts — 호스트 공급자를 **등록된 키 전부로** 부르는 한 자리
//
// ## 왜 생겼나 (실측 2026-09-21)
//
// 관리자 화면에 Gemini 키가 넷 등록돼 있었다. 그중 하나는 결제가 붙은 유료 키였다.
// 그런데 견적서 파일을 올리면 「등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다」가 떴다.
//
// 표를 세어 보니 `ai_provider_keys` 여섯 줄의 `last_used_at` 이 **전부 비어 있었다**.
// 한 번도 안 불린 것이다. 부르는 쪽이 `getProviderConfig`(META 의 키 한 개)만 집고,
// 그 키가 429 를 내면 `pruneChain` 이 그 공급자를 통째로 버렸기 때문이다.
// 키가 셋 남아 있는데 「공급자가 죽었다」로 읽은 것이고, 유료 키는 순서가 영영 안 돌아왔다.
//
// 교체 규칙 자체는 이미 한 벌 있었다(`lib/ai/key-rotation.ts`). **AI 채팅 스트림만 그것을 탔고**
// CRM 추출과 심층분석과 서버 액션 여섯 자리가 밖에 있었다. 그래서 그 여섯이 같이 지나갈
// 자리를 하나 만든다. 부르는 쪽이 `getProvider(...).streamChat(...)` 을 직접 쓰면
// 그 자리는 다시 키 하나짜리가 된다(가드: lib/policy/ai-key-rotation-guard.test.ts).
//
// ## 여기서 정하지 않는 것
//
// 어느 키를 먼저 쓰는가는 `lib/ai/key-pool.ts`(무료 먼저, 유료 나중)가, 무엇이 키 문제인가는
// `lib/ai-chat/provider-errors.ts` 가, 몇 번 더 부를지는 `lib/ai/key-rotation.ts` 가 정한다.
// 이 파일은 그 셋을 공급자 어댑터에 이어 붙이기만 한다.

import { getProvider as getProviderFromRegistry } from './registry.ts'
import type { ProviderId, StreamChatParams, StreamChatResult } from './provider.ts'
import { withProviderKeys, type KeyRotationDeps } from '../ai/key-rotation.ts'

export interface StreamWithKeysOptions {
  /**
   * 키 목록과 결말 기록. 안 주면 `key-rotation` 이 표에서 읽는다.
   *
   * 갈아탄 사실을 화면에 말해야 하는 자리는 여기에 `onSwitch` 를 준다 —
   * 조용히 바꾸면 비용과 품질이 달라진 것을 아무도 모른다.
   */
  keys?: KeyRotationDeps
  /**
   * 공급자 구현을 어디서 가져오나. 안 주면 호스트 레지스트리.
   *
   * 시험이 가짜를 끼울 수 있어야 「첫 키가 429 면 다음 키로 간다」를 **실행으로** 잴 수 있다.
   * 소스를 훑어 배선만 확인하면, 배선은 맞는데 순서가 뒤집힌 상태를 통과시킨다
   * (`lib/rfp/ai/host-caller.ts` 가 같은 이유로 같은 구멍을 연다).
   */
  getProvider?: typeof getProviderFromRegistry
}

/**
 * 이 공급자를 **키를 갈아 가며** 부른다.
 *
 * `apiKey` 는 부르는 쪽이 이미 집은 키다(보통 META). 그 키를 맨 앞에 두고 표의 나머지를
 * 잇는다 — 한도(429)나 인증(401)으로 막히면 같은 공급자 같은 모델을 다음 키로 한 번 더 부른다.
 * 키가 하나뿐이면 정확히 한 번 불린다. 교체가 헛호출을 늘리지 않는다.
 *
 * **모델은 안 바꾼다.** 모델을 넘는 일은 `model-chain` 이 부르는 쪽에서 하고,
 * 키 교체는 그 한 칸 안에서 끝난다. 두 가지를 한 자리에서 섞으면 후보 수가 곱해진다.
 */
export async function streamChatWithKeys(
  provider: ProviderId,
  apiKey: string,
  params: Omit<StreamChatParams, 'apiKey'>,
  opts: StreamWithKeysOptions = {},
): Promise<StreamChatResult> {
  const getProvider = opts.getProvider ?? getProviderFromRegistry
  return withProviderKeys(
    provider,
    apiKey,
    (key) => getProvider(provider).streamChat({ ...params, apiKey: key }),
    opts.keys,
  )
}
