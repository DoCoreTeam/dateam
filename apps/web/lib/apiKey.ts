import { createHmac, randomBytes } from 'crypto'

const KEY_PREFIX = 'ax_live_'
const DEV_SECRET = 'default-dev-secret-change-in-prod'

/**
 * 키 해시의 비밀값. 운영에서 없으면 기본값으로 돌지 않고 멈춘다.
 * 기본값은 저장소에 적혀 있어 누구나 같은 해시를 만들 수 있다(감사 2026-10-23).
 * 부를 때 읽는다, 빌드 때 env 가 없어도 빌드는 깨지지 않게.
 */
export function hmacSecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.API_KEY_HMAC_SECRET
  if (secret) return secret
  if (env.NODE_ENV === 'production') throw new Error('API_KEY_HMAC_SECRET is required in production')
  return DEV_SECRET
}

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString('hex') // 48 hex chars
  const key = `${KEY_PREFIX}${raw}`
  const prefix = key.slice(0, 16) // "ax_live_" + first 8 chars
  const hash = hashApiKey(key)
  return { key, prefix, hash }
}

export function hashApiKey(key: string): string {
  return createHmac('sha256', hmacSecret()).update(key).digest('hex')
}

export function maskApiKey(prefix: string): string {
  return `${prefix}${'•'.repeat(24)}`
}
