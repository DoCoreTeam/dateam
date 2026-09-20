/**
 * 관리자 행위와 로그인 실패가 실제로 기록되는지 본다
 *
 * **왜**: 감사 장치는 이미 다 있었는데(fn_audit · 여섯 표 행위자 100%)
 *   **구성원 표만 안 물려 있었다.** 그래서 역할 변경·2단계 해제가 아무 데도 안 남았다.
 *   이런 종류는 **지워도 화면이 멀쩡하다.** 그래서 여기서 센다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ADMIN_ACTION_LABEL, type AdminAction } from './admin-audit-labels.ts'
import { maskEmail } from './mask-email.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOT = join(WEB, '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

/** 기록해야 하는 관리자 행위와, 그 일을 하는 함수 */
const MUST_LOG: { action: AdminAction; fn: string }[] = [
  { action: 'role_change', fn: 'changeRole' },
  { action: 'user_delete', fn: 'deleteUser' },
  { action: 'password_reset', fn: 'resetUserPassword' },
  { action: 'mfa_reset', fn: 'resetUserMfa' },
  { action: 'member_resign', fn: 'resignMember' },
  { action: 'member_unresign', fn: 'undoResignMember' },
  { action: 'user_invite', fn: 'inviteUser' },
]

/** `export async function foo` 부터 다음 선언 직전까지 */
function bodyOf(src: string, fn: string): string {
  const marks = [...src.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)]
  const i = marks.findIndex((m) => m[1] === fn)
  assert.ok(i >= 0, `${fn} 을 못 찾았다`)
  const end = i + 1 < marks.length ? marks[i + 1].index : src.length
  return src.slice(marks[i].index, end)
}

test('관리자 행위 일곱 가지가 전부 기록을 남긴다', () => {
  const src = read('app/admin/users/actions.ts')
  const missing: string[] = []
  for (const { action, fn } of MUST_LOG) {
    const body = bodyOf(src, fn)
    // 부르는 자리를 본다 — import 만 남아도 통과하면 안 된다
    if (!/await logAdminAction\(/.test(body)) missing.push(`${fn} (기록 호출 없음)`)
    else if (!body.includes(`'${action}'`)) missing.push(`${fn} (행위 이름이 ${action} 이 아님)`)
  }
  assert.deepEqual(
    missing,
    [],
    `기록을 안 남기는 관리자 행위\n  ${missing.join('\n  ')}\n\n` +
      `지우면 그 일이 있었다는 사실 자체가 어디에도 안 남는다.`,
  )
})

test('관리자 서버 액션은 로그인만으로 부를 수 없다', () => {
  // 서버 액션은 화면 게이트가 안 막는다 — 주소만 알면 로그인한 누구나 부른다.
  // 실측 2026-09-20: inviteUser 와 api-access 승인 둘이 이 확인 없이 계정을 만들고 있었다.
  const GATE = /requireAdmin|requireAdminApi|requireApiAccessAdmin/
  const files = ['app/admin/users/actions.ts', 'app/admin/api-access/actions.ts', 'app/admin/settings/actions.ts']
  const open: string[] = []
  for (const f of files) {
    const src = read(f)
    const marks = [...src.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)]
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].index : src.length
      const body = src.slice(marks[i].index, end)
      // 얇은 위임 함수(한 줄로 다른 함수를 부름)는 그쪽이 확인한다
      const delegates = /^\s*return [a-zA-Z]+\(/m.test(body) && body.split('\n').length < 6
      if (!GATE.test(body) && !delegates) open.push(`${f.replace('app/', '')}: ${marks[i][1]}`)
    }
  }
  assert.deepEqual(open, [], `관리자 확인이 없는 서버 액션\n  ${open.join('\n  ')}`)
})

