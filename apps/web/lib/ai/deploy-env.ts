// lib/ai/deploy-env.ts — 지금 어느 판에서 도나 (순수 판정)
//
// ## 왜 필요한가
//
// 키를 고르는 자리가 판을 모르면, 개발하는 사람의 노트북이 **운영 키로 벤더를 두드린다**.
// 그 호출은 운영 한도를 쓰고, 운영 원장에 남고, 누가 태웠는지는 원장만 보면 운영 사용자와
// 구별되지 않는다. 실측 2026-09-20 하루 23,318건 중 어느 것이 개발 판에서 나간 것인지
// 가릴 방법이 아예 없었다.
//
// ## 새 설정을 안 만든다
//
// `NODE_ENV` 와 `VERCEL_ENV` 는 플랫폼이 이미 넣어 주는 값이라 «새 env 를 더하는 일»이
// 아니다. 우리가 더하는 설정은 DB 에 두고 화면에서 관리한다는 규칙은 그대로다.

export type DeployEnv = 'production' | 'preview' | 'development' | 'test'

/**
 * 판을 고른다. 모르면 **가장 조심스러운 쪽**으로 본다.
 *
 * 헷갈릴 때 운영이라고 보면 개발 판이 운영 키를 쓰고, 개발이라고 보면 운영이 키를 못 쓴다.
 * 둘 다 나쁘지만 앞쪽은 조용히 나쁘고 뒤쪽은 시끄럽게 나쁘다 — 그래서 개발로 본다.
 */
export function deployEnvFrom(src: {
  NODE_ENV?: string | undefined
  VERCEL_ENV?: string | undefined
}): DeployEnv {
  const vercel = (src.VERCEL_ENV ?? '').trim().toLowerCase()
  if (vercel === 'production') return 'production'
  if (vercel === 'preview') return 'preview'

  const node = (src.NODE_ENV ?? '').trim().toLowerCase()
  if (node === 'test') return 'test'
  if (node === 'production' && vercel === '') {
    /*
      Vercel 이 아닌 곳에서 프로덕션 빌드를 돌린 경우다 — 자체 호스팅이거나
      `next build && next start` 로 켠 판이다. 운영으로 본다.
    */
    return 'production'
  }
  return 'development'
}

export function currentDeployEnv(): DeployEnv {
  return deployEnvFrom({ NODE_ENV: process.env.NODE_ENV, VERCEL_ENV: process.env.VERCEL_ENV })
}

/** 이 판이 운영 공급자 키를 써도 되나 */
export function mayUseProductionKeys(env: DeployEnv): boolean {
  return env === 'production'
}

/** 원장에 적는 짧은 이름 */
export function envTag(env: DeployEnv): string {
  return env
}
