/**
 * 청산 판단 Jev — **섀도다. 알림으로 안 나간다** (§7.3 D-11)
 *
 * 진입을 틀리면 안 들어가면 그만이지만, 청산을 틀리면 이미 들고 있는 것을
 * 잘못 놓거나 잘못 붙든다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  EXIT_PROMPT_VERSION, EXIT_RESPONSE_SHAPE,
  buildExitContext, buildExitPrompt, parseExitResponse, leansExit, exitCloses,
  type ExitContext,
} from './exit-core.ts'
import { JEV_PROMPT_VERSION } from './jev-prompt.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const CTX: ExitContext = {
  direction: 'long', unrealizedAtr: 0.8, atrToStop: 1.4, atrToTarget: 0.7,
  minutesHeld: 12, minutesToSessionExit: 95,
}

test('보유 상태를 ATR 배수로 만든다', () => {
  const ctx = buildExitContext({
    direction: 'long', entryPrice: 300, currentPrice: 301, stopPrice: 298.5,
    targetPrice: 302.5, atr: 1.25, minutesHeld: 12.4, minutesToSessionExit: 95.6,
  })
  assert.ok(ctx)
  assert.equal(ctx.unrealizedAtr, 0.8)
  assert.equal(ctx.atrToStop, 2)
  assert.equal(ctx.atrToTarget, 1.2)
  assert.equal(ctx.minutesHeld, 12)
  assert.equal(ctx.minutesToSessionExit, 96)
})

test('★ 매도 보유는 부호가 뒤집힌다 — 안 뒤집으면 손실이 이익으로 적힌다', () => {
  const short = buildExitContext({
    direction: 'short', entryPrice: 300, currentPrice: 301, stopPrice: 301.5,
    targetPrice: 297.5, atr: 1, minutesHeld: 1, minutesToSessionExit: 10,
  })
  assert.ok(short)
  assert.equal(short.unrealizedAtr, -1, '매도인데 값이 오른 것을 이익으로 적었다')
})

test('★ ATR 이 0 이면 상대값을 못 만들어 안 만든다', () => {
  assert.equal(buildExitContext({
    direction: 'long', entryPrice: 300, currentPrice: 301, stopPrice: 299,
    targetPrice: 302, atr: 0, minutesHeld: 1, minutesToSessionExit: 10,
  }), null)
})

// ── §7.3 절대값 금지 ─────────────────────────────────────

test('★ 프롬프트에 절대 날짜도 절대 가격도 없다 (§7.3)', () => {
  const { text } = buildExitPrompt(CTX, [-0.4, -0.1, 0])
  assert.ok(text.includes('날짜·뉴스·지수 수준을 짐작하지 않는다'))
  // 지수 수준으로 읽힐 세 자리 이상 숫자가 없다
  const bigNumbers = text.match(/\b\d{3,}\b/g) ?? []
  assert.deepEqual(bigNumbers, [], `절대값으로 읽힐 숫자가 있다: ${bigNumbers.join(', ')}`)
  // 연도도 없다
  assert.equal(/20\d\d/.test(text), false, '연도가 프롬프트에 있다')
})

test('★ 시각을 「세션 시작 후 N분」 꼴로만 말한다', () => {
  const { text } = buildExitPrompt(CTX, [0])
  assert.ok(text.includes('보유: 12분'))
  assert.ok(text.includes('당일 청산까지: 95분'))
  assert.equal(/\d{1,2}:\d{2}/.test(text), false, '시계 시각이 프롬프트에 있다')
})

test('같은 입력에 같은 지문이 나온다 — 나중에 재현을 확인할 자리', () => {
  assert.equal(buildExitPrompt(CTX, [0]).fingerprint, buildExitPrompt(CTX, [0]).fingerprint)
  assert.notEqual(
    buildExitPrompt(CTX, [0]).fingerprint,
    buildExitPrompt({ ...CTX, minutesHeld: 13 }, [0]).fingerprint)
})

test('★ 진입 프롬프트와 판 번호가 따로다 — 묻는 것이 다르면 판도 달라야 한다', () => {
  assert.equal(EXIT_PROMPT_VERSION, 'exit-prompt-v1')
  assert.notEqual(EXIT_PROMPT_VERSION, JEV_PROMPT_VERSION)
})

// ── 답 읽기 ──────────────────────────────────────────────

test('두 확률을 읽고 합을 1 로 맞춘다', () => {
  assert.deepEqual(parseExitResponse('{"p_hold":0.6,"p_exit":0.4}'), { p_hold: 0.6, p_exit: 0.4 })
  // 합이 1 이 아니어도 버리지 않는다 — 버리면 멀쩡한 판단이 기권으로 샌다
  assert.deepEqual(parseExitResponse('{"p_hold":3,"p_exit":1}'), { p_hold: 0.75, p_exit: 0.25 })
})

test('앞뒤에 말이 붙어도 한 번은 건진다', () => {
  assert.deepEqual(parseExitResponse('생각해 보면 {"p_hold":0.5,"p_exit":0.5} 입니다'),
    { p_hold: 0.5, p_exit: 0.5 })
})

test('★ 못 읽으면 지어내지 않고 null — 산문을 억지로 숫자로 안 만든다', () => {
  for (const bad of ['나가는 게 좋겠습니다', '{"p_hold":"높음"}', '{}', '{"p_hold":-1,"p_exit":2}', '{"p_hold":0,"p_exit":0}']) {
    assert.equal(parseExitResponse(bad), null, `「${bad}」 를 읽었다`)
  }
})

test('기울기만 판정하고 알림을 안 만든다', () => {
  assert.equal(leansExit({ p_hold: 0.4, p_exit: 0.6 }), true)
  assert.equal(leansExit({ p_hold: 0.6, p_exit: 0.4 }), false)
  // 같으면 나가라고 하지 않는다 — 들고 있는 것을 놓는 쪽이 되돌리기 어렵다
  assert.equal(leansExit({ p_hold: 0.5, p_exit: 0.5 }), false)
})

test('최근 종가를 ATR 배수로, 지금을 0 으로', () => {
  const input = {
    bars: [{ close: 100 }, { close: 101 }, { close: 102 }],
    indicators: { atr: 2 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
  assert.deepEqual(exitCloses(input, 3), [-1, -0.5, 0])
  assert.deepEqual(exitCloses({ ...input, indicators: { atr: 0 } }, 3), [])
})

// ── 섀도임을 지키는가 ────────────────────────────────────

test('★ 청산 판단이 신호·알림 표로 가는 길이 0개다', () => {
  const src = readFileSync(join(HERE, 'exit-jev.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const banned of ['trading_signals', 'trading_notifications', 'queueNotification', 'saveSignal', 'decideEmit']) {
    assert.equal(src.includes(banned), false, `청산 판단이 ${banned} 에 닿는다 — 섀도가 아니다`)
  }
  // 쓰는 표가 하나뿐이다
  const writes = [...src.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1])
  assert.deepEqual([...new Set(writes)], ['trading_exit_judgments'])
})

test('★ 섀도가 아닌 행은 DB 가 거절한다 — 코드만으로 안 막는다', () => {
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '285_trading_knowledge.sql'), 'utf8')
  assert.ok(sql.includes('is_shadow     BOOLEAN     NOT NULL DEFAULT TRUE CHECK (is_shadow)'),
    'is_shadow 검사 제약이 없다')
})

test('★ 진입 Jev 와 같은 키·같은 예산·같은 원장을 쓴다 (§17.1)', () => {
  const exit = readFileSync(join(HERE, 'exit-jev.ts'), 'utf8')
  const entry = readFileSync(join(HERE, 'jev.ts'), 'utf8')
  for (const shared of ['guardedText', 'serverAiLedger', 'resolveProviderKey', "getProviderSpec('jev')"]) {
    assert.ok(exit.includes(shared), `청산이 ${shared} 를 안 쓴다`)
    assert.ok(entry.includes(shared), `진입이 ${shared} 를 안 쓴다 — 비교 대상이 틀렸다`)
  }
  assert.ok(exit.includes("resolveProviderKey('jev'"), '청산이 다른 공급자 키를 쓴다')
})

test('★ 선점한 실행만 벤더를 부른다 (§14.3 D-33)', () => {
  const src = readFileSync(join(HERE, 'exit-jev.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function judgeExitShadow'))
  const claimAt = fn.indexOf('await claim(')
  const callAt = fn.indexOf('callVendor(')
  assert.ok(claimAt > 0 && callAt > 0)
  assert.ok(claimAt < callAt, '선점보다 먼저 벤더를 부른다 — 두 크론이 같은 분에 두 번 부른다')
  assert.ok(fn.includes("return { status: 'abstain', reason: 'already_claimed' }"))
})

test('★ 대기 시간 초과·예산 초과가 실패가 아니라 기권이다', () => {
  const src = readFileSync(join(HERE, 'exit-jev.ts'), 'utf8')
  assert.ok(src.includes("reason: `timeout:${input.timeoutMs}ms`"), '초과를 기권으로 안 적는다')
  assert.ok(src.includes("status: 'abstain' as const, reason: 'budget_denied'"), '예산 거절을 실패로 적는다')
  // 기권도 기록한다 — 기권률을 세어 봐야 편향이 생겼는지 안다
  assert.ok(src.includes('await finish(claimed, outcome, requestAt, responseAt, model, input.now)'))
})

test('★ 판단 계층이 지금 시각을 직접 안 묻는다 (M5) — 백테스트가 미래를 본다', () => {
  const src = readFileSync(join(HERE, 'exit-jev.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  // `new Date(input.now.getTime() + ...)` 처럼 **받은 시각에서 파생**하는 것만 된다
  const bare = [...src.matchAll(/new Date\(([^)]*)\)/g)].map((m) => m[1].trim())
  for (const arg of bare) {
    assert.notEqual(arg, '', '인자 없는 new Date() 가 있다 — 지금 시각을 직접 묻는다')
    assert.ok(arg.includes('input.now'), `받은 시각에서 안 나온 시각이 있다: new Date(${arg})`)
  }
  assert.equal(/Date\.now\(\)/.test(src), false, 'Date.now() 를 쓴다')
})
