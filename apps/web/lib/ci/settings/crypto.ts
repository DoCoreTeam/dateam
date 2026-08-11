// lib/ci/settings/crypto.ts — 설정 시크릿 AES-256-GCM 암호화
// 설계서 §10.1: "DB 접속 정보와 설정 암호화 마스터 키, 이 두 부트스트랩 값만 env에 남는다."
//
// 마스터 키가 없으면 저장을 거부한다. 평문 폴백을 만들지 않는다 —
// 조용히 평문으로 저장되는 것이 시크릿 유출의 전형적 경로다.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const ENVELOPE_VERSION = 1

export interface SecretEnvelope {
  v: number
  iv: string   // base64
  ct: string   // base64 ciphertext
  tag: string  // base64 auth tag
}

export class MasterKeyUnavailableError extends Error {
  readonly code = 'SETTING_ENCRYPTION_UNAVAILABLE'
  constructor() {
    super('설정 암호화 마스터 키(CI_SETTINGS_MASTER_KEY)가 설정되지 않아 시크릿을 저장할 수 없습니다')
    this.name = 'MasterKeyUnavailableError'
  }
}

/**
 * env의 마스터 키를 32바이트 키로 유도한다.
 * 원문이 32바이트 base64면 그대로, 아니면 SHA-256으로 유도한다.
 */
function resolveKey(): Buffer {
  const raw = process.env.CI_SETTINGS_MASTER_KEY
  if (!raw || raw.trim() === '') throw new MasterKeyUnavailableError()

  const asBase64 = Buffer.from(raw, 'base64')
  if (asBase64.length === 32) return asBase64
  return createHash('sha256').update(raw, 'utf8').digest()
}

export function isMasterKeyAvailable(): boolean {
  try {
    resolveKey()
    return true
  } catch {
    return false
  }
}

export function encryptSecret(plaintext: string): SecretEnvelope {
  const key = resolveKey()
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: ENVELOPE_VERSION,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptSecret(envelope: SecretEnvelope): string {
  const key = resolveKey()
  if (envelope.v !== ENVELOPE_VERSION) {
    throw new Error(`지원하지 않는 암호화 봉투 버전: ${envelope.v}`)
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(envelope.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ct, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

export function isSecretEnvelope(value: unknown): value is SecretEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.v === 'number' && typeof v.iv === 'string'
    && typeof v.ct === 'string' && typeof v.tag === 'string'
}

/** API 응답용 마스킹. 복호 값을 절대 외부로 내보내지 않는다. */
export const MASKED_VALUE = { masked: true } as const

export function maskIfSecret(value: unknown, isEncrypted: boolean): unknown {
  return isEncrypted ? MASKED_VALUE : value
}
