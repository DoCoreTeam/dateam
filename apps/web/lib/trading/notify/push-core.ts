/**
 * 푸시 규격의 순수 셈 — **`server-only` 밖에 있다**
 *
 * 열쇠와 표를 다루는 쪽(`push-store.ts`)과 보내는 쪽(`web-push.ts`)은 서버 전용이라
 * 시험이 그 모듈을 들여올 수 없다. 그래서 값으로 확인할 수 있는 셈만 여기 둔다 —
 * 저쪽은 소스를 읽어 규율을 확인하고, 이쪽은 실제로 돌려 값을 확인한다.
 */

import { createHash } from 'node:crypto'

/** 푸시 규격은 `+ / =` 를 안 받는다. 그대로 보내면 서버가 400 을 준다 */
export function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Buffer {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4))
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

/** 열쇠가 바뀌었는지 사람이 알아볼 수 있는 짧은 지문. **공개키만** 넣는다 */
export function keyFingerprint(publicKey: string): string {
  return createHash('sha256').update(publicKey).digest('hex').slice(0, 12)
}

/**
 * SPKI DER 에서 브라우저가 받는 꼴(압축 안 한 점)을 뽑는다.
 *
 * 끝 65바이트가 `0x04 || X || Y` 다. 앞의 26바이트는 곡선 이름표라 브라우저가 안 쓴다.
 */
export function rawPublicKeyFromSpki(der: Buffer): Buffer {
  if (der.length < 65) throw new Error('공개키가 짧습니다')
  const point = der.subarray(der.length - 65)
  if (point[0] !== 0x04) throw new Error('압축 안 한 점이 아닙니다')
  return Buffer.from(point)
}
