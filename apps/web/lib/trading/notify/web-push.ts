/**
 * 웹 푸시 발송 — **RFC 8291·8292 를 그대로 따른다**
 *
 * ## 왜 직접 짜나
 *
 * 저장소에 푸시 발송 의존성이 없고, 이 일은 표준이 이미 한 줄씩 정해 둔 것이라
 * 새 패키지를 들이는 것보다 `node:crypto` 로 규격을 따르는 쪽이 작다. 규격은
 * 두 가지뿐이다 — **누가 보냈는지 서명하고(VAPID), 본문을 기기 열쇠로 잠근다(aes128gcm).**
 *
 * ## 이 파일이 `server-only` 가 아닌 이유
 *
 * 비밀키를 **읽지 않는다.** 읽는 쪽(`push-store.ts`)이 서버 전용이고 여기는 받은 값을
 * 쓰기만 한다. 그래서 시험이 실제로 돌려 규격을 확인할 수 있다 —
 * 서버 전용으로 잠그면 암호 부분이 한 번도 안 돌아 본 코드가 된다.
 *
 * ## 규율 셋
 *
 *   ① 기기 주소는 **바깥에서 온 값**이다. 보내기 전에 SSRF 검사를 지난다(S4)
 *   ② 비밀키·본문은 오류 문장에 안 싣는다. 실패는 상태 코드와 짧은 사유로만 말한다(S3)
 *   ③ 404·410 은 「이 주소는 이제 없다」다. 재시도가 아니라 **지울 신호**로 돌려준다
 */

import {
  createECDH, createHmac, createSign, createCipheriv, randomBytes, createPrivateKey,
} from 'node:crypto'
// 상대 경로 + 확장자 — `@/` 별칭은 시험이 도는 곳에서 안 풀린다
import { assertSafeUrl } from '../../security/safe-fetch.ts'
import { toBase64Url, fromBase64Url } from './push-core.ts'

/** 본문 상한. 규격이 정한 레코드 크기이고 넘으면 푸시 서버가 413 을 준다 */
export const MAX_PAYLOAD_BYTES = 3800
const RECORD_SIZE = 4096
/** 서명 유효 시간. 길게 잡으면 새어 나간 서명이 오래 산다 */
const JWT_TTL_SECONDS = 12 * 60 * 60
/** 푸시 서버가 기기가 꺼져 있을 때 들고 있을 시간 */
const DEFAULT_TTL_SECONDS = 60 * 30

export interface PushTarget {
  endpoint: string
  /** 기기 공개키 (base64url, 압축 안 한 점) */
  p256dh: string
  /** 기기 인증 비밀 (base64url, 16바이트) */
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  urgent?: boolean
}

export type PushSendResult =
  /** 보냈다 */
  | { ok: true; status: number }
  /** 이 주소는 이제 없다. 지울 것 */
  | { ok: false; gone: true; status: number; reason: string }
  /** 실패했다. 재시도 대상 */
  | { ok: false; gone: false; status: number; reason: string }

/* ── VAPID (RFC 8292) ─────────────────────────────────── */

/** DER 서명을 규격이 요구하는 `r || s` 64바이트로 편다 */
export function derToJoseSignature(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error('DER 서명이 아닙니다')
  let offset = 2
  // 길이가 0x80 을 넘으면 길이 바이트가 하나 더 붙는다
  if (der[1] & 0x80) offset += der[1] & 0x7f
  const readInt = (): Buffer => {
    if (der[offset] !== 0x02) throw new Error('DER 정수가 아닙니다')
    const len = der[offset + 1]
    const start = offset + 2
    offset = start + len
    let value = der.subarray(start, start + len)
    // 앞의 0x00 은 부호 자리라 값이 아니다. 32바이트보다 짧으면 앞을 0 으로 채운다
    while (value.length > 32 && value[0] === 0x00) value = value.subarray(1)
    return Buffer.concat([Buffer.alloc(32 - value.length), value])
  }
  const r = readInt()
  const s = readInt()
  return Buffer.concat([r, s])
}

/**
 * 「누가 보냈나」를 적은 서명. 받는 쪽은 이것으로 발신자를 가린다.
 *
 * `aud` 는 기기 주소의 **출처(origin)** 다. 전체 주소를 넣으면 푸시 서버가 거절한다.
 */
export function buildVapidJwt(input: {
  audience: string
  subject: string
  privateKeyPem: string
  now: Date
}): string {
  const header = toBase64Url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = toBase64Url(Buffer.from(JSON.stringify({
    aud: input.audience,
    exp: Math.floor(input.now.getTime() / 1000) + JWT_TTL_SECONDS,
    sub: input.subject,
  })))
  const signing = `${header}.${claims}`
  const signer = createSign('SHA256')
  signer.update(signing)
  const der = signer.sign(createPrivateKey(input.privateKeyPem))
  return `${signing}.${toBase64Url(derToJoseSignature(der))}`
}

/* ── 본문 잠그기 (RFC 8291 aes128gcm) ─────────────────── */

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, length: number): Buffer {
  const prk = createHmac('sha256', salt).update(ikm).digest()
  const okm = createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest()
  return okm.subarray(0, length)
}

export interface EncryptedPush {
  body: Buffer
  salt: Buffer
}

