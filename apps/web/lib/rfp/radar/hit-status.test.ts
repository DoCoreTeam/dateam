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
  isHitStatus, isUserSettable, listStatusOf,
} from './hit-status.ts'

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
