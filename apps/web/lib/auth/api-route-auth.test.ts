// lib/auth/api-route-auth.test.ts — 모든 /api 라우트가 **스스로** 인증하는지 지킨다
//
// 왜 필요한가: v0.7.465에서 미들웨어 matcher가 `/api/*`를 더 이상 태우지 않는다.
//   그 결정의 근거는 "API 라우트 201개 전수 확인 결과, 미들웨어가 유일한 방어선인
//   라우트가 0개"였다는 사실 하나다. 그 사실이 깨지는 순간 — 즉 누군가 인증 없는
//   API 라우트를 새로 만드는 순간 — 그 라우트는 **아무 방어 없이 공개된다.**
//   예전에는 미들웨어가 뒤에서 받아 줬지만 이제는 받아 줄 것이 없다.
//
// 그래서 이 가드는 "새 라우트가 인증을 안 했다"를 즉시 실패로 만든다.
// 예외를 늘리고 싶으면 아래 ALLOWLIST에 **이유와 함께** 적어야 한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 라우트가 인증했다고 인정하는 신호.
 * withCrmApi 는 이름 규칙(require*Api)과 다르지만 같은 일을 한다 —
 * 안에서 resolveCrmAccess 로 로그인·api_user·삭제계정·CRM 멤버십을 판정하고
 * 실패하면 401/403 을 낸다(lib/crm/api/handler.ts).
 */
const AUTH_HELPER = /\b(require[A-Za-z]*Api|requireCiMember[A-Za-z]*|authenticatePublicApi|verifyApiKey|withCrmApi)\s*\(/
/** 라우트 안에서 직접 세션을 확인하는 경우 */
const SESSION = /auth\.get(?:User|Session)\(\)/
/** 거부까지 하는지 — 세션을 읽고 통과시키면 인증이 아니다 */
const DENY = /status:\s*40[13]|['"]UNAUTHORIZED['"]|['"]FORBIDDEN['"]|redirect\(/
/** 사용자 세션이 아니라 서비스 토큰으로 인증하는 경우(크론·워커) */
const SERVICE_TOKEN = /CI_WORKER_TOKEN|CRON_SECRET|AUTOLINK_WORKER_TOKEN|process\.env\.[A-Z_]*TOKEN/

/**
 * 인증 코드가 라우트 파일에 없어도 되는 예외.
 * **줄이는 방향으로만** 바꾼다. 추가하려면 왜 안전한지 여기 적는다.
 */
const ALLOWLIST: Record<string, string> = {
  '/api/public/api-access':
    'API 접근 신청 폼. 의도적 공개(로그인 없는 외부인이 쓴다). zod 검증 + 중복 이메일 차단.',
  '/api/meeting-notes/[id]/export':
    '인증이 getMeetingNote() 안에 있다 — RLS 클라이언트로 getUser 후 !user면 null 반환(actions.ts). 라우트는 그 결과가 없으면 404를 낸다.',
  '/api/settings/branding':
    '조직명·태그라인·로고 URL만 반환. 같은 값을 공개 /login 화면이 이미 서버렌더로 보여준다(login/page.tsx). 호출처 0건.',
}

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkRoutes(p, out)
    else if (name === 'route.ts' || name === 'route.tsx') out.push(p)
  }
  return out
}

function urlOf(path: string): string {
  return '/api' + path.replace(/^app\/api/, '').replace(/\/route\.tsx?$/, '')
}

function isAuthenticated(src: string): boolean {
  if (AUTH_HELPER.test(src)) return true
  if (SERVICE_TOKEN.test(src)) return true
  // 세션만 읽고 거부하지 않으면 인증이 아니다
  return SESSION.test(src) && DENY.test(src)
}

test('모든 /api 라우트는 스스로 인증한다 (미들웨어가 더 이상 받아 주지 않는다)', () => {
  const offenders: string[] = []
  for (const file of walkRoutes('app/api')) {
    const url = urlOf(file)
    if (url in ALLOWLIST) continue
    if (isAuthenticated(readFileSync(file, 'utf8'))) continue
    offenders.push(url)
  }
  assert.deepEqual(
    offenders,
    [],
    '인증 없는 API 라우트다. requireAdminApi/requireMemberApi/requireCiMemberApi 중 하나를 쓰거나,\n' +
      '정말 공개여야 한다면 이 파일 ALLOWLIST에 이유와 함께 등재하라:\n  ' +
      offenders.join('\n  '),
  )
})

test('ALLOWLIST 항목은 실제로 존재하는 라우트다 (지워진 예외가 남아 썩지 않게)', () => {
  const urls = new Set(walkRoutes('app/api').map(urlOf))
  const stale = Object.keys(ALLOWLIST).filter((u) => !urls.has(u))
  assert.deepEqual(stale, [], `ALLOWLIST에 없는 라우트가 남아 있다: ${stale.join(', ')}`)
})

test('세션을 읽고도 거부하지 않는 라우트는 인증으로 치지 않는다', () => {
  const readsButAllows = 'const { data: { user } } = await supabase.auth.getUser(); return NextResponse.json({ user })'
  assert.equal(isAuthenticated(readsButAllows), false)
  const readsAndDenies = 'const { data: { user } } = await supabase.auth.getUser(); if (!user) return NextResponse.json({}, { status: 401 })'
  assert.equal(isAuthenticated(readsAndDenies), true)
})

test('미들웨어 matcher가 /api/를 제외한 상태를 유지한다', () => {
  const mw = readFileSync('middleware.ts', 'utf8')
  const m = mw.match(/matcher:\s*\[\s*'([^']+)'/)
  assert.ok(m, 'middleware.ts에서 matcher를 찾지 못했다')
  assert.match(
    m![1],
    /\?!api\//,
    'matcher가 /api/를 다시 태우고 있다. 되돌리는 건 자유지만, 그러면 API마다 인증 왕복이 중복된다 — 의도한 변경인지 확인하라.',
  )
})
