import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  employmentMap, isResigned, isResignScheduled, employmentStatus, resignedIds, excludeResigned,
  validateEmployment, toDateOrNull, employmentPeriod,
} from './employment.ts'

// 「오늘」을 넘겨 시계와 무관하게 판정한다 — 안 그러면 내일 이 검사가 다른 답을 낸다
const TODAY = '2026-09-18'

test('기록이 아예 없으면 재직이다 — 없음을 퇴사로 읽으면 첫 배포에 전원이 퇴사자가 된다', () => {
  assert.equal(isResigned(undefined), false)
  assert.equal(isResigned(null), false)
  assert.equal(employmentStatus(undefined), 'active')
})

test('입사일만 적힌 사람은 재직이다', () => {
  const row = { user_id: 'u1', hired_on: '2024-03-02', resigned_on: null }
  assert.equal(isResigned(row), false)
  assert.equal(employmentStatus(row), 'active')
})

test('퇴사일이 오늘이거나 지났으면 퇴사다', () => {
  assert.equal(isResigned({ user_id: 'u1', hired_on: null, resigned_on: '2026-09-17' }, TODAY), true)
  assert.equal(isResigned({ user_id: 'u1', hired_on: null, resigned_on: TODAY }, TODAY), true)
  assert.equal(employmentStatus({ user_id: 'u1', hired_on: null, resigned_on: TODAY }, TODAY), 'resigned')
})

test('퇴사일이 앞날이면 아직 재직이다 — 날짜를 정했다는 것은 그날부터라는 뜻', () => {
  const row = { user_id: 'u1', hired_on: null, resigned_on: '2026-09-30' }
  assert.equal(isResigned(row, TODAY), false)
  assert.equal(isResignScheduled(row, TODAY), true)
  assert.equal(employmentStatus(row, TODAY), 'active')
})

test('퇴사 예정은 퇴사가 아니고 퇴사는 예정이 아니다', () => {
  assert.equal(isResignScheduled({ user_id: 'u1', resigned_on: '2026-09-17' }, TODAY), false)
  assert.equal(isResignScheduled({ user_id: 'u1', resigned_on: null }, TODAY), false)
  assert.equal(isResignScheduled(undefined, TODAY), false)
})

test('employmentMap 은 user_id 로 찾게 한다', () => {
  const m = employmentMap([{ user_id: 'a', resigned_on: null }, { user_id: 'b', resigned_on: '2026-01-01' }])
  assert.equal(m.get('a')?.resigned_on, null)
  assert.equal(m.get('b')?.resigned_on, '2026-01-01')
  assert.equal(m.get('없는사람'), undefined)
  assert.equal(employmentMap(null).size, 0)
})

test('resignedIds 는 그날이 온 퇴사자만 담는다 — 예정자는 아직 고르는 자리에 남는다', () => {
  const s = resignedIds([
    { user_id: 'a', resigned_on: null },
    { user_id: 'b', resigned_on: '2026-01-01' },
    { user_id: 'c', resigned_on: '' },
    { user_id: 'd', resigned_on: '2026-09-30' },
  ], TODAY)
  assert.deepEqual([...s], ['b'])
})

test('excludeResigned 는 고르는 목록에서 퇴사자를 뺀다', () => {
  const people = [{ id: 'a', name: '가' }, { id: 'b', name: '나' }]
  assert.deepEqual(excludeResigned(people, new Set(['b'])), [{ id: 'a', name: '가' }])
  assert.deepEqual(excludeResigned(people, new Set()), people)
})

test('퇴사일이 입사일보다 앞서면 막는다 — 표의 check 와 같은 규칙', () => {
  assert.equal(validateEmployment({ hired_on: '2024-01-10', resigned_on: '2023-12-31' }), '퇴사일이 입사일보다 앞설 수 없습니다')
  assert.equal(validateEmployment({ hired_on: '2024-01-10', resigned_on: '2024-01-10' }), null)
  assert.equal(validateEmployment({ hired_on: null, resigned_on: '2023-12-31' }), null)
  assert.equal(validateEmployment({ hired_on: null, resigned_on: null }), null)
})

test('날짜가 아닌 값은 형식으로 막는다', () => {
  assert.equal(validateEmployment({ hired_on: '2024-13-01', resigned_on: null }), '입사일 형식이 올바르지 않습니다')
  assert.equal(validateEmployment({ hired_on: '20240101', resigned_on: null }), '입사일 형식이 올바르지 않습니다')
  assert.equal(validateEmployment({ hired_on: null, resigned_on: '2024-02-30' }), '퇴사일 형식이 올바르지 않습니다')
})

test('폼이 주는 빈 문자열은 null 이 된다 — 그대로 보내면 날짜 칸이 거부한다', () => {
  assert.equal(toDateOrNull(''), null)
  assert.equal(toDateOrNull('   '), null)
  assert.equal(toDateOrNull(null), null)
  assert.equal(toDateOrNull('2026-09-17'), '2026-09-17')
})

test('재직 기간은 둘 다 모르면 줄을 접게 null 을 준다', () => {
  assert.equal(employmentPeriod({ hired_on: null, resigned_on: null }), null)
  assert.equal(employmentPeriod(null), null)
  assert.equal(employmentPeriod({ hired_on: '2024-03-02', resigned_on: null }), '2024-03-02 ~ 재직 중')
  assert.equal(employmentPeriod({ hired_on: null, resigned_on: '2026-09-17' }), '? ~ 2026-09-17')
})
