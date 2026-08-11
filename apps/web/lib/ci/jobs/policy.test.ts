import { test } from 'node:test'
import assert from 'node:assert/strict'
import { backoffSeconds, idempotencyKey, MAX_ATTEMPTS, nextStatusAfterFailure, nextStage } from './policy.ts'

test('멱등키는 단계·대상·버전으로만 결정된다 (같은 입력 = 같은 키)', () => {
  assert.equal(idempotencyKey('ingest', 'c1'), 'ingest:c1:1')
  assert.equal(idempotencyKey('ingest', 'c1'), idempotencyKey('ingest', 'c1'))
})

test('단계가 다르면 키가 다르다 (같은 콘텐츠도 단계별로 잡이 산다)', () => {
  assert.notEqual(idempotencyKey('ingest', 'c1'), idempotencyKey('classify', 'c1'))
})

test('버전을 올리면 같은 대상을 다시 처리할 수 있다', () => {
  assert.equal(idempotencyKey('classify', 'c1', 2), 'classify:c1:2')
  assert.notEqual(idempotencyKey('classify', 'c1', 1), idempotencyKey('classify', 'c1', 2))
})

test('백오프는 시도할수록 길어진다', () => {
  assert.equal(backoffSeconds(1), 60)
  assert.equal(backoffSeconds(2), 240)
  assert.equal(backoffSeconds(3), 540)
  assert.ok(backoffSeconds(2) > backoffSeconds(1))
})

test('백오프는 1시간을 넘지 않는다 (무한정 밀리지 않게)', () => {
  assert.equal(backoffSeconds(100), 3600)
})

test('재시도 한도는 3회 (설계서 §11.2)', () => {
  assert.equal(MAX_ATTEMPTS, 3)
})

test('재시도 한도에 닿으면 실패 큐(DLQ)로 간다', () => {
  assert.equal(nextStatusAfterFailure(1, 3), 'failed')
  assert.equal(nextStatusAfterFailure(2, 3), 'failed')
  assert.equal(nextStatusAfterFailure(3, 3), 'dead')
  assert.equal(nextStatusAfterFailure(4, 3), 'dead')
})

test('파이프라인 단계는 정해진 순서로 이어지고 마지막에서 멈춘다', () => {
  assert.equal(nextStage('ingest'), 'normalize')
  assert.equal(nextStage('classify'), 'verify')
  assert.equal(nextStage('verify'), 'project')
  assert.equal(nextStage('project'), null)
})
