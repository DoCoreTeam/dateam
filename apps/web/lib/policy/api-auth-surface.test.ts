/**
 * 인증을 안 거치는 API 창구가 늘어나지 않게 한다
 *
 * **왜**: 2026-09-13 보안 점검에서 라우트 357개를 전수로 훑었다. 인증 흔적이 없는 것은
 *   둘뿐이었고 둘 다 이유가 있었다. 문제는 **그 사실을 세는 자리가 없었다** 는 것이다.
 *   라우트 하나를 새로 만들면서 게이트를 빠뜨려도 화면은 멀쩡하고, 테스트도 조용하다.
 *   실제로 그렇게 열린 창구 하나가 아무 제한 없이 관리자 대기열에 행을 쌓고 있었다
 *   (POST /api/public/api-access — 마이그 260 으로 한도를 붙였다).
 *
 * 규칙은 하나다. `app/api/**\/route.ts` 는 인증 장치를 하나 이상 부르거나,
 * 아래 OPEN_ON_PURPOSE 에 **이유와 함께** 적혀 있어야 한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const API = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'api')

/**
 * 「이 요청을 누가 보냈나」를 판정하는 장치들.
 *
 * 세션·API 키·기계 인증 셋 다 여기 들어온다. 새 장치를 만들면 이름을 여기 더한다 —
 * 안 더하면 그 장치를 쓰는 라우트가 전부 열린 것으로 잡혀 바로 알게 된다.
 */
const AUTH_MARKERS = [
  // 세션
  'getUser', 'getSession', 'getCurrentUser', 'requireAuth', 'requireAdmin', 'requireMember',
  // 세션이 실린 Supabase 클라이언트 — RLS 가 곧 게이트다.
  // (서비스롤을 쓰는 createAdminClient 는 RLS 를 통째로 지나가므로 여기 없다)
  'createClient\\(',
  // 게이트를 안에서 거는 서버 액션에 넘기는 라우트
  'getMeetingNote',
  // 도메인별 게이트
  'withCrmApi', 'resolveCrmAccess', 'requireCrmMember', 'requireCiMember', 'requireRfp',
  'requireWorkspace', 'orgScope',
  // API 키
  'authenticatePublicApi', 'requireAdminKey', 'publicApiAuth',
  // 기계(크론·워커)
  'CRON_SECRET', 'WORKER_TOKEN', 'machineAuth', 'assertMachine',
]

/**
 * 일부러 열어 둔 창구. 적을 때는 **왜 열려 있어도 되는지** 를 함께 적는다.
 */
const OPEN_ON_PURPOSE: Record<string, string> = {
  'settings/branding/route.ts':
    '로그인 화면이 회사 이름과 로고를 그리려면 로그인 전에 읽어야 한다. 읽기 전용이고 브랜딩 값만 나간다.',
  'public/api-access/route.ts':
    'API 사용 신청 폼 — 계정이 없는 사람이 쓰는 창구다. 대신 시간당 한도(lib/public-rate-limit)와 같은 대답 규칙을 지킨다.',
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) routeFiles(full, out)
    else if (name === 'route.ts' || name === 'route.tsx') out.push(full)
  }
  return out
}

test('인증을 안 거치는 API 창구는 이유와 함께 적힌 것뿐이다', () => {
  const files = routeFiles(API)
  assert.ok(files.length > 200, `라우트를 ${files.length}개밖에 못 찾았다 — 규칙이 헛돈다`)

  const marker = new RegExp(AUTH_MARKERS.join('|'))
  const open: string[] = []

  for (const f of files) {
    const rel = relative(API, f)
    if (rel in OPEN_ON_PURPOSE) continue
    if (marker.test(readFileSync(f, 'utf8'))) continue
    open.push(`  ${rel}`)
  }

  assert.equal(
    open.length,
    0,
    `인증 장치를 안 부르는 라우트 ${open.length}개\n${open.join('\n')}\n\n` +
      `둘 중 하나를 한다.\n` +
      `  ① 게이트를 부른다 (withCrmApi · requireCiMemberApi · requireAdminApi · authenticatePublicApi …)\n` +
      `  ② 정말 열어야 하면 이 파일 OPEN_ON_PURPOSE 에 **이유와 함께** 적는다.`,
  )
})

test('일부러 열어 둔 창구 목록이 실제 파일을 가리킨다', () => {
  for (const [rel, reason] of Object.entries(OPEN_ON_PURPOSE)) {
    assert.ok(
      statSync(join(API, rel)).isFile(),
      `OPEN_ON_PURPOSE 의 ${rel} 이 없다 — 지운 라우트가 목록에 남아 있으면 다음에 같은 이름을 만든 사람이 그냥 통과한다`,
    )
    assert.ok(reason.length > 20, `${rel} 의 이유가 너무 짧다`)
  }
})

test('열어 둔 쓰기 창구에는 속도 제한이 붙어 있다', () => {
  const src = readFileSync(join(API, 'public/api-access/route.ts'), 'utf8')
  assert.match(
    src,
    // 부르는 자리를 본다 — import 만 남기고 호출을 지워도 통과하면 안 된다(실측으로 걸렸다)
    /await\s+throttlePublicRequest\(/,
    '로그인 없이 부를 수 있는 쓰기 창구다 — 한도가 없으면 아무나 몇 번이든 행을 쌓는다',
  )
  assert.match(src, /429/, '한도를 넘겼을 때 429 로 답해야 부르는 쪽이 물러설 줄 안다')
})
