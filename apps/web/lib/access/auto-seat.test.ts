/**
 * 접근권한으로 자동으로 앉는 자리 — 등급과 기록을 잠근다
 *
 * **왜 이 시험이 필요한가** (실측 2026-09-22)
 *
 *   ① 자동 경로가 `READONLY` 로 앉혔다. 그래서 아홉 명 중 여덟이 보기만이 됐고
 *      화면마다 「이 작업을 할 권한이 없습니다」가 떴다. 문은 열렸는데 안에서 아무것도 못 했다.
 *   ② 자리를 만들면서 **기록을 안 남겼다.** 아홉 명이 들어와 있는데 `crm_audit_log` 의
 *      마지막 멤버 기록은 08-16 이었다. 누가 언제 들어왔는지 물을 자리가 없었다.
 *
 * 둘 다 「고치면 끝」이 아니다. 다음 사람이 「보라고 열어 준 것이니 READONLY 가 맞지」로
 * 되돌리면 같은 일이 그대로 재발하고, 그때도 화면은 멀쩡해 보인다. 그래서 센다.
 *
 * **이름이 아니라 값을 본다.** 소스에서 'MEMBER' 라는 글자를 찾는 식이면 주석에만 있어도
 * 통과한다(이 저장소에서 CSP 가드가 실제로 그렇게 통과한 적이 있다). 등급은 모듈에서
 * **import 해 대조하고**, 호출 자리는 주석을 지운 뒤에 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEAT_ROLE, SEAT_ROLE_FORBIDDEN } from './seat-role.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const ACTIONS = join(HERE, '..', '..', 'app', 'admin', 'access', 'actions.ts')

/** 주석을 지운다 — 주석에 남은 글자가 가드를 통과시키면 가드가 아니다 */
function code(): string {
  return readFileSync(ACTIONS, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

test('자동으로 앉는 등급은 쓸 수 있는 등급이다', () => {
  // 값 자체를 본다. 소스에서 글자를 찾는 것이 아니다
  assert.equal(SEAT_ROLE, 'MEMBER',
    '자동 자리가 보기만 이면 문은 열렸는데 안에서 아무것도 못 한다')
  assert.ok(!SEAT_ROLE_FORBIDDEN.includes(SEAT_ROLE),
    'SEAT_ROLE 이 금지 목록에 있다 — 둘 중 하나가 틀렸다')
})

test('자동 경로가 등급을 리터럴로 박지 않고 상수를 쓴다', () => {
  const src = code()
  // 자리를 만드는 객체에 role 을 넣는 줄이 상수를 참조하는가
  assert.match(src, /role:\s*SEAT_ROLE\b/,
    '등급을 리터럴로 박으면 값을 바꿔도 이 시험이 못 잡는다')

  for (const banned of SEAT_ROLE_FORBIDDEN) {
    assert.ok(!new RegExp(`role:\\s*['"]${banned}['"]`).test(src),
      `자동 경로가 role: '${banned}' 로 되돌아갔다`)
  }
})

test('이미 자리가 있는 사람은 등급을 안 덮는다', () => {
  const src = code()
  // 이미 앉은 사람을 걸러 내는 단계가 있어야 한다. 없으면 upsert 로 등급이 내려간다
  assert.match(src, /const\s+missing\s*=/,
    '이미 앉은 사람을 거르는 단계가 없다')
  assert.match(src, /\.from\(['"]crm_member['"]\)\.insert\(/,
    'crm_member 는 insert 여야 한다 — upsert 면 올려 둔 권한이 조용히 내려간다')
  assert.ok(!/\.from\(['"]crm_member['"]\)\.upsert\(/.test(src),
    'crm_member 에 upsert 를 쓰면 기존 등급을 덮는다')
})

test('자리를 만들면 기록을 남긴다', () => {
  const src = code()
  assert.match(src, /\.from\(['"]crm_audit_log['"]\)\.insert\(/,
    '자리를 만들고 crm_audit_log 에 안 남기면 누가 언제 들어왔는지 알 수 없다')
  assert.match(src, /action:\s*['"]member\.added['"]/,
    '사람이 추가하는 경로와 같은 이름(member.added)으로 남겨야 대조가 된다')
  // supabase-js 는 insert 오류를 던지지 않고 돌려준다 — 안 보면 조용히 0건이 된다
  assert.match(src, /auditError/,
    '기록 insert 의 오류를 받지 않으면 실패를 아무도 모른다')
})

test('기록이 실패해도 자리는 되돌리지 않는다', () => {
  const src = code()
  // 감사가 업무 저장을 막으면 안 된다 — 자리가 없으면 사람이 못 들어온다
  const auditBlock = src.slice(src.indexOf('crm_audit_log'))
  assert.ok(!/if\s*\(\s*auditError\s*\)\s*throw/.test(auditBlock),
    '기록 실패로 던지면 이미 만든 자리가 되돌아가고 문만 열린 상태가 된다')
})

test('누가 열었는지가 기록에 남는다', () => {
  const src = code()
  assert.match(src, /grantedBy/,
    '부여를 저장한 사람이 기록에 안 남으면 자동 자리의 출처를 모른다')
  assert.match(src, /ensureServiceSeat\(input,\s*actorId\)/,
    '호출부가 관리자 신원을 안 넘기면 기록에 넣을 값이 없다')
})
