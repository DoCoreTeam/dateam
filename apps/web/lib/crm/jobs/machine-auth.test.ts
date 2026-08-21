/**
 * 잡 입구 기계 호출 판정 가드
 *
 * 이 가드가 지키는 것은 "토큰 비교가 맞나"가 아니라 **입구가 열려 있나**다.
 * 실제 사고(2026-08-21)는 비교가 틀려서가 아니라, 크론이 보내는 요청 모양
 * (GET + CRON_SECRET)을 아무도 받아 주지 않아서 났다.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isMachineCall, machineTokens, machineAuthUnconfigured } from './machine-auth.ts'

/** 헤더 하나짜리 가짜 요청 */
function req(auth?: string) {
  return { headers: { get: (n: string) => (n.toLowerCase() === 'authorization' ? auth ?? null : null) } }
}

function withEnv(vals: Record<string, string | undefined>, fn: () => void) {
  const keys = ['CRON_SECRET', 'CI_WORKER_TOKEN']
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    for (const k of keys) {
      if (vals[k] === undefined) delete process.env[k]
      else process.env[k] = vals[k]
    }
    fn()
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k] as string
    }
  }
}

test('토큰이 하나도 없으면 어떤 요청도 기계 호출이 아니다 — 무인증 통과 금지', () => {
  withEnv({}, () => {
    assert.equal(machineAuthUnconfigured(), true)
    assert.equal(isMachineCall(req('Bearer anything')), false)
    assert.equal(isMachineCall(req()), false)
  })
})

test('Vercel 크론 경로 — CRON_SECRET 만 있어도 통과한다', () => {
  withEnv({ CRON_SECRET: 'cron-abc' }, () => {
    assert.equal(isMachineCall(req('Bearer cron-abc')), true)
    assert.equal(isMachineCall(req('Bearer wrong-vv')), false)
  })
})

test('외부 스케줄러 경로 — CI_WORKER_TOKEN 만 있어도 통과한다', () => {
  withEnv({ CI_WORKER_TOKEN: 'worker-xyz' }, () => {
    assert.equal(isMachineCall(req('Bearer worker-xyz')), true)
  })
})

test('둘 다 설정되면 둘 다 인정한다 — 한쪽만 잠그지 않는다', () => {
  withEnv({ CRON_SECRET: 'cron-abc', CI_WORKER_TOKEN: 'worker-xyz' }, () => {
    assert.equal(isMachineCall(req('Bearer cron-abc')), true)
    assert.equal(isMachineCall(req('Bearer worker-xyz')), true)
    assert.deepEqual(machineTokens().sort(), ['cron-abc', 'worker-xyz'])
  })
})

test('길이가 다른 토큰에서 던지지 않는다 — timingSafeEqual 은 길이가 다르면 throw 한다', () => {
  withEnv({ CRON_SECRET: 'short' }, () => {
    assert.equal(isMachineCall(req('Bearer a-much-longer-token-value')), false)
    assert.equal(isMachineCall(req('Bearer')), false)
    assert.equal(isMachineCall(req('')), false)
  })
})

test('Bearer 접두사가 없으면 거부한다', () => {
  withEnv({ CRON_SECRET: 'cron-abc' }, () => {
    assert.equal(isMachineCall(req('cron-abc')), false)
    assert.equal(isMachineCall(req('Basic cron-abc')), false)
  })
})

/**
 * 배선 가드 — 이번 사고의 본체.
 *
 * 판정 함수가 아무리 맞아도 **잡의 GET 이 그걸 안 부르면** 크론은 여전히 403 이다.
 * 그래서 라우트 파일 자체를 읽어 배선을 확인한다.
 */
test('크론이 부르는 잡 3개의 GET 이 기계 호출을 받아들인다', async () => {
  const { readFileSync } = await import('node:fs')
  const jobs = ['gmail-sync', 'expire-suggestions', 'stalled-deals']
  for (const j of jobs) {
    const src = readFileSync(`app/api/crm/jobs/${j}/route.ts`, 'utf8')
    const get = src.slice(src.indexOf('export async function GET'))
    assert.match(get, /isMachineCall\(req\)/,
      `${j}: GET 이 isMachineCall 을 안 부른다 — Vercel 크론(GET)이 403 을 받는다`)
    assert.match(src, /export async function GET\(req: NextRequest\)/,
      `${j}: GET 이 요청 객체를 안 받는다 — 헤더를 볼 수 없다`)
  }
})
