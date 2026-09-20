// lib/ai/provider-key-source.ts — 공급자 키를 고르는 한 자리
//
// ## 왜 한 자리인가
//
// 키를 읽는 길이 셋이었다. `lib/ai/gemini-key.ts`(META 직독, 42곳이 인라인으로 흩어져 있던 것을
// 모은 자리), `lib/ai-chat/registry.ts` 의 `getProviderConfig`(META), 그리고 새로 생긴
// `lib/ai/key-store.ts`(ai_provider_keys 표). 셋이 서로를 모르니 어느 키가 실제로 쓰였는지를
// 한 곳에서 말할 수 없었고, **판(운영·개발)을 보는 곳은 한 곳도 없었다.**
//
// ## 이 자리가 하는 일 셋
//
//  1. 키 표(ai_provider_keys)를 먼저 보고, 없으면 META 로 물러난다 — 옮기는 중이므로 둘 다 본다
//  2. **판을 본다.** 운영이 아닌 판은 운영 키를 안 쓴다
//  3. 키가 없으면 «없다»고 말한다. 빈 문자열을 벤더에 보내면 401 이 나고,
//     그 401 은 한도 실패와 섞여 원장에서 구별이 안 된다

/*
  이 파일에는 `import 'server-only'` 를 달지 않는다.

  서비스롤에 닿는 것은 `key-store.ts` 이고 그 파일이 이미 달고 있다. 여기서 또 달면
  **규칙을 확인하는 시험이 아예 안 돈다** — 판정과 왕복을 한 파일에 두면 규칙을 보려고
  서버를 세워야 하고, 그렇게 세운 시험은 규칙이 아니라 연결을 본다.
  키 표는 아래에서 동적으로 끌어오므로 이 모듈을 읽는 것만으로는 그 파일이 안 열린다.
*/
import type { AiProviderId } from './provider-catalog'
import { currentDeployEnv, mayUseProductionKeys, type DeployEnv } from './deploy-env.ts'

export interface KeyChoice {
  /** 쓸 키. 없으면 null 이고, 그때는 AI 를 부르지 않는다 */
  apiKey: string | null
  /** 어느 판에서 고른 것인가. 원장에 그대로 적는다 */
  env: DeployEnv
  /** 왜 이 값인지. 화면과 로그가 「키가 없다」와 「판이 달라 안 쓴다」를 구별할 수 있게 한다 */
  reason: 'pool' | 'meta' | 'no_key' | 'env_blocked'
}

/** 키가 없을 때 AI 대신 내놓는 고정 응답 */
export const NO_KEY_MESSAGE =
  'AI 공급자 키가 등록되지 않아 이 기능을 쓸 수 없습니다. 관리자 설정에서 키를 등록해 주세요.'

/** 개발 판이 운영 키를 집으려 할 때의 고정 응답 */
export const ENV_BLOCKED_MESSAGE =
  '개발 판에서는 운영 AI 키를 쓰지 않습니다. 이 판에 쓸 키를 따로 등록해 주세요.'

export function messageFor(choice: KeyChoice): string | null {
  if (choice.reason === 'no_key') return NO_KEY_MESSAGE
  if (choice.reason === 'env_blocked') return ENV_BLOCKED_MESSAGE
  return null
}

/**
 * 판을 보고 키를 고르는 **규칙**. 왕복은 안 한다.
 *
 * 규칙을 따로 둔 이유는 시험 때문이다. 판정을 질의 안에 섞으면 확인하려고 Supabase 를
 * 세워야 하고, 그렇게 세운 시험은 규칙이 아니라 연결을 본다.
 */
export function chooseKey(input: {
  env: DeployEnv
  /** 키 표에서 온 것 (그 판 몫으로 등록된 키) */
  poolKey?: string | null
  /** META 에서 온 것 — 운영 키로 본다. 운영 설정 한 벌뿐이라 판 구분이 없다 */
  metaKey?: string | null
}): KeyChoice {
  const pool = (input.poolKey ?? '').trim()
  if (pool) return { apiKey: pool, env: input.env, reason: 'pool' }

  const meta = (input.metaKey ?? '').trim()
  if (!meta) return { apiKey: null, env: input.env, reason: 'no_key' }

  /*
    META 의 키는 운영 설정이다. 운영이 아닌 판이 그것을 집으면 운영 한도를 쓰고
    운영 원장에 남는다. 그래서 막고, **막았다는 사실을 말한다** — 조용히 null 을 주면
    「키를 아직 안 넣었나」와 구별이 안 되어 다음 사람이 키를 또 넣는다.
  */
  if (!mayUseProductionKeys(input.env)) {
    return { apiKey: null, env: input.env, reason: 'env_blocked' }
  }
  return { apiKey: meta, env: input.env, reason: 'meta' }
}

/**
 * 진짜로 읽어 오는 자리.
 *
 * 키 표를 먼저 보고 없으면 META 로 물러난다. 둘 다 보는 이유는 옮기는 중이기 때문이고,
 * 옮기기가 끝나면 META 쪽을 지운다 — 그 진척은 lib/policy/ai-key-source.test.ts 가 센다.
 */
export async function resolveProviderKey(
  provider: AiProviderId,
  metaKey?: string | null,
): Promise<KeyChoice> {
  const env = currentDeployEnv()
  let poolKey: string | null = null
  try {
    const { firstKeyValue } = await import('./key-store.ts')
    poolKey = await firstKeyValue(provider)
  } catch (e) {
    // 표를 못 읽는다고 기능을 멈추지 않는다 — META 로 물러나고 그 사실만 남긴다
    console.error('[ai] 키 표 읽기 실패, META 로 물러남', e instanceof Error ? e.message : e)
  }
  return chooseKey({ env, poolKey, metaKey })
}
