/**
 * 적중 상태 가드
 *
 * 코드가 표에 없는 상태값을 쓰면 supabase-js 는 **던지지 않고 돌려준다.**
 * 그래서 틀린 값은 오류가 아니라 「아무 일도 안 일어남」으로 보인다 —
 * 실측 2026-09-30: markAdopted 가 그랬고 적중 51행이 전부 new 로 남아 있었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'
import {
  HIT_STATUS, HIT_STATUSES, DEFAULT_LIST_STATUS, USER_SETTABLE,
  isHitStatus, isUserSettable, listStatusOf, checkBulk, MAX_BULK,
} from './hit-status.ts'

const UUID_A = '11111111-2222-4333-8444-555555555555'
const UUID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const WEB = new URL('../../../', import.meta.url)
const ROOT = new URL('../../../../../', import.meta.url)

test('상태 낱말이 표의 CHECK 제약과 한 벌이다', () => {
  // 코드에만 있고 표에 없는 낱말은 쓰는 순간 조용히 실패한다
  const sql = readFileSync(
    new URL('supabase/migrations/301_rfp_radar_hit_adopted.sql', ROOT), 'utf8',
  ).replace(/^\s*--.*$/gm, '')
  const inSql = [...sql.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]).sort()
  assert.deepEqual([...HIT_STATUSES].sort(), inSql, '코드 낱말과 표 제약이 어긋난다')
})

test('아는 상태만 상태로 본다', () => {
  for (const s of HIT_STATUSES) assert.equal(isHitStatus(s), true)
  for (const v of ['없는값', '', null, undefined, 3, {}]) assert.equal(isHitStatus(v), false)
})

test('사람이 바꿀 수 있는 것은 빼기와 되돌리기뿐이다', () => {
  // adopted 는 담기 경로가 정한다. 화면이 지어내면 케이스도 없이 케이스가 된 척하는 줄이 생긴다
  assert.deepEqual([...USER_SETTABLE].sort(), ['dismissed', 'new'])
  assert.equal(isUserSettable(HIT_STATUS.dismissed), true)
  assert.equal(isUserSettable(HIT_STATUS.new), true)
  assert.equal(isUserSettable(HIT_STATUS.adopted), false, '화면이 케이스 상태를 지어낼 수 있다')
  assert.equal(isUserSettable(HIT_STATUS.opened), false)
})

test('모르는 목록 상태는 기본값으로 떨어진다', () => {
  // 주소창에 아무 글자나 넣었다고 빈 목록을 보여 주면 사용자는 「공고가 없다」로 읽는다
  assert.equal(listStatusOf('없는값'), DEFAULT_LIST_STATUS)
  assert.equal(listStatusOf(undefined), DEFAULT_LIST_STATUS)
  assert.equal(listStatusOf(HIT_STATUS.dismissed), HIT_STATUS.dismissed)
  assert.equal(DEFAULT_LIST_STATUS, HIT_STATUS.new)
})

test('한 건 창구가 권한 판정을 표에 맡기고 서비스롤을 안 쓴다', () => {
  const src = stripComments(readFileSync(
    new URL('app/api/rfp/radar/hits/[id]/route.ts', WEB), 'utf8'))

  assert.match(src, /requireMemberApi\s*\(/, '로그인 확인이 없다')
  // 서비스롤을 쓰면 표 정책을 통째로 지나가고, 그러면 남의 조직 적중도 바꿀 수 있다
  assert.doesNotMatch(src, /createAdminClient/, '창구가 서비스롤을 쓴다')
  // 아는 상태만 받는다
  assert.match(src, /isUserSettable\s*\(/, '모르는 상태값을 안 거른다')
  // 있는지 없는지를 대답으로 알려 주면 남의 조직 적중이 있는지 물어볼 수 있게 된다
  assert.doesNotMatch(src, /남의 조직|다른 조직의/, '없음과 권한 없음을 갈라 말한다')
})

test('상태값을 손으로 적은 자리가 없다', () => {
  // 손으로 적으면 표에 없는 값을 또 쓸 수 있고 그 실패는 조용하다
  for (const rel of [
    'app/api/rfp/radar/hits/[id]/route.ts',
    'lib/rfp/intake/adopt-ports.ts',
  ]) {
    const src = stripComments(readFileSync(new URL(rel, WEB), 'utf8'))
    assert.doesNotMatch(src, /status:\s*'(new|opened|dismissed|adopted)'/, `${rel} 가 상태값을 손으로 적었다`)
  }
})

// 한 번에 바꾸기 — I05

test('고른 것이 없으면 거절한다', () => {
  assert.deepEqual(checkBulk([], 'dismissed'), { ok: false, ids: [], reason: 'empty' })
  assert.equal(checkBulk(null, 'dismissed').reason, 'empty')
})

test('바꿀 수 없는 상태는 거절한다', () => {
  assert.equal(checkBulk([UUID_A], 'adopted').reason, 'bad_status')
  assert.equal(checkBulk([UUID_A], '없는값').reason, 'bad_status')
})

test('uuid 가 아닌 것은 조용히 버리지 않고 걸러 센다', () => {
  // 조용히 버리면 열 개를 골랐는데 여덟 개만 바뀌고 화면은 열 개가 바뀐 것처럼 보인다
  const r = checkBulk([UUID_A, 'not-a-uuid', UUID_B, 42, null], 'dismissed')
  assert.deepEqual(r.ids, [UUID_A, UUID_B])
  assert.equal(r.ok, true)
})

test('같은 id 를 두 번 골라도 한 번만 센다', () => {
  assert.deepEqual(checkBulk([UUID_A, UUID_A], 'dismissed').ids, [UUID_A])
})

test('상한을 넘으면 몇 개까지인지 말한다', () => {
  // 상한이 없으면 「전부 고르기」가 수천 건을 한 요청에 싣고 그 요청은 타임아웃으로 죽는다.
  // 죽으면 일부만 바뀐 채로 끝나고 사용자는 무엇이 바뀌었는지 모른다
  const many = Array.from({ length: MAX_BULK + 1 }, (_, i) =>
    `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`)
  const r = checkBulk(many, 'dismissed')
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'too_many')

  const exact = many.slice(0, MAX_BULK)
  assert.equal(checkBulk(exact, 'dismissed').ok, true, '딱 상한만큼은 받아야 한다')
})

test('한 번에 바꾸기 창구도 표 정책에 판정을 맡긴다', () => {
  // import 줄을 함께 지운다 — 이름만 찾으면 들여오기만 남아도 통과한다(실제로 그랬다)
  const src = noImports(stripComments(readFileSync(new URL('app/api/rfp/radar/hits/route.ts', WEB), 'utf8')))
  assert.match(src, /requireMemberApi\s*\(/, '로그인 확인이 없다')
  assert.doesNotMatch(src, /createAdminClient/, '창구가 서비스롤을 쓴다')
  assert.match(src, /checkBulk\s*\(/, '넘어온 목록을 안 거른다')
  // 고른 수와 바뀐 수가 다를 수 있다. 안 세면 화면이 전부 바뀐 것처럼 보인다
  assert.match(src, /failed:/, '못 바꾼 수를 안 돌려준다')
  assert.match(src, /\$\{MAX_BULK\}/, '몇 개까지인지 안 말한다')
})


/** import 줄을 지운다. 이름만 찾는 가드는 들여오기만 남아도 통과한다 */
function noImports(src: string): string {
  return src.replace(/^[ \t]*import\s[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm, '')
}
