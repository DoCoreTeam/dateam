import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setWorkflowHandoff, consumeWorkflowHandoff } from './workflow-handoff.ts'

// node:test 환경엔 window가 없다 — 최소 sessionStorage 스텁을 전역에 얹어 브라우저 동작을 흉내낸다.
function installFakeSessionStorage() {
  const store = new Map<string, string>()
  const fakeStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v) },
    removeItem: (k: string) => { store.delete(k) },
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = { sessionStorage: fakeStorage }
}

function uninstallFakeSessionStorage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).window
}

test('setWorkflowHandoff → consumeWorkflowHandoff: 저장한 값을 그대로 1회 반환한다', () => {
  installFakeSessionStorage()
  try {
    setWorkflowHandoff('weekly-report', { title: '제목', bodyMd: '본문' })
    const got = consumeWorkflowHandoff('weekly-report')
    assert.deepEqual(got, { title: '제목', bodyMd: '본문' })
  } finally {
    uninstallFakeSessionStorage()
  }
})

test('consumeWorkflowHandoff: 소비 후 다시 읽으면 null(1회성)', () => {
  installFakeSessionStorage()
  try {
    setWorkflowHandoff('dept-task', { title: 'a', bodyMd: 'b' })
    consumeWorkflowHandoff('dept-task')
    assert.equal(consumeWorkflowHandoff('dept-task'), null)
  } finally {
    uninstallFakeSessionStorage()
  }
})

test('consumeWorkflowHandoff: 값이 없으면 null', () => {
  installFakeSessionStorage()
  try {
    assert.equal(consumeWorkflowHandoff('project'), null)
  } finally {
    uninstallFakeSessionStorage()
  }
})

test('consumeWorkflowHandoff: 서로 다른 대상 키는 독립적으로 저장된다', () => {
  installFakeSessionStorage()
  try {
    setWorkflowHandoff('meeting-note', { title: 'm', bodyMd: 'n' })
    setWorkflowHandoff('project', { title: 'p', bodyMd: 'q' })
    assert.deepEqual(consumeWorkflowHandoff('meeting-note'), { title: 'm', bodyMd: 'n' })
    assert.deepEqual(consumeWorkflowHandoff('project'), { title: 'p', bodyMd: 'q' })
  } finally {
    uninstallFakeSessionStorage()
  }
})

test('consumeWorkflowHandoff: window가 없는 서버 환경에서는 null(SSR 안전)', () => {
  uninstallFakeSessionStorage()
  assert.equal(consumeWorkflowHandoff('weekly-report'), null)
})
