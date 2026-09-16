import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  G2B_SERVICES, serviceOf, unusedServices, rejectOf, REJECT_NEXT,
} from './services.ts'
import { G2B_BASE } from './client.ts'

test('여섯 서비스가 등록돼 있고 각각 무엇을 주는지 적혀 있다', () => {
  assert.equal(G2B_SERVICES.length, 6)
  for (const s of G2B_SERVICES) {
    assert.ok(s.portalNo.length > 0, `${s.id} 에 포털 번호가 없다`)
    assert.ok(s.base.startsWith('https://apis.data.go.kr/'), `${s.id} 주소가 이상하다`)
    assert.ok(s.gives.length > 0, `${s.id} 가 무엇을 주는지 안 적혀 있다`)
  }
})

test('포털 번호가 겹치지 않는다', () => {
  const nos = G2B_SERVICES.map((s) => s.portalNo)
  assert.equal(new Set(nos).size, nos.length)
})

test('지금 쓰는 것은 입찰공고 하나뿐이고 나머지 다섯은 안 쓴다', () => {
  const used = G2B_SERVICES.filter((s) => s.inUse)
  assert.deepEqual(used.map((s) => s.id), ['bidPublicInfo'])
  assert.equal(unusedServices().length, 5)
})

test('쓰고 있는 서비스의 주소가 클라이언트가 실제로 부르는 주소와 같다', () => {
  assert.equal(serviceOf('bidPublicInfo').base, G2B_BASE, '등록부와 실제가 갈리면 등록부가 종이가 된다')
})

test('없는 서비스를 찾으면 조용히 undefined 로 넘어가지 않는다', () => {
  assert.throws(() => serviceOf('nope' as never), /unregistered portal service/)
})

test('★ 신청 안 됨과 한도 초과와 키 문제를 갈라 읽는다', () => {
  assert.equal(rejectOf('30'), 'not_registered')
  assert.equal(rejectOf('SERVICE_KEY_IS_NOT_REGISTERED_ERROR'), 'not_registered')
  assert.equal(rejectOf('22'), 'quota_exceeded')
  assert.equal(rejectOf('31'), 'bad_key')
  assert.equal(rejectOf('999'), 'unknown', '모르는 코드를 아는 척하지 않는다')
  assert.equal(rejectOf(null), 'unknown')
})

test('★ 거절마다 사용자가 할 일이 다르다', () => {
  assert.equal(REJECT_NEXT.not_registered, 'apply', '기다려도 안 열린다, 우리가 신청해야 한다')
  assert.equal(REJECT_NEXT.quota_exceeded, 'wait')
  assert.equal(REJECT_NEXT.bad_key, 'fix_key')
  assert.equal(REJECT_NEXT.unknown, 'report')
  // 넷이 다 달라야 갈라 둔 값어치가 있다
  assert.equal(new Set(Object.values(REJECT_NEXT)).size, 4)
})
