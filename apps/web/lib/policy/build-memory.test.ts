/**
 * 빌드가 메모리로 죽지 않게 — **그리고 「빌드 성공」을 「배포 성공」으로 안 읽게**
 *
 * ## 무엇을 막는가 (실측 2026-09-28)
 *
 * Vercel 운영 배포 v0.10.651 이 `std::bad_alloc` · `SIGABRT` 로 죽었다. 코드 오류가 아니라
 * **빌드 머신 메모리 고갈**이었다. 로컬 빌드는 통과했으므로 `pnpm build` 초록만 보고 있으면
 * 영영 못 본다 — 실제로 운영은 **여드레 전 판에 멈춘 채로** 그 뒤 여섯 판이 사용자에게 안 갔다.
 *
 * 고친 방법은 프로덕션 빌드에서 webpack 파일 캐시를 끄는 것이다(6.61GB → 4.22GB).
 * 그 설정은 **한 줄이라 지우기 쉽고, 지워도 로컬에서는 아무 일도 안 일어난다.**
 * 그래서 여기서 지킨다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = readFileSync(join(WEB, 'next.config.js'), 'utf8')
const SCRIPT = readFileSync(join(WEB, 'scripts', 'deploy-state.mjs'), 'utf8')
const PKG = JSON.parse(readFileSync(join(WEB, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

/* ── 빌드 메모리 ──────────────────────────────────────── */

test('★ 프로덕션 빌드에서 webpack 파일 캐시를 끈다', () => {
  assert.match(CONFIG, /webpack:\s*\(config,\s*\{\s*dev\s*\}\)/, '빌드 설정을 손볼 자리가 없다')
  assert.match(CONFIG, /if \(!dev\) config\.cache = false/, '프로덕션 빌드가 파일 캐시를 든다')
  // dev 는 그대로 둔다 — 그쪽은 다시 켤 때가 빨라야 한다
  assert.equal(/config\.cache = false\s*$/m.test(CONFIG.replace('if (!dev) config.cache = false', '')), false,
    'dev 에서도 캐시를 껐다 — 다시 켤 때가 느려진다')
})

test('★ webpack 메모리 최적화가 켜져 있다', () => {
  assert.match(CONFIG, /webpackMemoryOptimizations:\s*true/, '메모리 최적화가 꺼졌다')
})

/**
 * **숫자가 없으면 다음 사람이 되돌린다.**
 *
 * 「캐시를 왜 껐지? 빌드가 느린데」라고 생각한 사람이 한 줄을 지우면 배포가 다시 죽는다.
 * 그 사람이 지우기 전에 읽을 수 있게 **잰 값을 설정 옆에** 둔다.
 */
test('★ 왜 그 설정인지 잰 값이 설정 옆에 남아 있다', () => {
  assert.match(CONFIG, /std::bad_alloc/, '무엇이 죽었는지 안 적혀 있다')
  assert.match(CONFIG, /6\.61 GB/, '고치기 전 값이 없다')
  assert.match(CONFIG, /4\.22 GB/, '고친 뒤 값이 없다')
  // 안 켠 설정도 왜 안 켰는지 남긴다 — 다음 사람이 같은 것을 또 시도하지 않게
  assert.match(CONFIG, /cpus: 2` 는 혼자서는 오히려 더 썼으므로/, '안 켠 이유가 없다')
})

/* ── 「빌드 성공」은 「배포 성공」이 아니다 ─────────────── */

test('★ 배포가 떴는지 확인하는 길이 있다', () => {
  assert.equal(PKG.scripts['deploy:state'], 'node scripts/deploy-state.mjs', '확인기가 등재돼 있지 않다')
  // 안 뜬 배포가 있으면 종료 코드로 알린다 — 눈으로 세게 두지 않는다
  assert.match(SCRIPT, /process\.exit\(1\)/, '실패를 종료 코드로 안 알린다')
  assert.match(SCRIPT, /ERROR' \|\| state === 'CANCELED'/, '안 뜬 상태를 안 가른다')
  assert.match(SCRIPT, /errorStep/, '어느 단계에서 죽었는지 안 말한다')
})

test('★ 확인기가 토큰을 코드에 안 적고 출력에도 안 싣는다 (S3)', () => {
  // 앱과 **같은 자리**에서 읽는다 — 키 이름이 갈리면 한쪽만 도는 날이 온다
  assert.match(SCRIPT, /vercel_api_token/, 'META 키 이름을 안 쓴다')
  assert.match(SCRIPT, /org_content/, '앱과 다른 자리에서 읽는다')
  // 토큰 꼴이 코드에 박혀 있으면 안 된다
  assert.equal(/['"][A-Za-z0-9]{24,}['"]/.test(SCRIPT), false, '긴 비밀 꼴이 코드에 박혀 있다')
  // 실패해도 응답 본문을 통째로 안 찍는다 — 토큰이 되비칠 수 있다
  assert.equal(/console\.(log|error)\([^)]*await res\.text\(\)/.test(SCRIPT), false,
    '응답 본문을 그대로 찍는다')
})

test('★ 앱이 쓰는 META 키 이름과 확인기가 쓰는 이름이 같다', () => {
  const appConfig = readFileSync(join(WEB, 'lib', 'vercel', 'config.ts'), 'utf8')
  for (const key of ['vercel_api_token', 'vercel_project_id', 'vercel_team_id']) {
    assert.ok(appConfig.includes(key), `앱이 ${key} 를 안 쓴다`)
    assert.ok(SCRIPT.includes(key), `확인기가 ${key} 를 안 쓴다`)
  }
})