/**
 * 본문을 기기 열쇠로 잠근다.
 *
 * 잠그지 않고 보낼 수 있는 길을 **안 만든다.** 규격이 허용하는 빈 본문 알림이 있지만,
 * 그 길을 두면 언젠가 제목을 평문으로 보내게 되고 푸시 서버가 그것을 본다.
 */
export function encryptPayload(input: {
  plaintext: Buffer
  p256dh: string
  auth: string
  salt?: Buffer
  ephemeral?: { privateKey: Buffer; publicKey: Buffer }
}): EncryptedPush {
  const userPublic = fromBase64Url(input.p256dh)
  const authSecret = fromBase64Url(input.auth)
  if (userPublic.length !== 65 || userPublic[0] !== 0x04) throw new Error('기기 공개키 꼴이 아닙니다')
  if (authSecret.length !== 16) throw new Error('기기 인증 비밀 길이가 다릅니다')

  const ecdh = createECDH('prime256v1')
  if (input.ephemeral) ecdh.setPrivateKey(input.ephemeral.privateKey)
  else ecdh.generateKeys()
  const asPublic = input.ephemeral?.publicKey ?? ecdh.getPublicKey()
  const shared = ecdh.computeSecret(userPublic)

  // ① 기기 인증 비밀로 공유 비밀을 한 번 더 늘린다 (RFC 8291 §3.3)
  const keyInfo = Buffer.concat([
    Buffer.from('WebPush: info\0'), userPublic, asPublic,
  ])
  const ikm = hkdf(authSecret, shared, keyInfo, 32)

  // ② 거기서 내용 열쇠와 한 번 쓰는 값을 뽑는다
  const salt = input.salt ?? randomBytes(16)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  // ③ 규격이 요구하는 끝 표시(0x02)를 붙이고 잠근다
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const sealed = Buffer.concat([
    cipher.update(Buffer.concat([input.plaintext, Buffer.from([0x02])])),
    cipher.final(),
    cipher.getAuthTag(),
  ])

  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(asPublic.length, 20)
  return { body: Buffer.concat([header, asPublic, sealed]), salt }
}

/* ── 보내기 ───────────────────────────────────────────── */

/** 주소에서 출처만. 서명의 `aud` 자리에 전체 주소를 넣으면 푸시 서버가 거절한다 */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin
}

export interface SendInput {
  target: PushTarget
  payload: PushPayload
  keys: { publicKey: string; privateKeyPem: string; subject: string }
  now: Date
  ttlSeconds?: number
  /** 시험이 갈아 끼운다. 기본은 SSRF 검사를 지난 진짜 요청이다 */
  transport?: (url: string, init: { headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>
}

/** 상태 코드 하나가 「지워라」와 「다시 해봐라」를 가른다 */
export function isGone(status: number): boolean {
  return status === 404 || status === 410
}

export async function sendPush(input: SendInput): Promise<PushSendResult> {
  const json = JSON.stringify({
    title: input.payload.title,
    body: input.payload.body,
    url: input.payload.url ?? '/trading',
    tag: input.payload.tag,
    urgent: input.payload.urgent === true,
  })
  const plaintext = Buffer.from(json, 'utf8')
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    return { ok: false, gone: false, status: 0, reason: `payload_too_large:${plaintext.length}` }
  }

  let encrypted: EncryptedPush
  let jwt: string
  try {
    encrypted = encryptPayload({
      plaintext, p256dh: input.target.p256dh, auth: input.target.auth,
    })
    jwt = buildVapidJwt({
      audience: audienceOf(input.target.endpoint),
      subject: input.keys.subject,
      privateKeyPem: input.keys.privateKeyPem,
      now: input.now,
    })
  } catch (error) {
    // 비밀키가 오류 문장에 실리지 않게 **사유만** 옮긴다(S3)
    return {
      ok: false, gone: false, status: 0,
      reason: `prepare_failed:${error instanceof Error ? error.name : 'unknown'}`,
    }
  }

  const headers: Record<string, string> = {
    Authorization: `vapid t=${jwt}, k=${input.keys.publicKey}`,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    TTL: String(input.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    Urgency: input.payload.urgent ? 'high' : 'normal',
  }

  try {
    const send = input.transport ?? defaultTransport
    const { status } = await send(input.target.endpoint, { headers, body: encrypted.body })
    if (status >= 200 && status < 300) return { ok: true, status }
    if (isGone(status)) return { ok: false, gone: true, status, reason: `gone:${status}` }
    return { ok: false, gone: false, status, reason: `push_http_${status}` }
  } catch (error) {
    return {
      ok: false, gone: false, status: 0,
      reason: `send_failed:${error instanceof Error ? error.message.slice(0, 80) : 'unknown'}`,
    }
  }
}

/**
 * 진짜 요청. 기기 주소는 브라우저가 준 **바깥 값**이라 SSRF 검사를 먼저 지난다(S4).
 * 사설 주소로 해석되면 여기서 던지고, 그 사유가 실패로 기록된다.
 */
async function defaultTransport(
  url: string,
  init: { headers: Record<string, string>; body: Buffer },
): Promise<{ status: number }> {
  const safe = await assertSafeUrl(url)
  const response = await fetch(safe.toString(), {
    method: 'POST',
    headers: init.headers,
    body: new Uint8Array(init.body),
  })
  return { status: response.status }
}
