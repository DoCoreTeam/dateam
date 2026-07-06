import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeActivityError, MODULE_LABEL, ACTION_LABEL, STATUS_LABEL,
  type FeedModule, type ActivityStatus,
} from './activity-log.ts'
import {
  ACTIVITY_ACTION_LABEL, ACTIVITY_STATUS_LABEL,
} from './project-activity.ts'

test('normalizeActivityError: Supabase 에러(message+code) 보존', () => {
  const out = normalizeActivityError({ message: 'duplicate', code: '23505' })
  assert.equal(out.message, 'duplicate')
  assert.equal(out.code, '23505')
})

test('normalizeActivityError: Error 인스턴스·원시값', () => {
  assert.equal(normalizeActivityError(new Error('boom')).message, 'boom')
  assert.equal(normalizeActivityError('str').message, 'str')
  assert.equal(normalizeActivityError(7).message, '7')
})

test('라벨 맵: 모든 모듈/상태 커버', () => {
  const mods: FeedModule[] = ['daily', 'dept_task', 'project', 'weekly']
  for (const m of mods) assert.ok(MODULE_LABEL[m], `모듈 라벨 누락: ${m}`)
  const statuses: ActivityStatus[] = ['success', 'failure', 'partial']
  for (const s of statuses) assert.ok(STATUS_LABEL[s], `상태 라벨 누락: ${s}`)
  assert.ok(ACTION_LABEL.create && ACTION_LABEL.ai_confirm)
})

test('라벨 SSOT: project-activity 재수출이 activity-log와 동일 참조', () => {
  // 중복 정의·텍스트 불일치 방지(DC-REV HIGH #1 회귀 가드).
  assert.equal(ACTIVITY_ACTION_LABEL, ACTION_LABEL)
  assert.equal(ACTIVITY_STATUS_LABEL, STATUS_LABEL)
})
