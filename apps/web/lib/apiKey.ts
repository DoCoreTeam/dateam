import { createHmac, randomBytes } from 'crypto'

const KEY_PREFIX = 'ax_live_'
const SECRET = process.env.API_KEY_HMAC_SECRET ?? 'default-dev-secret-change-in-prod'

export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const raw = randomBytes(24).toString('hex') // 48 hex chars
  const key = `${KEY_PREFIX}${raw}`
  const prefix = key.slice(0, 16) // "ax_live_" + first 8 chars
  const hash = hashApiKey(key)
  return { key, prefix, hash }
}

export function hashApiKey(key: string): string {
  return createHmac('sha256', SECRET).update(key).digest('hex')
}

export function maskApiKey(prefix: string): string {
  return `${prefix}${'•'.repeat(24)}`
}
