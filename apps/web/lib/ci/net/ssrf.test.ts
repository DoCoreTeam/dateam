import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isPrivateHostname, isPrivateIpv4, isPrivateIpv6, isPrivateIp, checkUrlIsPublic,
} from './ssrf.ts'

/** 실제 DNS에 나가지 않는다 — 무엇을 반환할지 테스트가 정한다. */
function resolver(map: Record<string, string[]>) {
  return async (host: string) => {
    const found = map[host]
    if (!found) throw new Error('NXDOMAIN')
    return found
  }
}

test('클라우드 메타데이터 주소를 막는다 — 이게 뚫리면 자격증명이 샌다', () => {
  assert.equal(isPrivateIpv4('169.254.169.254'), true)
})

test('사설·루프백·CGNAT 대역을 막는다', () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0']) {
    assert.equal(isPrivateIpv4(ip), true, ip)
  }
})

test('공인 주소는 통과시킨다 — 과하게 막으면 정상 링크가 안 된다', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.196.110', '172.32.0.1', '11.0.0.1']) {
    assert.equal(isPrivateIpv4(ip), false, ip)
  }
})

test('IPv6 루프백·ULA·링크로컬을 막는다', () => {
  for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0']) {
    assert.equal(isPrivateIpv6(ip), true, ip)
  }
  assert.equal(isPrivateIpv6('2001:4860:4860::8888'), false)
})

test('IPv4-mapped IPv6로 우회하지 못한다', () => {
  assert.equal(isPrivateIp('::ffff:169.254.169.254'), true)
  assert.equal(isPrivateIp('::ffff:10.0.0.1'), true)
  assert.equal(isPrivateIp('::ffff:8.8.8.8'), false)
})

test('이름만으로 내부인 것들을 막는다', () => {
  for (const h of ['localhost', 'db.internal', 'printer.local', 'router.home.arpa', '']) {
    assert.equal(isPrivateHostname(h), true, h)
  }
  assert.equal(isPrivateHostname('www.youtube.com'), false)
})

test('공개 도메인이 사설 IP를 가리켜도 막는다 — 이름만 보면 뚫린다', async () => {
  const verdict = await checkUrlIsPublic(
    'http://10-0-0-1.nip.io/admin',
    resolver({ '10-0-0-1.nip.io': ['10.0.0.1'] }),
  )
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'PRIVATE')
})

test('여러 IP 중 하나라도 내부면 막는다 — 라운드로빈 우회 차단', async () => {
  const verdict = await checkUrlIsPublic(
    'http://mixed.example.com/',
    resolver({ 'mixed.example.com': ['93.184.216.34', '127.0.0.1'] }),
  )
  assert.equal(verdict.ok, false)
})

test('http/https가 아니면 막는다', async () => {
  const verdict = await checkUrlIsPublic('file:///etc/passwd', resolver({}))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'BAD_SCHEME')
})

test('이름을 못 풀면 PRIVATE이 아니라 UNRESOLVED — 등록까지 막을 일은 아니다', async () => {
  const verdict = await checkUrlIsPublic('https://nowhere.example/', resolver({}))
  assert.equal(verdict.ok, false)
  assert.equal(verdict.code, 'UNRESOLVED')
})

test('평범한 공개 주소는 통과한다', async () => {
  const verdict = await checkUrlIsPublic(
    'https://www.youtube.com/watch?v=abc',
    resolver({ 'www.youtube.com': ['142.250.196.110'] }),
  )
  assert.equal(verdict.ok, true)
})

test('IP를 그대로 넣으면 DNS 없이 판정한다', async () => {
  const blocked = await checkUrlIsPublic('http://169.254.169.254/latest/meta-data/', resolver({}))
  assert.equal(blocked.ok, false)
  const allowed = await checkUrlIsPublic('http://8.8.8.8/', resolver({}))
  assert.equal(allowed.ok, true)
})
