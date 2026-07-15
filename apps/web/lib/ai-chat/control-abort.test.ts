// watchControlForAbort(analyze-runner.ts) 단위테스트 — [QA HIGH] 취소=in-flight abort 배선 검증.
// 실행: node --test --experimental-strip-types "lib/ai-chat/control-abort.test.ts"

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchControlForAbort } from './analyze-runner.ts'

test('watchControlForAbort: cancelled 감지 시 controller.abort() 호출', async () => {
  const controller = new AbortController()
  let calls = 0
  const getControl = async (): Promise<string> => {
    calls += 1
    return 'cancelled'
  }

  await watchControlForAbort(getControl, controller, 5)

  assert.equal(controller.signal.aborted, true)
  assert.equal(calls, 1)
})

test('watchControlForAbort: running이면 abort 미호출(외부에서 controller를 중단해 루프 종료)', async () => {
  const controller = new AbortController()
  let calls = 0
  const getControl = async (): Promise<string> => {
    calls += 1
    return 'running'
  }

  const watchPromise = watchControlForAbort(getControl, controller, 5)
  await new Promise((resolve) => setTimeout(resolve, 15))
  // 이 시점까지 watcher 스스로는 abort를 호출하지 않았어야 한다(running만 관측).
  assert.equal(controller.signal.aborted, false)
  assert.ok(calls >= 1)

  // 외부(배치 완료 등)에서 controller를 abort하면 watcher 루프가 스스로 종료된다.
  controller.abort()
  await watchPromise
  assert.equal(controller.signal.aborted, true)
})

test('watchControlForAbort: controller가 이미 aborted면 즉시 종료(getControl 미호출)', async () => {
  const controller = new AbortController()
  controller.abort()
  let calls = 0
  const getControl = async (): Promise<string> => {
    calls += 1
    return 'running'
  }

  await watchControlForAbort(getControl, controller, 5)
  assert.equal(calls, 0)
})

test('watchControlForAbort: getControl 에러는 running으로 취급(연속 실패에도 abort 안 함)', async () => {
  const controller = new AbortController()
  const getControl = async (): Promise<string> => {
    throw new Error('network blip')
  }

  const watchPromise = watchControlForAbort(getControl, controller, 5)
  await new Promise((resolve) => setTimeout(resolve, 15))
  assert.equal(controller.signal.aborted, false)

  controller.abort()
  await watchPromise
})
