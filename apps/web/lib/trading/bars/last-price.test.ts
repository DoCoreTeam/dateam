/**
 * 마지막 현재가 — **못 받은 분에 덮어쓰지 않는다**
 *
 * 덮으면 화면이 「값 없음」으로 깜빡이고, 형성 중인 봉이 사라졌다 나타난다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(HERE, 'last-price.ts'), 'utf8')

test('★ 값이 없으면 안 덮어쓴다', () => {
  // `finite` 가 걸러 내고, saveLastPrice 가 그 뒤에 일찍 돌아간다
  assert.match(SRC, /if \(value === null\) return \{ saved: false/, '값이 없어도 쓴다')
  // 0 이나 빈 문자열이 0원짜리 값으로 남으면 안 된다
  assert.match(SRC, /Number\.isFinite\(n\) && n > 0/, '0 과 음수를 걸러내지 않는다')
})

test('★ 쓰기 오류를 보고 돌려준다 — supabase 는 안 던진다', () => {
  assert.match(SRC, /if \(error\) return \{ saved: false, reason: `write_failed/,
    '쓰기 오류를 안 본다 — 0건 저장이 성공으로 보인다')
})

test('★ 던지지 않는다 — 현재가 한 줄이 크론을 죽이면 안 된다', () => {
  for (const fn of ['saveLastPrice', 'loadLastPrice']) {
    const at = SRC.indexOf(`export async function ${fn}`)
    const body = SRC.slice(at, SRC.indexOf('\n}\n', at))
    assert.ok(body.includes('try {') && body.includes('catch'), `${fn} 이 안 감싼다`)
    assert.equal(/\bthrow\b/.test(body), false, `${fn} 이 던진다`)
  }
})

test('★ 이력을 또 쌓지 않는다 — 월물마다 한 줄', () => {
  assert.match(SRC, /onConflict: 'contract_code'/, '월물마다 한 줄이 아니다 — 이력이 두 곳에 쌓인다')
  assert.equal(/\.insert\(/.test(SRC), false, '덮어쓰지 않고 쌓는다')
})

test('★ 언제 받은 값인지를 같이 남긴다', () => {
  assert.match(SRC, /observed_at: observedAt\.toISOString\(\)/, '받은 시각을 안 남긴다')
  assert.match(SRC, /observedAt: String\(data\.observed_at\)/, '받은 시각을 안 돌려준다')
})

test('★ 서버 전용이다 — 서비스롤이 클라이언트로 새면 안 된다', () => {
  assert.match(SRC.slice(0, 40), /^import 'server-only'/, "맨 위에 import 'server-only' 가 없다")
})

test('★ 마이그레이션이 같은 판에서 RLS 를 켠다 (S1)', () => {
  const mig = readFileSync(join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '294_trading_last_price.sql'), 'utf8')
  assert.match(mig, /create table if not exists trading_last_price/)
  assert.match(mig, /alter table trading_last_price enable row level security/,
    '표를 만들면서 RLS 를 안 켠다')
  // TO public 정책은 로그인 안 한 사람을 포함한다
  assert.equal(/to public/i.test(mig), false, 'TO public 정책을 만든다')
  assert.match(mig, /revoke all on table trading_last_price from anon/,
    'anon 권한을 안 거둔다 — GRANT 와 RLS 는 다른 벽이다')
  // 사본은 원본 잠금을 안 물려받는다
  assert.equal(/create table .* as\b/i.test(mig), false, '사본을 만든다')
})

test('★ tick 이 실제로 부르고 기다린다 — 불 지르고 잊으면 쓰기가 사라진다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.match(tick, /await saveLastPrice\(contractCode, observedPrice, now\)/,
    'tick 이 현재가를 안 남기거나 안 기다린다')
  assert.equal(/void saveLastPrice/.test(tick), false,
    '불 지르고 잊는다 — 그 쓰기는 응답과 함께 사라진다')
})

test('★ 현황이 현재가를 함께 내려준다 — 새 창구를 안 연다', () => {
  const overview = readFileSync(join(HERE, '..', 'overview.ts'), 'utf8')
  assert.match(overview, /loadLastPrice\(contractCode\)/, '현황이 현재가를 안 읽는다')
  assert.match(overview, /lastPrice:/, '현황이 현재가를 안 내려준다')
  /*
    트레이딩 창구는 크론 둘뿐이다. 창구를 늘리면 지킬 자리가 늘고,
    그 규칙을 이미 가드 셋이 지킨다 — 현황이 이미 도는 새로고침에 한 줄을 얹는다.
  */
  const api = join(HERE, '..', '..', '..', 'app', 'api', 'trading')
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]))
  assert.equal(walk(api).filter((f) => f.endsWith('route.ts')).length, 2,
    '트레이딩 창구가 늘었다 — 현재가는 현황 payload 로 간다')
})

test('★ 다시 읽는 간격이 형성 봉을 움직일 만큼 짧다', async () => {
  const { TRADING_SETTINGS } = await import('../settings/registry.ts')
  const spec = TRADING_SETTINGS.find((x) => x.key === 'overview_refresh_seconds')
  assert.ok(spec)
  // 30초면 1분에 두 번뿐이라 「모양이 변한다」가 안 보인다
  assert.ok(Number(spec.defaultValue) <= 10, `기본 ${spec.defaultValue}초는 형성 봉이 안 움직인다`)
  // 하한 5초는 그대로다 — 서버를 쉬지 않고 두드리지 말라는 규칙이 먼저다
  assert.equal(Number(spec.min), 5, '하한이 바뀌었다')
})