test('관리자 2단계 필수가 켜지면 실제로 강제된다', () => {
  // 읽는 코드만 있고 켜는 자리도 막는 자리도 없던 반쪽을 메웠다.
  // 강제는 **레이아웃**에 둔다 — 미들웨어에 두면 요청마다 profiles 조회가 하나 는다(가드가 막음).
  const gate = read('lib/auth/api-user-gate.ts')
  assert.match(gate, /export async function requireAdminMfa/, '강제하는 함수가 없다')
  assert.match(gate, /redirect\('\/security\?enroll=required'\)/, '보낼 곳이 없으면 관리자가 갇힌다')
  for (const open of ["'/security'", "'/mfa'", "'/change-password'"]) {
    assert.ok(gate.includes(open), `${open} 을 빼지 않으면 등록하러 갈 길이 막힌다`)
  }

  const layouts = ['app/(member)/layout.tsx', 'app/admin/layout.tsx', 'app/(crm)/layout.tsx',
                   'app/(ci)/layout.tsx', 'app/(ai)/layout.tsx', 'app/(rfp)/layout.tsx']
  const missing = layouts.filter((f) => !/await requireAdminMfa\(/.test(read(f)))
  assert.deepEqual(missing, [], `게이트를 안 부르는 레이아웃\n  ${missing.join('\n  ')}`)

  // 켜는 자리
  assert.match(read('app/admin/settings/actions.ts'), /export async function saveMfaRequiredForAdmin/,
    '켤 자리가 없으면 켜고 싶어도 못 켠다')
  assert.match(read('app/admin/settings/page.tsx'), /<MfaPolicySettings/, '화면이 안 부르면 스위치가 없는 것이다')
})

test('로그인 실패를 세고 남긴다', () => {
  const src = read('app/(auth)/login/actions.ts')
  assert.match(src, /await throttleLoginAttempt\(\)/, '시도를 안 세면 몇 번 찔렸는지 모른다')
  assert.match(src, /await logLoginFailure\(/, '실패를 안 남기면 그런 일이 있었는지도 모른다')

  // 문자열을 jsonb 칼럼에 넣으면 죽는다(실측)
  assert.ok(
    !/error_detail: input\.errorDetail \?\? null/.test(read('lib/auth/admin-audit.ts')),
    'error_detail 은 jsonb 다 — 문자열을 그대로 넣으면 기록이 통째로 죽는다',
  )

  const lib = read('lib/auth/login-attempts.ts')
  // activity_log 는 user_id·actor_id 가 NOT NULL 이라 «누구인지 모르는 실패»를 못 담는다.
  // 그래서 시스템 로그에 남긴다 — 조용히 0건이 되던 것을 실측으로 잡았다.
  assert.match(lib, /recordSystemEvent\(/, '로그인 실패는 시스템 로그에 남긴다')
  assert.ok(!/from\('activity_log'\)/.test(lib), 'activity_log 는 NOT NULL 때문에 조용히 실패한다')
  // 이메일 기준으로 세면 남의 계정을 골라 잠글 수 있다
  assert.ok(
    !/limit:[^}]*email/i.test(lib) && /throttlePublicRequest\('login'/.test(lib),
    '한도는 보낸 곳 기준이어야 한다 — 이메일 기준이면 남을 잠글 수 있다',
  )
  assert.match(lib, /maskEmail/, '기록이 계정 목록이 되면 안 된다')
})

test('이메일을 가려도 누구인지 짐작은 된다', () => {
  assert.equal(maskEmail('michaelkim@data-alliance.com'), 'mi********@data-alliance.com')
  assert.equal(maskEmail('ab@x.com'), 'ab*@x.com')
  assert.equal(maskEmail('없는형식'), '(형식 아님)')
})

test('구성원 표가 감사 장치에 물려 있다', () => {
  const dir = join(ROOT, 'supabase', 'migrations')
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
  assert.match(
    sql,
    /CREATE TRIGGER trg_audit[\s\S]{0,120}ON public\.profiles/,
    '구성원 표에 트리거가 없으면 앱 밖에서 바뀐 것을 아무도 모른다',
  )
  assert.match(sql, /'admin_users'/, "activity_log 의 module 목록에 admin_users 가 없으면 기록이 제약에 걸려 죽는다")
  assert.match(sql, /'auth'/, "module 목록에 auth 가 없으면 로그인 실패 기록이 죽는다")
})

test('행위 이름과 화면 문구가 짝이다', () => {
  for (const { action } of MUST_LOG) {
    assert.ok(ADMIN_ACTION_LABEL[action], `${action} 의 화면 문구가 없다`)
  }
})
