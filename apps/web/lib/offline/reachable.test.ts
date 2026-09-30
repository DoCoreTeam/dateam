/**
 * 「우리 서버에 닿나」를 재는 자리 — 가드
 *
 * **왜 생겼나 (실측 2026-09-30)**: 사용자가 CRM 첫 화면에서 「녹음 시작」을 눌렀고
 * 화면에 뜬 말이 **「Failed to fetch」** 였다. 그 화면은 **전날 그려진 것**이었다
 * (화면은 딜이 「32일째」라고 적고 있었는데 그날 서버가 세면 33일째였다).
 * 서버는 내려갔고 화면만 살아 있었다. 그 사이 화면은 아무 말도 하지 않았다.
 *
 * 왜 못 잡았나: 연결 판정을 `navigator.onLine` 으로 했다. 그 값은 **기기에 랜선이
 * 꽂혔나**를 말하지 **우리 서버가 답하나**를 말하지 않는다. 와이파이는 멀쩡했다.
 *
 * 그래서 여기서 재는 것은 하나다 — **요청을 보내 봤더니 답이 왔나.**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PING_PATH,
  PING_TIMEOUT_MS,
  UNREACHABLE_STREAK,
  SERVER_UNREACHABLE_MESSAGE,
  pingServer,
  nextFailureStreak,
  isUnreachable,
} from './reachable.ts'

const ROUTE = readFileSync(new URL('../../app/api/ping/route.ts', import.meta.url), 'utf8')

const ok = () => ({ ok: true }) as Response
const notOk = () => ({ ok: false }) as Response

/* ── 재는 쪽 ────────────────────────────────────────────── */

test('★ 답이 오면 닿는 것이다', async () => {
  assert.equal(await pingServer(async () => ok()), true)
})

test('★ fetch 가 던지면 안 닿는 것이다 — 이것이 「Failed to fetch」의 정체다', async () => {
  const boom = async () => { throw new TypeError('Failed to fetch') }
  assert.equal(await pingServer(boom), false)
})

test('★ 답이 왔어도 실패 응답이면 안 닿는 것으로 센다', async () => {
  assert.equal(await pingServer(async () => notOk()), false)
})

test('★ 영영 안 오면 기다리지 않는다 — 매달린 요청은 「모름」이지 「닿음」이 아니다', async () => {
  // 신호를 무시하고 영원히 안 끝나는 창구. 시간 제한이 없으면 이 시험이 안 끝난다.
  const hang = () => new Promise<Response>(() => {})
  assert.equal(await pingServer(hang, 30), false)
})

test('부르는 주소와 방식이 고정이다 — 캐시된 답을 「닿았다」로 읽으면 안 된다', async () => {
  let seen: { url: string; init?: RequestInit } | null = null
  await pingServer(async (url, init) => { seen = { url, init }; return ok() })
  const got = seen as unknown as { url: string; init: RequestInit }
  assert.equal(got.url, PING_PATH)
  assert.equal(got.init.method, 'GET')
  assert.equal(got.init.cache, 'no-store')
})

/* ── 한 번 실패로는 말하지 않는다 ─────────────────────────── */

test('★ 한 번 실패로는 「안 닿는다」가 아니다 — 깜빡이는 경고는 고장으로 읽힌다', () => {
  assert.ok(UNREACHABLE_STREAK >= 2, '한 번만 실패해도 배너가 뜬다')
  assert.equal(isUnreachable(nextFailureStreak(0, false)), false, '첫 실패에 바로 뜬다')
  assert.equal(isUnreachable(nextFailureStreak(1, false)), true, '두 번 실패해도 안 뜬다')
})

test('★ 한 번이라도 닿으면 셈이 0 으로 돌아간다 — 안 그러면 영원히 붙박인다', () => {
  assert.equal(nextFailureStreak(9, true), 0)
  assert.equal(isUnreachable(0), false)
})

/* ── 말 ────────────────────────────────────────────────── */

test('★ 안 닿을 때 사용자에게 가는 말이 한국어이고 할 일을 담는다', () => {
  assert.ok(!/[A-Za-z]{4,}/.test(SERVER_UNREACHABLE_MESSAGE), '영문 원문이 그대로 샌다')
  assert.ok(SERVER_UNREACHABLE_MESSAGE.includes('서버'), '무엇이 문제인지 안 말한다')
  assert.ok(/다시|확인/.test(SERVER_UNREACHABLE_MESSAGE), '무엇을 하면 되는지 안 말한다')
})

/* ── 창구 ──────────────────────────────────────────────── */

test('★ 재는 창구는 데이터를 하나도 안 준다 — 그래서 로그인 없이 열어도 된다', () => {
  const body = ROUTE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  assert.match(body, /\{\s*ok:\s*true\s*\}/, '응답이 { ok: true } 한 가지가 아니다')
  for (const leak of ['process.env', 'createClient', 'getCrmDb', 'prisma', 'supabase', 'cookies', 'headers(']) {
    assert.ok(!body.includes(leak), `창구가 ${leak} 를 만진다 — 값이 없어야 열어 둘 수 있다`)
  }
})

test('★ 재는 창구는 캐시되면 안 된다 — 캐시된 200 은 「서버가 살아 있다」의 증거가 아니다', () => {
  assert.match(ROUTE, /no-store/, '응답에 캐시 금지가 없다')
  assert.match(ROUTE, /dynamic = 'force-dynamic'/, '빌드 때 굳으면 죽은 서버도 200 을 준다')
})

test('시간 제한이 사람이 기다릴 만한 값이다', () => {
  assert.ok(PING_TIMEOUT_MS >= 2000 && PING_TIMEOUT_MS <= 10_000, `${PING_TIMEOUT_MS}ms 는 비현실적이다`)
})
