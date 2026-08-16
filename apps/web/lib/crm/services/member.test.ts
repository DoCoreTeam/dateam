// 멤버 (dacrm)
//
// **왜 이 가드가 있는가**: 호스트에 32명이 있는데 CRM 멤버는 1명이었다 —
// 들일 화면이 없어서 나머지 31명은 영영 못 들어오는 상태였다.
// 화면을 붙이자 실브라우저에서 결함 하나가 더 나왔다:
// 내보낸 사람을 다시 들이면 **200 인데 아무 일도 일어나지 않았다.**
// 가드가 조회에 `deletedAt: null` 을 자동 주입해서 삭제된 행을 못 찾은 것이다.
//
// 여기서 잠그는 것 둘.
//   ① 관리자가 0명이 되는 상태를 만들 수 없다 (되돌리려면 DB 를 직접 고쳐야 한다)
//   ② 되살리기가 실제로 되살린다 (새로 만들면 같은 사람이 둘이 되고 감사 기록이 갈린다)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { ROLES, ROLE_LABEL, ROLE_HINT } from './member.ts'

const SRC = readFileSync(new URL('./member.ts', import.meta.url), 'utf8')

test('권한 4종에 사람이 읽는 이름과 설명이 있다 — READONLY 라고 적으면 개발자 말이다', () => {
  assert.deepEqual(ROLES, ['OWNER', 'ADMIN', 'MEMBER', 'READONLY'])
  for (const r of ROLES) {
    assert.ok(ROLE_LABEL[r], `${r} 이름 없음`)
    assert.ok(ROLE_HINT[r] && ROLE_HINT[r].length > 5, `${r} 설명 없음`)
    assert.ok(!/[A-Z]{3,}/.test(ROLE_LABEL[r]), `${r} 이름이 코드처럼 보인다`)
  }
})

test('★ 마지막 관리자를 강등할 수 없다 — 되면 아무도 설정을 못 바꾸고 DB 를 직접 고쳐야 한다', () => {
  assert.ok(SRC.includes('countAdmins'), '남은 관리자를 세지 않는다')
  const at = SRC.indexOf('export async function changeMemberRole')
  const body = SRC.slice(at, SRC.indexOf('export async function removeMember'))
  assert.ok(body.includes('countAdmins(tx, memberId)'), '강등 전에 관리자 수를 세지 않는다')
  assert.ok(body.includes('마지막 관리자'), '막았을 때 이유를 말하지 않는다')
})

test('★ 마지막 관리자를 내보낼 수 없다', () => {
  const body = SRC.slice(SRC.indexOf('export async function removeMember'))
  assert.ok(body.includes('countAdmins(tx, memberId)'), '내보내기 전에 관리자 수를 세지 않는다')
  assert.ok(body.includes('마지막 관리자'), '막았을 때 이유를 말하지 않는다')
})

test('관리자 판정에 OWNER 와 ADMIN 이 둘 다 들어간다 — 하나만 세면 소유자만 남아도 잠긴다', () => {
  assert.ok(SRC.includes("new Set<CrmRole>(['OWNER', 'ADMIN'])"), '관리 권한 집합이 좁다')
})

test('★ 되살리기는 삭제된 행을 명시해서 찾는다 — 안 하면 200 인데 아무 일도 안 일어난다(실측)', () => {
  assert.ok(
    SRC.includes("where: { id: existing.id, deletedAt: { not: null } }"),
    '되살리기가 삭제된 행을 명시하지 않는다',
  )
  assert.ok(SRC.includes('revived.count === 0'), '되살리기가 실패해도 성공으로 응답한다')
})

test('★ 이미 있던 사람은 새로 만들지 않고 되살린다 — 둘이 되면 감사 기록이 갈린다', () => {
  const body = SRC.slice(SRC.indexOf('export async function addMember'))
  assert.ok(body.includes('deletedAt: undefined'), '삭제된 사람을 찾지 않는다')
  assert.ok(body.indexOf('if (existing)') < body.indexOf('crmMember.create'), '되살리기보다 생성이 먼저다')
})

test('내보내기는 소프트 삭제다 — 지우면 "누가 한 것인가"가 통째로 빈칸이 된다', () => {
  const body = SRC.slice(SRC.indexOf('export async function removeMember'))
  assert.ok(body.includes('deletedAt: new Date()'), '소프트 삭제가 아니다')
  assert.ok(!body.includes('.delete('), '영구 삭제를 한다')
})

test('모르는 권한은 거부한다 — 주소창으로 아무 문자열이나 들어온다', () => {
  assert.ok(SRC.includes('function assertRole('), '권한 검증이 없다')
  assert.ok(SRC.includes('알 수 없는 권한입니다'), '거부 이유를 말하지 않는다')
})

test('★ 멤버 변경은 관리자만 — 화면에서만 숨기면 API 로 새어 나간다', () => {
  const list = readFileSync(new URL('../../../app/api/crm/members/route.ts', import.meta.url), 'utf8')
  assert.ok(list.includes("withCrmApi('ADMIN'"), '들이기가 ADMIN 게이트를 안 거친다')
  const one = readFileSync(new URL('../../../app/api/crm/members/[id]/route.ts', import.meta.url), 'utf8')
  assert.ok(one.includes("withCrmApi('ADMIN'"), '권한 변경·내보내기가 ADMIN 게이트를 안 거친다')
})

test('★ 화면이 후보 목록을 받는다 — 관리자가 이름을 외워서 입력할 수는 없다', () => {
  const api = readFileSync(new URL('../../../app/api/crm/members/route.ts', import.meta.url), 'utf8')
  assert.ok(api.includes('candidates'), '아직 안 들인 사람을 주지 않는다')
  const ui = readFileSync(new URL('../../../app/(crm)/crm/members/MembersClient.tsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('candidates.map('), '화면이 후보를 그리지 않는다')
})
