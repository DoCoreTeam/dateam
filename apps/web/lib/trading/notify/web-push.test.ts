/**
 * 웹 푸시 발송 — **규격대로 잠겼는가**
 *
 * 이 코드가 틀리면 화면에는 아무 일도 안 일어난다. 푸시 서버는 400 을 주고 끝이고,
 * 사람은 「알림이 안 온다」만 본다. 그래서 값이 맞는지를 **직접 풀어서** 확인한다 —
 * 받는 쪽 비밀키로 복호화해 원문이 나오면 규격을 지킨 것이다(RFC 8291).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createECDH, createHmac, createDecipheriv, createVerify, generateKeyPairSync,
} from 'node:crypto'
import {
  encryptPayload, buildVapidJwt, derToJoseSignature, audienceOf, isGone, sendPush,
  MAX_PAYLOAD_BYTES,
} from './web-push.ts'
import { toBase64Url, fromBase64Url } from './push-core.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'web-push.ts'), 'utf8')

/** 받는 쪽이 하는 일. 규격을 지켰으면 이 순서로 원문이 나온다 */
function decryptAsDevice(body: Buffer, uaPrivate: Buffer, uaPublic: Buffer, authSecret: Buffer): string {
  const salt = body.subarray(0, 16)
  const idlen = body.readUInt8(20)
  const asPublic = body.subarray(21, 21 + idlen)
  const sealed = body.subarray(21 + idlen)

  const ecdh = createECDH('prime256v1')
  ecdh.setPrivateKey(uaPrivate)
  const shared = ecdh.computeSecret(asPublic)

  const hkdf = (s: Buffer, ikm: Buffer, info: Buffer, len: number) => {
    const prk = createHmac('sha256', s).update(ikm).digest()
    return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len)
  }
  const ikm = hkdf(authSecret, shared,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32)
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12)

  const tag = sealed.subarray(sealed.length - 16)
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(tag)
  const opened = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()])
  // 끝 표시 0x02 를 떼면 원문이다
  assert.equal(opened[opened.length - 1], 0x02, '규격이 요구하는 끝 표시가 없다')
  return opened.subarray(0, opened.length - 1).toString('utf8')
}

/** 기기 한 대를 만든다 */
function fakeDevice() {
  const ecdh = createECDH('prime256v1')
  ecdh.generateKeys()
  const authSecret = Buffer.from('0123456789abcdef', 'utf8')
  return {
    privateKey: ecdh.getPrivateKey(),
    publicKey: ecdh.getPublicKey(),
    p256dh: toBase64Url(ecdh.getPublicKey()),
    auth: toBase64Url(authSecret),
    authSecret,
  }
}

test('★ 기기가 실제로 풀 수 있다 — 규격대로 잠겼다 (RFC 8291)', () => {
  const device = fakeDevice()
  const plaintext = '롱 · 미니 KOSPI200 10월 · 손절 1,103.64'
  const { body } = encryptPayload({
    plaintext: Buffer.from(plaintext, 'utf8'),
    p256dh: device.p256dh,
    auth: device.auth,
  })
  const opened = decryptAsDevice(body, device.privateKey, device.publicKey, device.authSecret)
  assert.equal(opened, plaintext, '기기가 못 푼다 — 푸시 서버는 받아도 화면에는 아무 일이 없다')
})

test('본문 머리가 규격 그대로다 — 소금 16, 레코드 4096, 키 길이 65', () => {
  const device = fakeDevice()
  const salt = Buffer.alloc(16, 7)
  const { body } = encryptPayload({
    plaintext: Buffer.from('x'), p256dh: device.p256dh, auth: device.auth, salt,
  })
  assert.deepEqual(body.subarray(0, 16), salt)
  assert.equal(body.readUInt32BE(16), 4096, '레코드 크기가 규격과 다르다')
  assert.equal(body.readUInt8(20), 65, '보내는 쪽 공개키 길이가 다르다')
  assert.equal(body[21], 0x04, '압축 안 한 점이 아니다')
})

test('같은 원문이라도 보낼 때마다 다르다 — 소금과 한 번 쓰는 열쇠가 매번 새것이다', () => {
  const device = fakeDevice()
  const a = encryptPayload({ plaintext: Buffer.from('같은 글'), p256dh: device.p256dh, auth: device.auth })
  const b = encryptPayload({ plaintext: Buffer.from('같은 글'), p256dh: device.p256dh, auth: device.auth })
  assert.notDeepEqual(a.body, b.body, '매번 같은 본문이 나간다 — 관찰자가 같은 알림임을 안다')
})

