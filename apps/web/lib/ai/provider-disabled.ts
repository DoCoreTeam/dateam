// lib/ai/provider-disabled.ts — 「이 공급자는 안 쓴다」를 적어 두는 한 자리
//
// ## 왜 생겼나 (실측 2026-10-02)
//
// OpenAI 계정 크레딧이 떨어졌고 사용자가 「안 쓸 거야」라고 했다. 그런데 **끄는 길이
// 「연결 해제」(키 삭제) 하나뿐이었다.** 키는 그 표에 있는 한 벌이라, 지우면 되돌릴 때
// 공급자 콘솔에서 키를 다시 받아 와야 한다. 안 쓴다는 결정과 키를 버린다는 결정은 다르다.
//
// `ai_chat_provider_order` 에서 빼는 것으로도 안 된다 — `getProviderOrder` 가 저장값에
// 없는 공급자를 명세 순서대로 뒤에 도로 붙인다(새 공급자가 조용히 빠지지 않게 하려고).
// 그러니 「안 씀」은 따로 적어야 하는 사실이다.
//
// ## 어디에 적나
//
// META 한 칸(`ai_provider_disabled`)이다. 새 설정은 env 가 아니라 DB 에 두고 화면에서
// 관리한다(LOOP.md 6절). 표를 새로 만들지 않는 이유는 값이 공급자 id 목록 하나뿐이고,
// 같은 자리(META)에 이미 공급자 키·모델·순서가 있어서다.
//
// ## 안전한 쪽
//
// 저장값이 없거나 망가져 있으면 **아무도 안 꺼진다.** 읽다 실패해서 공급자가 통째로
// 사라지면 「왜 AI 가 안 되지」가 되고, 그 원인은 화면 어디에도 안 보인다.

import { AI_PROVIDER_IDS, type AiProviderId } from './provider-catalog.ts'

/** META 에서 안 쓰는 공급자 목록을 담는 칸 */
export const META_DISABLED_PROVIDERS_KEY = 'ai_provider_disabled'

/**
 * 저장값 → 공급자 id 집합.
 *
 * 밖에서 온 값이므로 **명세에 있는 id 만** 받는다. 모르는 문자열은 버린다 —
 * 남겨 두면 공급자 이름이 바뀐 날 끄지도 켜지도 못하는 유령이 남는다.
 */
export function readDisabledProviders(meta: Record<string, unknown>): AiProviderId[] {
  const raw = meta[META_DISABLED_PROVIDERS_KEY]
  if (!Array.isArray(raw)) return []
  const known = new Set<string>(AI_PROVIDER_IDS)
  const out: AiProviderId[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const id = v.trim()
    if (!known.has(id) || out.includes(id as AiProviderId)) continue
    out.push(id as AiProviderId)
  }
  return out
}

/** 이 공급자를 안 쓰기로 했나 */
export function isProviderDisabled(meta: Record<string, unknown>, id: AiProviderId): boolean {
  return readDisabledProviders(meta).includes(id)
}

/**
 * 끄고 켠 뒤의 새 목록. **원본 META 를 안 고친다** — 저장은 부르는 쪽이 한다.
 * 모르는 id 는 여기서도 안 받는다(저장값이 조용히 더러워지지 않게).
 */
export function withProviderDisabled(
  meta: Record<string, unknown>,
  id: AiProviderId,
  disabled: boolean,
): Record<string, unknown> {
  if (!AI_PROVIDER_IDS.includes(id)) return meta
  const current = readDisabledProviders(meta)
  const next = disabled
    ? (current.includes(id) ? current : [...current, id])
    : current.filter((v) => v !== id)
  return { ...meta, [META_DISABLED_PROVIDERS_KEY]: next }
}

/** 안 씀인 공급자를 왜 못 쓰는지 사람 말로. 할 수 있는 일(켜기)을 같이 말한다 */
export function disabledMessage(label: string): string {
  /*
    이름 뒤에 조사를 붙이지 않는다. 라틴 이름은 받침을 셀 수 없어 `lib/ui/josa` 도
    「은(는)」을 그대로 내놓는다(실측: 공급자 여섯 전부). 문장을 그렇게 짓지 않는다.
  */
  return `${label} 공급자를 안 쓰기로 해 두었습니다. 쓰려면 관리자 설정에서 다시 켜 주세요`
}
