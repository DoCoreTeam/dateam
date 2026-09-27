/**
 * Jev 에게 **무엇을 말하지 않는가**와, 못 받았을 때 어떻게 되는가
 *
 * 절대 날짜를 주면 모델이 그날 무슨 일이 있었는지를 기억에서 꺼낸다. 그것은 판단이 아니라
 * 사후 지식이고, 백테스트에서만 잘 맞는다 — 그 차이가 그대로 기대값의 거짓말이 된다.
 *
 * 제한 시간을 안 지키면 **응답이 느려지는 순간에만** 판단이 멈춘다. 하필 변동이 큰,
 * 기회가 있는 순간만 골라 빠지는 편향이다(D-41).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildJevPrompt, parseJevResponse, relativeCloses, JEV_PROMPT_VERSION } from './jev-prompt.ts'
import { createJevJudge, JevBudgetDeniedError } from './jev-core.ts'
import type { JudgeInput } from './types.ts'
import type { MinuteBarInput } from '../bars/confirm.ts'
import { openAiCompatibleBaseUrl } from '../../ai/provider-catalog.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

function bars(count: number): MinuteBarInput[] {
  const base = Date.parse('2026-09-25T01:00:00.000Z')
  return Array.from({ length: count }, (_, i) => ({
    startAt: new Date(base + i * 60_000),
    open: 1100 + i * 0.1, high: 1101 + i * 0.1, low: 1099 + i * 0.1, close: 1100.5 + i * 0.1,
    volume: 10,
  }))
}

const INPUT: JudgeInput = {
  asOf: new Date('2026-09-25T01:30:00.000Z'),
  contractCode: 'A01612',
  decisionTf: '1m',
  bars: bars(30),
  trigger: { id: 'breakout_up', direction: 'long', detail: '종가 1120 > 최근 고가 1110' },
  minutesSinceOpen: 45,
  indicators: { atr: 2, smaFast: 1103, smaSlow: 1101, recentHigh: 1104, recentLow: 1098 },
}

// ── 무엇을 말하지 않는가 (S3) ────────────────────────────

test('★ 질문에 절대 날짜가 안 들어간다 — 모델이 그날을 기억에서 꺼내면 판단이 아니다', () => {
  const { text } = buildJevPrompt(INPUT)
  const forbidden: [RegExp, string][] = [
    [/\d{4}-\d{2}-\d{2}/, 'ISO 날짜'],
    [/\d{4}년/, '연도'],
    [/20[0-9]{2}\/\d{1,2}\/\d{1,2}/, '슬래시 날짜'],
    [/\d{8}T\d{6}|\d{4}-\d{2}-\d{2}T/, '타임스탬프'],
    [/GMT|UTC|\+09:00|Z\b/, '시간대'],
  ]
  for (const [pattern, name] of forbidden) {
    assert.equal(pattern.test(text), false, `질문에 ${name} 가 실렸다:\n${text}`)
  }
})

test('★ 질문에 절대 지수 수준이 안 들어간다 — 값은 전부 ATR 배수 상대값이다', () => {
  const { text } = buildJevPrompt(INPUT)
  // 1,0xx~1,1xx 대의 네 자리 수가 나오면 지수 수준을 그대로 준 것이다
  const levels = text.match(/\b1[0-2]\d{2}(\.\d+)?\b/g) ?? []
  assert.deepEqual(levels, [], `질문에 지수 수준이 실렸다: ${levels.join(', ')}`)
})

test('★ 질문에 계좌번호·실명·뉴스가 안 들어간다', () => {
  const { text } = buildJevPrompt(INPUT)
  for (const word of ['계좌', '뉴스', '기사', '님', '고객', '예탁', '주문']) {
    assert.equal(text.includes(word), false, `질문에 「${word}」가 실렸다`)
  }
  // 계좌번호 꼴
  assert.equal(/\d{6,}-\d{2,}/.test(text), false)
})

test('시각은 세션 시작 이후 경과 분으로만 말한다', () => {
  const { text } = buildJevPrompt(INPUT)
  assert.match(text, /세션 시작 후 45분/)
})

test('종가 흐름이 ATR 배수 상대값이고 마지막 봉이 0 이다', () => {
  const closes = relativeCloses(INPUT, 5)
  assert.equal(closes.length, 5)
  assert.equal(closes[closes.length - 1], 0, '기준 봉이 0 이 아니다')
  assert.ok(closes.every((c) => Math.abs(c) < 10), '상대값이 아니라 절대값 같다')
  // ATR 이 0 이면 나눌 수 없다 — 절대값을 대신 내보내지 않는다
  assert.deepEqual(relativeCloses({ ...INPUT, indicators: { ...INPUT.indicators, atr: 0 } }, 5), [])
})

test('같은 입력이면 같은 질문이고, 다른 입력이면 다르다', () => {
  assert.equal(buildJevPrompt(INPUT).fingerprint, buildJevPrompt(INPUT).fingerprint)
  assert.notEqual(
    buildJevPrompt(INPUT).fingerprint,
    buildJevPrompt({ ...INPUT, minutesSinceOpen: 46 }).fingerprint,
  )
  assert.match(buildJevPrompt(INPUT).fingerprint, new RegExp(`^${JEV_PROMPT_VERSION}\\|`))
})

// ── 답 읽기 ──────────────────────────────────────────────

test('제대로 온 답을 읽는다', () => {
  const parsed = parseJevResponse('앞말 {"p_long":0.6,"p_short":0.1,"p_hold":0.3,"enter_now":0.7} 뒷말')
  assert.equal(parsed.ok, true)
  assert.equal(parsed.ok && parsed.rawScore.p_long, 0.6)
})

test('★ 합이 안 맞으면 고쳐서 쓰지 않는다 — 고치면 보정이 우리가 만든 숫자를 배운다', () => {
  const parsed = parseJevResponse('{"p_long":0.6,"p_short":0.6,"p_hold":0.6,"enter_now":0.5}')
  assert.equal(parsed.ok, false)
  assert.match(parsed.ok === false ? parsed.reason : '', /^sum_not_one/)
})

test('읽을 수 없는 답은 사유와 함께 거절한다', () => {
  const cases: [string, RegExp][] = [
    ['그냥 산문입니다', /not_json/],
    ['{깨진 json', /not_json|json_broken/],
    ['{"p_long":0.6,"p_short":0.4}', /missing_field:p_hold/],
    ['{"p_long":1.6,"p_short":-0.6,"p_hold":0,"enter_now":0.5}', /out_of_range/],
    ['{"p_long":"0.6","p_short":0.2,"p_hold":0.2,"enter_now":0.5}', /missing_field:p_long/],
  ]
  for (const [text, pattern] of cases) {
    const parsed = parseJevResponse(text)
    assert.equal(parsed.ok, false, `${text} 를 받아들였다`)
    assert.match(parsed.ok === false ? parsed.reason : '', pattern)
  }
})

test('소수 반올림 정도의 어긋남은 받아 준다', () => {
  assert.equal(parseJevResponse('{"p_long":0.33,"p_short":0.33,"p_hold":0.33,"enter_now":0.5}').ok, true)
})

// ── 기권 세 갈래 ─────────────────────────────────────────

const judgeWith = (call: (p: string) => Promise<string>, timeoutMs = 10_000) =>
  createJevJudge({
    call,
    timeoutMs,
    modelVersion: 'test-model',
    // 시계를 밀어 즉시 판정한다. 실제 시계로 재면 시험 하나가 10초를 그냥 기다린다
    delay: async (ms) => { await new Promise((r) => setTimeout(r, Math.min(ms, 5))) },
  })

test('★ 제한 시간을 넘기면 기권하고 몇 ms 였는지 남긴다', async () => {
  const judge = judgeWith(() => new Promise<string>(() => {}), 10_000)
  const result = await judge.judge(INPUT)
  assert.equal(result.status, 'abstain')
  assert.match(result.status === 'abstain' ? result.abstainReason : '', /^timeout:10000ms/)
})

test('★ 예산이 막히면 기권한다 — 실패가 아니라 기권이다', async () => {
  const judge = judgeWith(async () => { throw new JevBudgetDeniedError('일일 상한 초과') })
  const result = await judge.judge(INPUT)
  assert.equal(result.status, 'abstain')
  assert.match(result.status === 'abstain' ? result.abstainReason : '', /^budget_denied:/)
})

test('★ 호출이 오류면 실패로 적고 사유를 남긴다 — 조용히 넘어가지 않는다', async () => {
  const judge = judgeWith(async () => { throw new Error('벤더 503') })
  const result = await judge.judge(INPUT)
  assert.equal(result.status, 'failed')
  assert.match(result.status === 'failed' ? result.abstainReason : '', /call_failed:벤더 503/)
})

test('읽을 수 없는 답이면 기권한다', async () => {
  const judge = judgeWith(async () => '모르겠습니다')
  const result = await judge.judge(INPUT)
  assert.equal(result.status, 'abstain')
  assert.match(result.status === 'abstain' ? result.abstainReason : '', /^unreadable:not_json/)
})

test('ATR 이 0 이면 절대값을 대신 보내지 않고 기권한다', async () => {
  let called = 0
  const judge = judgeWith(async () => { called += 1; return '{}' })
  const result = await judge.judge({ ...INPUT, indicators: { ...INPUT.indicators, atr: 0 } })
  assert.equal(result.status, 'abstain')
  assert.equal(called, 0, 'ATR 을 못 구했는데 벤더를 불렀다')
})

test('제대로 온 답은 원점수 그대로 돌려준다', async () => {
  const judge = judgeWith(async () => '{"p_long":0.55,"p_short":0.15,"p_hold":0.30,"enter_now":0.8}')
  const result = await judge.judge(INPUT)
  assert.equal(result.status, 'completed')
  assert.deepEqual(result.status === 'completed' ? result.rawScore : null,
    { p_long: 0.55, p_short: 0.15, p_hold: 0.3, enter_now: 0.8 })
})

// ── M3: 신호를 내지 않는다 ───────────────────────────────

test('★ 판단 계층에 알림·신호 호출이 0건이다 (M3)', () => {
  for (const name of readdirSync(HERE)) {
    if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue
    const src = readFileSync(join(HERE, name), 'utf8')
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const pattern of [/sendNotification|notify\(|sendAlert|createSignal|emitSignal/, /calibrat/i]) {
      assert.equal(pattern.test(body), false,
        `${name} 이 판단 밖의 일을 한다. 원점수만 만든다 — 보정 전 값으로 신호를 내지 않는다(M3)`)
    }
  }
})

/**
 * **판단기는 특권이 없다 — 어느 벤더를 쓸지는 설정이 정한다** (§7.2)
 *
 * 실측 2026-09-27: Vercel 관문 무료 등급은 anthropic·google 모델이 전부 403 이었다.
 * 정작 우리는 Gemini 유료 키를 갖고 있었고 그 키로는 44개 모델이 다 열렸다.
 * 코드가 벤더를 박아 두면 그 사실을 알아도 못 쓴다.
 */