test('기기 열쇠 꼴이 틀리면 잠그지 않고 던진다 — 잘못 잠근 것을 보내지 않는다', () => {
  const device = fakeDevice()
  assert.throws(() => encryptPayload({
    plaintext: Buffer.from('x'), p256dh: toBase64Url(Buffer.alloc(10)), auth: device.auth,
  }), /기기 공개키/)
  assert.throws(() => encryptPayload({
    plaintext: Buffer.from('x'), p256dh: device.p256dh, auth: toBase64Url(Buffer.alloc(8)),
  }), /인증 비밀/)
})

/* ── 서명 ─────────────────────────────────────────────── */

test('★ 서명이 공개키로 실제로 검증된다 (RFC 8292)', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwt = buildVapidJwt({
    audience: 'https://fcm.googleapis.com',
    subject: 'mailto:a@b.com',
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    now: new Date('2026-09-27T00:00:00Z'),
  })
  const [header, claims, signature] = jwt.split('.')
  const verifier = createVerify('SHA256')
  verifier.update(`${header}.${claims}`)
  const der = joseToDer(fromBase64Url(signature))
  assert.ok(verifier.verify(publicKey, der), '푸시 서버가 서명을 못 읽는다')

  const decoded = JSON.parse(fromBase64Url(claims).toString('utf8'))
  assert.equal(decoded.aud, 'https://fcm.googleapis.com')
  assert.equal(decoded.sub, 'mailto:a@b.com')
  assert.ok(decoded.exp > Math.floor(new Date('2026-09-27T00:00:00Z').getTime() / 1000))
})

/** 검증용. 규격의 r||s 를 다시 DER 로 */
function joseToDer(jose: Buffer): Buffer {
  const trim = (b: Buffer) => {
    let i = 0
    while (i < b.length - 1 && b[i] === 0) i += 1
    const v = b.subarray(i)
    return v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v
  }
  const r = trim(jose.subarray(0, 32))
  const s = trim(jose.subarray(32))
  const seq = Buffer.concat([
    Buffer.from([0x02, r.length]), r,
    Buffer.from([0x02, s.length]), s,
  ])
  return Buffer.concat([Buffer.from([0x30, seq.length]), seq])
}

test('서명 길이가 늘 64다 — 앞자리가 0 인 값도 채운다', () => {
  for (let i = 0; i < 40; i += 1) {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const jwt = buildVapidJwt({
      audience: 'https://x.example', subject: 'mailto:a@b.com',
      privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      now: new Date('2026-09-27T00:00:00Z'),
    })
    assert.equal(fromBase64Url(jwt.split('.')[2]).length, 64, '서명 길이가 64가 아니다')
  }
})

test('서명 대상은 출처다 — 전체 주소를 넣으면 푸시 서버가 거절한다', () => {
  assert.equal(audienceOf('https://fcm.googleapis.com/fcm/send/abc123?x=1'), 'https://fcm.googleapis.com')
})

/* ── 보내기 ───────────────────────────────────────────── */

const KEYS = (() => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  return {
    publicKey: 'BAAA', subject: 'mailto:a@b.com',
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
})()

