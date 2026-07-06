import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeError, ACTIVITY_ACTION_LABEL, ACTIVITY_STATUS_LABEL,
  type ProjectActivityAction, type ProjectActivityStatus,
} from './project-activity.ts'

test('normalizeError: Supabase 에러객체(message+code) 보존', () => {
  const out = normalizeError({ message: 'duplicate key', code: '23505' })
  assert.equal(out.message, 'duplicate key')
  assert.equal(out.code, '23505')
})

test('normalizeError: code 없는 객체는 code=null', () => {
  const out = normalizeError({ message: '연결 실패' })
  assert.equal(out.message, '연결 실패')
  assert.equal(out.code, null)
})

test('normalizeError: Error 인스턴스는 message 추출', () => {
  const out = normalizeError(new Error('boom'))
  assert.equal(out.message, 'boom')
})

test('normalizeError: 원시값은 문자열화', () => {
  assert.equal(normalizeError('그냥 문자열').message, '그냥 문자열')
  assert.equal(normalizeError(42).message, '42')
})

test('라벨 맵: 모든 action/status 키 커버', () => {
  const actions: ProjectActivityAction[] = ['create', 'update', 'delete', 'ai_confirm', 'link_daily', 'unlink_daily', 'member_change']
  for (const a of actions) assert.ok(ACTIVITY_ACTION_LABEL[a], `action 라벨 누락: ${a}`)
  const statuses: ProjectActivityStatus[] = ['success', 'failure', 'partial']
  for (const s of statuses) assert.ok(ACTIVITY_STATUS_LABEL[s], `status 라벨 누락: ${s}`)
})
