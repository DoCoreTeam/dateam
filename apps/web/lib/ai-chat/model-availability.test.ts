import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAvailabilitySchemaMissing } from './model-availability.ts'

test('가용성 컬럼 미적용 Postgres 오류만 호환 폴백 대상으로 판정', () => {
  assert.equal(isAvailabilitySchemaMissing({ code: '42703' }), true)
  assert.equal(isAvailabilitySchemaMissing({ code: '42501' }), false)
  assert.equal(isAvailabilitySchemaMissing(null), false)
})