test('★ 404·410 은 지울 신호다 — 죽은 기기에 영원히 재시도하지 않는다', async () => {
  const device = fakeDevice()
  for (const status of [404, 410]) {
    const result = await sendPush({
      target: { endpoint: 'https://push.example/x', p256dh: device.p256dh, auth: device.auth },
      payload: { title: 'x', body: 'y' }, keys: KEYS, now: new Date('2026-09-27T00:00:00Z'),
      transport: async () => ({ status }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.ok === false && result.gone, true, `${status} 를 재시도 대상으로 본다`)
  }
  assert.equal(isGone(500), false)
  assert.equal(isGone(429), false)
})

test('보내는 값에 서명과 잠근 본문이 실제로 실린다', async () => {
  const device = fakeDevice()
  let seen: { headers: Record<string, string>; body: Buffer } | null = null
  const result = await sendPush({
    target: { endpoint: 'https://push.example/x', p256dh: device.p256dh, auth: device.auth },
    payload: { title: '롱 신호', body: '손절 1,103.64', urgent: true },
    keys: KEYS, now: new Date('2026-09-27T00:00:00Z'),
    transport: async (_url, init) => { seen = init; return { status: 201 } },
  })
  assert.equal(result.ok, true)
  const sent = seen as unknown as { headers: Record<string, string>; body: Buffer }
  assert.ok(sent.headers.Authorization.startsWith('vapid t='), '서명을 안 싣는다')
  assert.ok(sent.headers.Authorization.includes(', k=BAAA'), '공개키를 안 싣는다')
  assert.equal(sent.headers['Content-Encoding'], 'aes128gcm')
  assert.equal(sent.headers.Urgency, 'high', '급한 알림을 보통으로 보낸다')
  assert.ok(sent.body.length > 21, '본문이 비어 있다')
  const opened = JSON.parse(decryptAsDevice(sent.body, device.privateKey, device.publicKey, device.authSecret))
  assert.equal(opened.title, '롱 신호')
  assert.equal(opened.url, '/trading', '눌렀을 때 갈 곳이 없다')
})

test('본문이 너무 길면 보내기 전에 멈춘다', async () => {
  const device = fakeDevice()
  const result = await sendPush({
    target: { endpoint: 'https://push.example/x', p256dh: device.p256dh, auth: device.auth },
    payload: { title: 'x', body: 'y'.repeat(MAX_PAYLOAD_BYTES + 10) },
    keys: KEYS, now: new Date('2026-09-27T00:00:00Z'),
    transport: async () => { throw new Error('보내면 안 된다') },
  })
  assert.equal(result.ok, false)
  assert.match(result.ok === false ? result.reason : '', /payload_too_large/)
})

/* ── 보안 ─────────────────────────────────────────────── */

/**
 * **비밀키가 오류 문장에 안 실린다** (S3).
 *
 * 서명이 실패하는 가장 흔한 이유가 키 꼴이고, 그때 오류에 키를 함께 적는 코드는
 * 흔하다. 한 번 적히면 로그에 영원히 남는다.
 */
test('★ 비밀키가 오류·응답에 실리는 길이 없다 (S3)', async () => {
  const device = fakeDevice()
  const result = await sendPush({
    target: { endpoint: 'https://push.example/x', p256dh: device.p256dh, auth: device.auth },
    payload: { title: 'x', body: 'y' },
    keys: { ...KEYS, privateKeyPem: '망가진 키' },
    now: new Date('2026-09-27T00:00:00Z'),
    transport: async () => ({ status: 201 }),
  })
  assert.equal(result.ok, false)
  const reason = result.ok === false ? result.reason : ''
  assert.equal(reason.includes('망가진 키'), false, '키 값이 사유에 실렸다')
  assert.equal(/PRIVATE KEY/.test(reason), false, '키 본문이 사유에 실렸다')

  // 코드에도 키를 찍는 자리가 없다
  assert.equal(/console\.(log|error|warn)/.test(SRC), false, '키를 다루는 파일이 로그를 찍는다')
  // 공개키를 헤더에 넣는 것은 규격이라 정상이다. **비밀키**를 문자열에 넣는 자리만 센다
  assert.equal(/\$\{[^}]*[Pp]rivateKey/.test(SRC), false, '비밀키를 문자열에 끼워 넣는다')
  assert.equal(/\$\{[^}]*\bauth\b/.test(SRC), false, '기기 인증 비밀을 문자열에 끼워 넣는다')
})

test('★ 기기 주소가 SSRF 검사를 지난다 (S4)', () => {
  assert.ok(SRC.includes("import { assertSafeUrl } from '../../security/safe-fetch.ts'"), 'SSRF 검사를 안 들여온다')
  const fn = SRC.slice(SRC.indexOf('async function defaultTransport'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.ok(body.includes('await assertSafeUrl(url)'), '바깥 주소를 검사 없이 부른다')
  assert.ok(body.indexOf('assertSafeUrl') < body.indexOf('fetch('), '검사 전에 부른다')
})

test('★ 잠그지 않고 보내는 길이 없다', () => {
  const fn = SRC.slice(SRC.indexOf('export async function sendPush'))
  const body = fn.slice(0, fn.indexOf('\n}\n'))
  assert.ok(body.includes('encryptPayload('), '본문을 안 잠그고 보낸다')
  assert.equal(/body:\s*plaintext/.test(body), false, '평문을 그대로 싣는다')
})
