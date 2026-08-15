// lib/auth/api-user-gate.test.ts — api_user 차단에 구멍이 생기지 않게 지킨다
//
// 배경: v0.7.467에서 api_user 차단을 미들웨어에서 **레이아웃으로** 옮겼다.
//   미들웨어가 판정하려고 profiles.role을 따로 조회하던 것이 페이지 요청당 236ms였고,
//   레이아웃은 렌더용 프로필을 가져오면서 role을 이미 읽고 있었기 때문이다.
//
// 그래서 지금 안전의 근거는 "모든 화면 페이지가 세 레이아웃 중 하나 아래에 있다"는 사실이다.
// 그 사실이 깨지는 방법은 둘 뿐이고, 이 가드가 둘 다 막는다:
//   ① 세 그룹 밖에 새 페이지가 생긴다 → api_user가 그 화면을 볼 수 있다
//   ② 레이아웃에서 게이트 호출이 사라진다 → 그 그룹 전체가 뚫린다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 게이트를 반드시 부르는 레이아웃 */
const GATED_LAYOUTS = ['app/(member)/layout.tsx', 'app/admin/layout.tsx', 'app/(ci)/layout.tsx']

/** api_user에게 원래 열려 있는 화면 — 막으면 안 된다 */
const OPEN_TO_API_USER = ['/api-keys', '/change-password', '/develop', '/api-access', '/login']

/**
 * 그룹 레이아웃 밖에 있어도 되는 페이지.
 * 추가하려면 "api_user가 이 화면을 봐도 되는가"에 답이 되어야 한다.
 */
const OUTSIDE_OK: Record<string, string> = {
  '/': "redirect('/home')만 한다 — (member) 레이아웃으로 들어가 거기서 막힌다",
}

function walk(dir: string, name: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, name, out)
    else if (entry === name) out.push(p)
  }
  return out
}

/** app/(member)/deals/[id]/page.tsx → /deals/[id] */
function urlOf(pagePath: string): string {
  const dir = pagePath.replace(/\/page\.tsx$/, '')
  const u = dir.replace(/^app/, '').replace(/\/\([^)]+\)/g, '')
  return u || '/'
}

/** 이 페이지를 덮는 그룹 레이아웃(가장 가까운 것) */
function gatedGroupOf(pagePath: string): string | null {
  const layouts = new Set(walk('app', 'layout.tsx').map((p) => p.replace(/\/layout\.tsx$/, '')))
  let dir = pagePath.replace(/\/page\.tsx$/, '')
  while (dir !== 'app' && dir.includes('/')) {
    if (layouts.has(dir)) {
      const asLayout = `${dir}/layout.tsx`
      if (GATED_LAYOUTS.includes(asLayout)) return asLayout
    }
    dir = dir.slice(0, dir.lastIndexOf('/'))
  }
  return null
}

test('세 레이아웃 모두 api_user 게이트를 부른다', () => {
  const missing = GATED_LAYOUTS.filter((f) => !/redirectApiUser\s*\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(
    missing,
    [],
    `게이트 호출이 빠진 레이아웃이다 — 이 그룹의 화면 전체가 api_user에게 열린다:\n  ${missing.join('\n  ')}`,
  )
})

test('모든 화면 페이지는 게이트 아래에 있거나, 원래 열린 화면이다', () => {
  const offenders: string[] = []
  for (const page of walk('app', 'page.tsx')) {
    const url = urlOf(page)
    if (url in OUTSIDE_OK) continue
    if (OPEN_TO_API_USER.some((p) => url === p || url.startsWith(p + '/'))) continue
    if (gatedGroupOf(page)) continue
    offenders.push(`${url}  (${page})`)
  }
  assert.deepEqual(
    offenders,
    [],
    '어느 게이트에도 안 걸리는 화면이다. api_user가 볼 수 있게 된다.\n' +
      '(member)/admin/(ci) 아래로 옮기거나, 정말 열어야 한다면 이 파일에 이유와 함께 등재하라:\n  ' +
      offenders.join('\n  '),
  )
})

test('게이트 SSOT는 api_user만 되돌린다 (다른 역할을 잡지 않는다)', () => {
  const src = readFileSync('lib/auth/api-user-gate.ts', 'utf8')
  assert.match(src, /role === 'api_user'/, "판정 조건이 api_user가 아니다")
  assert.match(src, /API_USER_HOME = '\/api-keys'/, '복귀 지점이 /api-keys가 아니다')
  // admin·member를 잘못 잡으면 전 직원이 로그인 직후 튕긴다
  assert.equal(/role !== 'api_user'/.test(src), false, '조건이 뒤집혀 있다 — 내부 사용자가 전부 튕긴다')
})

test('미들웨어는 더 이상 profiles를 조회하지 않는다 (되돌아오면 236ms가 돌아온다)', () => {
  const mw = readFileSync('middleware.ts', 'utf8')
  assert.equal(
    /from\('profiles'\)/.test(mw),
    false,
    '미들웨어가 profiles를 다시 조회한다. 레이아웃이 같은 행에서 role을 이미 읽으므로 중복이다.',
  )
})
