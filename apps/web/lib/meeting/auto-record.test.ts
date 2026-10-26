/**
 * 작업대 도착 자동 녹음, 가드
 *
 * 사용자 지시 2026-10-26: 「녹음 시작」을 누르면 도착한 작업대에서 녹음이 돌고 있어야 한다.
 * 같은 노트에 두 번 켜지 않고, 다른 녹음이 돌면 켜지 않고, 켠 뒤 표지는 주소에서 지운다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldAutoRecord, consumedKey, stripAutoRecordParam, type AutoRecordInput } from './auto-record.ts'
import { startHref } from './start-flow.ts'

const ready: AutoRecordInput = {
  param: '1', noteId: 'n1', consumed: false, supported: true, canEdit: true,
  recState: 'idle', otherRecording: false,
}

test('★ 표지가 있고 녹음기가 쉬고 있으면 켠다', () => {
  assert.equal(shouldAutoRecord(ready), true)
  assert.equal(shouldAutoRecord({ ...ready, recState: 'error' }), true)
})

test('★ 같은 노트에서 이미 쓴 표지로는 두 번 켜지 않는다', () => {
  assert.equal(shouldAutoRecord({ ...ready, consumed: true }), false)
})

test('★ 다른 녹음이 돌면 켜지 않는다', () => {
  assert.equal(shouldAutoRecord({ ...ready, otherRecording: true }), false)
  for (const recState of ['requesting', 'recording', 'paused', 'stopping']) {
    assert.equal(shouldAutoRecord({ ...ready, recState }), false, recState)
  }
})

test('표지가 없거나 다른 값이면 켜지 않는다', () => {
  assert.equal(shouldAutoRecord({ ...ready, param: null }), false)
  assert.equal(shouldAutoRecord({ ...ready, param: '0' }), false)
  assert.equal(shouldAutoRecord({ ...ready, param: '' }), false)
})

test('녹음을 못 쓰는 브라우저, 고칠 권한 없음, 노트 없음이면 켜지 않는다', () => {
  assert.equal(shouldAutoRecord({ ...ready, supported: false }), false)
  assert.equal(shouldAutoRecord({ ...ready, canEdit: false }), false)
  assert.equal(shouldAutoRecord({ ...ready, noteId: '' }), false)
})

test('★ 표지만 지우고 탭과 다른 값은 남긴다', () => {
  assert.equal(stripAutoRecordParam('/crm/meetings/m1?wb=memo&rec=1'), '/crm/meetings/m1?wb=memo')
  assert.equal(stripAutoRecordParam('/meeting-notes/n1?rec=1&wb=memo&x=2#top'), '/meeting-notes/n1?wb=memo&x=2#top')
  assert.equal(stripAutoRecordParam('https://a.example/crm/meetings/m1?wb=memo&rec=1'), 'https://a.example/crm/meetings/m1?wb=memo')
  assert.equal(stripAutoRecordParam('/meeting-notes/n1?rec=1'), '/meeting-notes/n1')
})

test('시작 한 길이 만든 녹음 주소에서 표지를 지우면 쓰기 주소와 같다', () => {
  assert.equal(stripAutoRecordParam(startHref('crm', 'm1', 'record')), startHref('crm', 'm1', 'write'))
  assert.equal(stripAutoRecordParam(startHref('notes', 'n1', 'record')), startHref('notes', 'n1', 'write'))
})

test('썼음 열쇠는 노트마다 다르다', () => {
  assert.equal(consumedKey('n1'), 'newax.auto-record.n1')
  assert.notEqual(consumedKey('n1'), consumedKey('n2'))
})
