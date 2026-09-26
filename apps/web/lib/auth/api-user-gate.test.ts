// lib/auth/api-user-gate.test.ts — api_user 차단에 구멍이 생기지 않게 지킨다
//
// 배경: v0.7.467에서 api_user 차단을 미들웨어에서 **레이아웃으로** 옮겼다.
//   미들웨어가 판정하려고 profiles.role을 따로 조회하던 것이 페이지 요청당 236ms였고,
//   레이아웃은 렌더용 프로필을 가져오면서 role을 이미 읽고 있었기 때문이다.
//
// 그래서 지금 안전의 근거는 "모든 화면 페이지가 게이트 레이아웃 중 하나 아래에 있다"는 사실이다.
// 그 사실이 깨지는 방법은 둘 뿐이고, 이 가드가 둘 다 막는다:
//   ① 게이트 그룹 밖에 새 페이지가 생긴다 → api_user가 그 화면을 볼 수 있다
//   ② 레이아웃에서 게이트 호출이 사라진다 → 그 그룹 전체가 뚫린다

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { TRADING_SHELL_LAYOUT } from '../policy/app-dirs.ts'

/** 게이트를 반드시 부르는 레이아웃 */
const GATED_LAYOUTS = [
  'app/(member)/layout.tsx', 'app/admin/layout.tsx', 'app/(ci)/layout.tsx',
  'app/(crm)/layout.tsx', // dacrm T1-01
  'app/(ai)/layout.tsx', // AI 스튜디오 — 관리자 전용이지만 api_user 차단은 같은 SSOT 를 쓴다
  'app/(rfp)/layout.tsx', // RFP 분석기 — 임직원 전용, 같은 SSOT 를 쓴다
  // AI 트레이딩 — 소유자 한 사람만 보지만 api_user 차단은 같은 SSOT 를 쓴다.
  // 이 줄이 없으면 (member) 밖으로 옮긴 순간 그 화면이 어느 게이트에도 안 걸린다
  TRADING_SHELL_LAYOUT,
]

/** api_user에게 원래 열려 있는 화면 — 막으면 안 된다 */
const OPEN_TO_API_USER = ['/api-keys', '/change-password', '/develop', '/api-access', '/login']

/**
 * 그룹 레이아웃 밖에 있어도 되는 페이지.
 * 추가하려면 "api_user가 이 화면을 봐도 되는가"에 답이 되어야 한다.
 */
const OUTSIDE_OK: Record<string, string> = {
  '/': "redirect('/home')만 한다 — (member) 레이아웃으로 들어가 거기서 막힌다",
  '/offline':
    '연결이 끊겼을 때 서비스 워커가 대신 주는 화면이다. 데이터를 한 글자도 담지 않고 ' +
    '"연결이 없다"만 말한다 — 게이트 조회 자체가 오프라인에서 불가능하다',
  '/mfa':
    '비밀번호는 통과했지만 2단계를 아직 안 지난 상태에서만 열린다. 여기서 막으면 ' +
    '2단계를 켠 사람이 아무 데도 못 간다. 담는 것은 입력칸 하나뿐이고, ' +
    '이미 통과했거나 필요 없는 사람은 페이지가 스스로 /dashboard 로 돌려보낸다',
  '/security':
    '자기 계정에 2단계 인증을 거는 화면이다. api_user 도 자기 계정을 지킬 수 있어야 한다. ' +
    '보는 것은 자기 장치 목록뿐이고 남의 것은 한 글자도 안 나온다. ' +
    '게이트 안에 두면 관리자에게 2단계를 요구하는 동안 등록하러 갈 길이 막힌다',
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

test('게이트 레이아웃 전부가 api_user 게이트를 부른다', () => {
  const missing = GATED_LAYOUTS.filter((f) => !/redirectApiUser\s*\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(
    missing,
    [],
    `게이트 호출이 빠진 레이아웃이다 — 이 그룹의 화면 전체가 api_user에게 열린다:\n  ${missing.join('\n  ')}`,
  )
})

/**
 * 서비스 셸은 **접근권한까지** 묻는다 (2026-09-27).
 *
 * **왜 지금 적나**: AI 트레이딩을 `(member)` 밖으로 옮기면서 `(member)` 레이아웃이 걸던
 * 표면 판정(`deniedSurfaceName`)이 그 화면에 더 이상 안 걸리게 됐다. 그 사실은 오류를 안 낸다 —
 * 화면은 멀쩡히 열리고, 관리자 화면에서 그 문을 닫아도 **닫히지 않는다.** 닫는 단추가
 * 거짓말이 되는 것이고, 그건 권한 화면 전체의 신뢰를 깎는다.
 *
 * 옮길 때마다 사람이 기억해야 하는 규칙은 반드시 빠뜨린다. 그래서 센다.
 */
const ACCESS_EXEMPT: Record<string, string> = {
  'app/admin/layout.tsx':
    '관리자 표면 자신이다. 역할(role !== admin)로 직접 막고, 그 판정을 접근권한 부여로 열고 닫게 하면 '
    + '자기를 잠근 관리자를 풀어 줄 사람이 사라진다',
}

test('서비스 셸은 접근권한도 묻는다 — 옮기면서 문이 빠지지 않게', () => {
  const missing = GATED_LAYOUTS
    .filter((f) => !(f in ACCESS_EXEMPT))
    .filter((f) => !/canOpen\s*\(|deniedSurfaceName\s*\(/.test(readFileSync(f, 'utf8')))
  assert.deepEqual(
    missing,
    [],
    `접근권한을 안 묻는 셸이다 — 관리자 화면에서 닫아도 안 닫힌다:\n  ${missing.join('\n  ')}`,
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
