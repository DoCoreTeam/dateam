// lib/policy/access-surface.test.ts — 화면을 새로 만들고 **등재를 잊는 것**을 커밋 전에 잡는다
//
// 왜: 접근권한은 등재부(`lib/access/surfaces.ts`)에 붙은 화면만 다룬다.
//   등재를 잊으면 그 화면은 관리자 화면에 안 뜨고, 아무도 열어 줄 수 없고,
//   `decideAccess` 는 fail-closed 라 **아무 표시 없이 안 보인다.**
//   빠뜨린 쪽이 알아채는 유일한 순간이 사용자 문의가 되는 구조라 여기서 막는다.
//
// 무엇을 세나: `app` 아래 `page.tsx` 전수. 하나라도 표면에도 면제 목록에도 없으면 실패한다.
//
// 면제는 **사유와 함께**만 된다(`NOT_A_SURFACE`). 사유 없는 면제는 등재를 잊은 것과 구분되지 않는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { surfaceOf, NOT_A_SURFACE, SURFACES } from '../access/surfaces.ts'

/** apps/web/lib/policy → apps/web */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const APP = join(WEB, 'app')

/** `app/(member)/pricing/gpu/page.tsx` → `/pricing/gpu`. 라우트 그룹 `(x)` 는 주소에 안 나온다 */
function routeOf(dir: string): string {
  const rel = dir.slice(APP.length).split('/').filter(Boolean)
  const segments = rel.filter((s) => !(s.startsWith('(') && s.endsWith(')')))
  return '/' + segments.join('/')
}

function pageRoutes(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      // api 는 화면이 아니다 — 창구 권한은 lib/policy/api-auth-surface.test.ts 가 본다
      if (name === 'api') continue
      pageRoutes(full, found)
    } else if (name === 'page.tsx') {
      found.push(routeOf(dir))
    }
  }
  return found
}

const ROUTES = [...new Set(pageRoutes(APP))].sort()

test('화면을 세는 일 자체가 되고 있다', () => {
  // 걷기가 조용히 0건이 되면 아래 단정이 전부 통과해 버린다 — 실패 0 과 안 도는 것이 같아 보인다
  assert.ok(ROUTES.length > 50, `page.tsx 를 ${ROUTES.length}개만 찾았다, 걷기가 깨졌다`)
})

test('모든 화면이 표면에 붙거나 사유와 함께 면제된다', () => {
  const orphans = ROUTES.filter((r) => !surfaceOf(r) && !(r in NOT_A_SURFACE))
  assert.deepEqual(
    orphans, [],
    `등재부에 없는 화면: ${orphans.join(', ')}\n` +
    'lib/access/surfaces.ts 의 SURFACES 에 표면을 더하거나, 표면이 아니면 NOT_A_SURFACE 에 사유와 함께 적는다',
  )
})

test('면제 목록에 사유가 비어 있지 않다', () => {
  for (const [route, reason] of Object.entries(NOT_A_SURFACE)) {
    assert.ok(reason.trim().length >= 10, `${route}: 면제 사유가 너무 짧다`)
  }
})

test('면제 목록에 이제 없는 화면이 남아 있지 않다', () => {
  const stale = Object.keys(NOT_A_SURFACE).filter((r) => !ROUTES.includes(r))
  assert.deepEqual(stale, [], `사라진 화면이 면제 목록에 남아 있다: ${stale.join(', ')}`)
})

test('면제와 표면이 같은 경로를 두고 다투지 않는다', () => {
  const both = Object.keys(NOT_A_SURFACE).filter((r) => SURFACES.some((s) => s.href === r))
  assert.deepEqual(both, [], `표면이면서 면제로도 적힌 경로: ${both.join(', ')}`)
})

test('등재된 표면의 주소에 실제 화면이 있다', () => {
  // 화면이 사라졌는데 표면만 남으면 관리자 화면에 **없는 문**이 그려진다
  const missing = SURFACES.filter((s) => !ROUTES.some((r) => r === s.href || r.startsWith(s.href + '/')))
  assert.deepEqual(missing.map((s) => s.href), [], '화면이 없는 표면')
})
