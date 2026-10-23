import { test } from 'node:test'
import assert from 'node:assert/strict'
import { looksLikeTestAccount, summarizeAdmins, testAccountRunError } from './test-account-guard.ts'

test('★ 운영에 남은 시험 관리자 둘을 짚는다 (REQ-001 실측)', () => {
  const profiles = [
    { id: 'a', role: 'admin', name: '김도현' },
    { id: 'b', role: 'admin', name: 'AI채팅테스트' },
    { id: 'c', role: 'admin', name: '테스터' },
    { id: 'd', role: 'member', name: '테스트계정' },
  ]
  const emails: Record<string, string> = { a: 'michaelkim@data-alliance.com', b: 'aichat@data-alliance.com', c: 'test@test.com', d: 'test@test.co.kr' }
  const s = summarizeAdmins(profiles, (id) => emails[id])
  assert.equal(s.adminCount, 3)
  assert.deepEqual(s.suspiciousAdminIds, ['b', 'c'], '관리자가 아닌 시험 계정은 짚지 않는다')
})

test('실제 사람 이름과 회사 메일은 시험 계정이 아니다', () => {
  assert.equal(looksLikeTestAccount('contest@data-alliance.com', '홍길동'), false)
  assert.equal(looksLikeTestAccount('f10-nocrm@test.co.kr', null), true)
})

test('★ 시험 계정 스크립트는 운영 확인 없이 안 돌고, 관리자는 어떤 경우에도 못 만든다', () => {
  assert.match(testAccountRunError([], 'member') ?? '', /--confirm-production/)
  assert.equal(testAccountRunError(['--confirm-production'], 'member'), null)
  assert.match(testAccountRunError(['--confirm-production'], 'admin') ?? '', /관리자/)
})
