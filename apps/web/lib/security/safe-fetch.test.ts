import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertSafeUrl, safeFetchBytes, SsrfBlockedError } from './safe-fetch.ts'

const BLOCKED = [
  'http://127.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://10.0.0.5/',
  'http://192.168.1.1/',
  'http://[::1]/',
  'http://[::]/',
  'http://[::ffff:127.0.0.1]/', // URL 이 [::ffff:7f00:1] 로 바꿔 쓰는 표기
  'http://[::ffff:7f00:1]/',
  'http://[::ffff:a9fe:a9fe]/', // 메타데이터
  'http://[::ffff:0:a9fe:a9fe]/',
  'http://[::127.0.0.1]/',
  'http://[64:ff9b::a9fe:a9fe]/', // NAT64
  'http://[2002:7f00:1::]/', // 6to4
  'http://[fe80::1]/',
  'http://[fec0::1]/',
  'http://[fd12:3456::1]/',
  'http://[ff02::1]/',
  'http://[2001:db8::1]/',
  'file:///etc/passwd',
  'gopher://127.0.0.1/',
]

test('내부 주소와 IPv6 사설 표기를 거절한다', async () => {
  for (const url of BLOCKED) {
    await assert.rejects(assertSafeUrl(url), SsrfBlockedError, url)
  }
})

test('공인 IP 는 통과한다', async () => {
  for (const url of ['http://8.8.8.8/', 'http://[2606:4700:4700::1111]/', 'http://[::ffff:8.8.8.8]/']) {
    const u = await assertSafeUrl(url)
    assert.ok(u instanceof URL, url)
  }
})

test('safeFetchBytes 는 내부 주소를 부르지 않고 사유를 돌려준다', async () => {
  const r = await safeFetchBytes('http://169.254.169.254/latest/meta-data/')
  assert.equal(r.ok, false)
  assert.equal(r.bytes.byteLength, 0)
  assert.match(r.blockedReason ?? '', /차단/)
})
