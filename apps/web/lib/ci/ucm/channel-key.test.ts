import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildChannelKey, channelRefFromUrl, isProvisionalKey , provisionalKeyCandidates } from './channel-key.ts'

test('플랫폼 ID가 있으면 그것을 쓴다', () => {
  const k = buildChannelKey({ platform: 'youtube', externalId: 'UC123' })
  assert.deepEqual(k, { externalId: 'UC123', source: 'platform_id' })
})

test('프로필 URL에서 채널 ID를 뽑아낸다', () => {
  const k = buildChannelKey({ platform: 'youtube', profileUrl: 'https://www.youtube.com/channel/UCabc' })
  assert.equal(k?.externalId, 'UCabc')
  assert.equal(k?.source, 'platform_id')
})

test('ID가 없으면 핸들로 키를 만든다', () => {
  const k = buildChannelKey({ platform: 'youtube', profileUrl: 'https://www.youtube.com/@cooking' })
  assert.equal(k?.externalId, 'handle:@cooking')
  assert.equal(k?.source, 'handle')
})

test('핸들도 없으면 표시 이름으로라도 채널을 만든다', () => {
  // oembed는 author_name만 주는 경우가 많다. 여기서 포기하면 배수가 영원히 안 나온다.
  const k = buildChannelKey({ platform: 'tiktok', displayName: '요리하는 남자' })
  assert.equal(k?.externalId, 'name:요리하는-남자')
  assert.equal(k?.source, 'display_name')
})

test('단서가 하나도 없을 때만 null', () => {
  assert.equal(buildChannelKey({ platform: 'x' }), null)
})

test('같은 채널은 같은 키로 수렴한다 (콘텐츠가 흩어지지 않게)', () => {
  const a = buildChannelKey({ platform: 'youtube', profileUrl: 'https://www.youtube.com/@Cooking' })
  const b = buildChannelKey({ platform: 'youtube', handle: '@cooking' })
  assert.equal(a?.externalId, b?.externalId)
})

test('임시 키는 나중에 승격할 수 있게 표시된다', () => {
  assert.equal(isProvisionalKey('handle:@x'), true)
  assert.equal(isProvisionalKey('name:someone'), true)
  assert.equal(isProvisionalKey('UC123'), false)
})

test('잘못된 URL은 예외 없이 무시된다', () => {
  assert.deepEqual(channelRefFromUrl('그냥 텍스트'), {})
  assert.deepEqual(channelRefFromUrl(null), {})
})

test('게시물 URL을 채널로 오인하지 않는다', () => {
  assert.deepEqual(channelRefFromUrl('https://www.instagram.com/p/ABC'), {})
  assert.deepEqual(channelRefFromUrl('https://x.com/someone/status/1'), { handle: '@someone' })
})

test('임시 키 후보 — 진짜 ID를 얻었을 때 옛 행을 찾을 수 있어야 한다', () => {
  const c = provisionalKeyCandidates({
    handle: '@jawed',
    profileUrl: 'https://www.youtube.com/@jawed',
    displayName: 'jawed',
  })
  assert.ok(c.includes('handle:@jawed'))
  assert.ok(c.includes('name:jawed'))
  // 후보가 하나도 없으면 승격 자체를 시도하지 않는다
  assert.deepEqual(provisionalKeyCandidates({}), [])
})
