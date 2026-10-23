import { test } from 'node:test'
import assert from 'node:assert/strict'
import { initialClasses, toggleClass } from './rule-form.ts'

test('새 규칙은 아무것도 고르지 않은 채 열린다', () => {
  assert.deepEqual(initialClasses(undefined), [])
})

test('워크스테이션과 데스크톱을 누르면 그 둘이 저장된다 (REQ-021 재현)', () => {
  let cs = initialClasses(undefined)
  cs = toggleClass(cs, 'WS')
  cs = toggleClass(cs, 'CONSUMER')
  assert.deepEqual(cs, ['WS', 'CONSUMER'])
})

test('고칠 때는 저장된 값으로 채우고 모르는 값은 버린다', () => {
  assert.deepEqual(initialClasses(['WS', 'CONSUMER']), ['WS', 'CONSUMER'])
  assert.deepEqual(initialClasses(['NPU', 'GPU9']), ['NPU'])
})
