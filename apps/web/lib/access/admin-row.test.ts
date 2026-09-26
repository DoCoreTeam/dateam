/**
 * 관리자 줄 — **부여 0건이 「아무도 안 들어간다」로 읽히지 않게**
 *
 * **왜** (실측 2026-09-26): 관리자가 접근권한 화면을 열고 「부여가 아직 없어요」를 봤다.
 *   그 표면에 관리자 자신은 이미 들어가고 있었는데 화면은 그 사실을 한 글자도 안 말했다.
 *   판정 1번(`decide.ts`)이 관리자를 맨 먼저 통과시키기 때문이고, 그 통과는
 *   `access_grant` 에 줄이 없다. 그래서 관리자는 자기에게 부여를 하나 더 만들려 했다 —
 *   아무것도 안 바꾸는 줄이다.
 *
 * 이 가드가 지키는 것은 셋이다.
 *
 * 1. 그 줄이 **역할**에서 나온다 — 부여를 심어 흉내 내지 않는다
 * 2. 지울 수 없다 — 지울 대상이 없는데 단추를 두면 눌러 놓고 아무 일도 안 난다
 * 3. 부여 0건인 표면도 그 줄을 그린다 — 빈 상태로 대신하지 않는다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decideAccess } from './decide.ts'
import { SURFACES } from './surfaces.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(WEB, rel), 'utf8')

const CLIENT = 'app/admin/access/AccessClient.tsx'
const ACTIONS = 'app/admin/access/actions.ts'

test('관리자는 부여가 0건이어도 표면을 지난다 — 화면이 말하려는 그 사실', () => {
  const admin = { userId: 'admin-1', isAdmin: true, orgIds: [] }
  const member = { userId: 'member-1', isAdmin: false, orgIds: [] }

  for (const s of SURFACES) {
    assert.equal(
      decideAccess(s.key, admin, []).allowed,
      true,
      `${s.key} 에서 관리자가 막힌다 — 이 줄이 말하는 사실이 더 이상 사실이 아니다`,
    )
  }

  // 그리고 그 통과는 부여에서 온 것이 아니다. 같은 조건의 일반 사용자는 관리자 전용 표면에서 막힌다
  const adminOnly = SURFACES.filter((s) => s.defaultAudience === 'admin')
  assert.ok(adminOnly.length > 0, '관리자 전용 표면이 하나도 없다 — 대조가 안 선다')
  for (const s of adminOnly) {
    assert.equal(decideAccess(s.key, member, []).allowed, false, `${s.key} 가 부여 없이 일반 사용자에게 열렸다`)
  }
})

test('관리자 목록은 역할에서 나온다 — 부여 표를 읽지 않는다', () => {
  const src = read(ACTIONS)

  assert.match(src, /admins: AdminOption\[\]/, '화면으로 넘기는 자리에 관리자 목록이 없다')
  assert.match(src, /select\('id, name, role'\)/, 'profiles 에서 role 을 안 읽는다')
  assert.match(src, /\.is\('deleted_at', null\)/, '지워진 사람도 관리자 줄에 선다')

  const line = src.split('\n').find((l) => l.includes("p.role === 'admin'"))
  assert.ok(line, "관리자를 role === 'admin' 으로 고르는 자리가 없다")
  assert.doesNotMatch(
    line,
    /access_grant/,
    '관리자 줄을 부여 표에서 만든다 — 역할이 바뀌는 날 두 곳이 갈린다',
  )
})

test('관리자 줄은 저장되지 않는다 — 부여를 심어 흉내 내지 않는다', () => {
  const src = read(ACTIONS)
  /**
   * 부여를 심으면 역할과 부여가 같은 것을 두 곳에서 말하게 되고,
   * 역할이 member 로 바뀐 날 그 부여만 남아 **실제로 열린 문**이 된다.
   */
  const insertsForAdmins = /admins[\s\S]{0,300}?from\('access_grant'\)[\s\S]{0,200}?\.(insert|upsert)\(/.test(src)
  assert.equal(insertsForAdmins, false, '관리자 줄을 access_grant 에 저장한다')
})

test('화면이 그 줄을 맨 위에 그리고, 삭제 단추를 안 붙인다', () => {
  const src = read(CLIENT)

  assert.match(src, /admins\.map\(\(a\) => a\.name\)\.join/, '관리자 이름을 안 그린다')
  assert.match(src, /ACCESS_ADMIN_ALWAYS/, '역할로 지난다는 문구가 없다')

  /**
   * 부여 목록 안에서 관리자 줄이 **먼저** 나와야 한다.
   *
   * 이름만 찾으면 맨 위의 **import 줄**이 잡힌다 — 실제로 처음엔 그렇게 짚어서
   * 부여 줄의 삭제 단추를 관리자 줄의 것으로 읽었다. 그리는 자리를 짚는다.
   */
  const adminRow = src.indexOf('{ACCESS_ADMIN_SOURCE}')
  const grantRow = src.indexOf('{mine.map((g) => (')
  assert.ok(adminRow > -1 && grantRow > -1, '두 줄 중 하나를 못 찾았다')
  assert.ok(adminRow < grantRow, '관리자 줄이 부여 줄보다 아래에 있다')

  /**
   * 관리자 줄 안에 삭제 단추가 없어야 한다. 줄 하나를 통째로 떼어 본다 —
   * 파일 전체에서 「Trash2 가 있다/없다」를 세면 부여 줄의 단추와 구분이 안 된다.
   */
  const block = src.slice(adminRow, grantRow)
  assert.doesNotMatch(block, /Trash2|ACTION\.delete|remove\(/, '관리자 줄에 삭제 단추가 붙었다 — 지울 대상이 없다')
})

test('부여 0건인 표면도 빈 상태가 아니라 이 줄을 그린다', () => {
  const src = read(CLIENT)
  /**
   * 예전엔 `mine.length === 0` 이면 빈 상태를 그렸다. 그 화면이 「아무도 안 들어간다」로
   * 읽혔다 — 목록이 비어 있어도 관리자 줄은 서야 한다.
   */
  assert.doesNotMatch(src, /mine\.length === 0/, '부여 0건을 아직 빈 상태로 그린다')
  assert.doesNotMatch(src, /EmptyState/, '부여 목록 자리에 빈 상태가 남아 있다')
})
