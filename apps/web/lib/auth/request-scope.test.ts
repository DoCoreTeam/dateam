// lib/auth/request-scope.test.ts — 인증 결과 캐시가 **요청 밖으로 새지 않도록** 지킨다
//
// 왜 이 가드가 필요한가:
//   getRequestUser()는 "같은 요청 안에서 같은 질문을 반복하지 않기" 위해 React의 cache()를 쓴다.
//   cache()는 요청 스코프라 요청이 끝나면 사라진다 — 그래서 안전하다.
//
//   위험한 건 이걸 "더 최적화"하려는 다음 사람이다. 모듈 레벨 변수나 Map으로 바꾸는 순간
//   **프로세스가 살아 있는 동안 사용자가 공유된다.** A가 로그인한 뒤 B의 요청이 A로 처리되고,
//   로그아웃해도 반영되지 않는다. 화면에서는 멀쩡해 보이므로 발견이 매우 늦다.
//
//   그래서 이 가드는 "cache()로 감싸져 있고, 모듈 레벨 저장소가 없다"를 정적으로 못 박는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SERVER = 'lib/supabase/server.ts'

function read(): string {
  return readFileSync(SERVER, 'utf8')
}

test('getRequestUser는 react의 cache()로 감싼다 (요청 스코프)', () => {
  const src = read()
  assert.match(
    src,
    /import \{[^}]*\bcache\b[^}]*\} from 'react'/,
    "react의 cache를 import하지 않았다 — 요청 스코프가 아니게 된다",
  )
  assert.match(
    src,
    /export const getRequestUser = cache\(/,
    'getRequestUser가 cache()로 감싸져 있지 않다. 그냥 함수로 두면 중복 왕복이 돌아오고,\n' +
      '수동 캐시로 바꾸면 요청 사이에 사용자가 섞인다.',
  )
})

test('요청 사이에 답을 들고 있는 모듈 레벨 저장소를 두지 않는다', () => {
  const src = read()
  // let/var 모듈 레벨 변수, 혹은 Map/WeakMap 캐시 — 요청을 넘어 살아남는 것들
  const moduleLevelMutable = /^(?:let|var)\s+\w+/m
  const manualCache = /new (?:Map|WeakMap)\(\)|globalThis\.\w*[Cc]ache/
  assert.equal(
    moduleLevelMutable.test(src),
    false,
    '모듈 레벨 가변 변수가 있다 — 인증 결과가 요청을 넘어 살아남을 수 있다',
  )
  assert.equal(
    manualCache.test(src),
    false,
    '수동 캐시(Map/globalThis)가 있다 — 프로세스가 사는 동안 사용자가 공유된다',
  )
})

test('인증 헬퍼는 스스로 getUser를 다시 부르지 않고 getRequestUser를 쓴다', () => {
  const offenders: string[] = []
  for (const f of ['lib/auth/requireAdmin.ts', 'lib/auth/requireAdminApi.ts', 'lib/auth/requireMemberApi.ts']) {
    const src = readFileSync(f, 'utf8')
    if (/auth\.getUser\(\)/.test(src)) offenders.push(f)
  }
  assert.deepEqual(
    offenders,
    [],
    `헬퍼가 인증 서버에 직접 다시 묻고 있다(요청당 왕복 중복). getRequestUser()를 쓴다:\n  ${offenders.join('\n  ')}`,
  )
})