test('★ 공급자마다 부를 문이 있거나 없다 — 없으면 안 만든다', () => {
  // Vercel 관문은 그 자체가 OpenAI 호환 창구다
  assert.equal(openAiCompatibleBaseUrl('jev'), 'https://ai-gateway.vercel.sh/v1')
  // Gemini 는 SDK 를 쓰지만 호환 문이 따로 있다. 판단은 JSON 한 번이라 그 문으로 간다
  assert.equal(openAiCompatibleBaseUrl('gemini'), 'https://generativelanguage.googleapis.com/v1beta/openai')
  // 문이 없는 공급자는 null 이다 — 지어내지 않는다
  assert.equal(openAiCompatibleBaseUrl('claude'), null)
})

/**
 * **주소는 벤더 명세 상수에서만 온다** (S4).
 *
 * 설정은 「어느 공급자」만 고른다. 설정값이 주소에 섞이면 그 자리가 곧 바깥으로 나가는
 * 창구가 되고, 설정을 고칠 수 있는 사람이 요청을 아무 데로나 보낼 수 있게 된다.
 */
test('★ 설정값이 주소에 안 섞인다 (S4)', () => {
  const src = readFileSync(join(HERE, 'jev.ts'), 'utf8')
  const catalog = readFileSync(join(HERE, '..', '..', 'ai', 'provider-catalog.ts'), 'utf8')
  const fn = catalog.slice(catalog.indexOf('export function openAiCompatibleBaseUrl'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.ok(body.includes('getProviderSpec(provider)'), '명세에서 주소를 안 가져온다')
  assert.equal(/https?:\/\//.test(body), false, '주소를 이 자리에서 짓는다')

  // fetch 가 쓰는 주소가 명세에서 온 값 하나뿐이어야 한다
  const caller = src.slice(src.indexOf('function gatewayCaller'))
  assert.ok(caller.includes('const baseUrl = openAiCompatibleBaseUrl(provider)'), '주소를 다른 데서 만든다')
  assert.ok(caller.includes('fetch(`${baseUrl}/chat/completions`'), '주소를 안 쓰고 부른다')
  assert.equal(/fetch\(\s*`?https?:/.test(caller), false, '주소를 박아 부른다')
})

test('★ 기본값은 지금 동작 그대로다 — 고치지 않은 판이 안 바뀐다', () => {
  const src = readFileSync(join(HERE, 'jev.ts'), 'utf8')
  assert.ok(src.includes("options.provider ?? 'jev'"), '기본 공급자가 없다')
  const reg = readFileSync(join(HERE, '..', 'settings', 'registry.ts'), 'utf8')
  const at = reg.indexOf("key: 'jev_provider'")
  assert.ok(at > 0, '공급자 설정이 없다')
  assert.ok(reg.slice(at, at + 400).includes("defaultValue: 'jev'"), '기본값이 지금 동작과 다르다')
})

test('★ 사유에 어느 공급자였는지가 남는다 — 둘을 쓰면 「안 됐다」만으로는 못 찾는다', () => {
  const src = readFileSync(join(HERE, 'jev.ts'), 'utf8')
  for (const pat of ['${provider}_model_missing', '${provider}_base_url_missing', '${provider}_key_unavailable']) {
    assert.ok(src.includes(pat), `${pat} 가 공급자 이름을 안 싣는다`)
  }
  // 원장에도 그 공급자로 적혀야 「어느 쪽이 얼마나 썼나」를 센다
  assert.ok(src.includes('providerId: provider,'), '원장에 늘 jev 로 적힌다')
})

test('★ 검증과 실시간이 같은 공급자를 쓴다 (M4)', () => {
  const pipe = readFileSync(join(HERE, '..', 'validation', 'pipeline.ts'), 'utf8')
  assert.ok(pipe.includes('createServerJevJudge({ timeoutMs, model, provider })'),
    '검증이 공급자를 안 넘긴다 — 잰 성적이 실전의 것이 아니게 된다')
  assert.ok(pipe.includes("values.jev_provider"), '검증이 설정을 안 읽는다')
})
