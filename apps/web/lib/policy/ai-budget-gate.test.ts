/**
 * 벤더로 나가는 길은 전부 예산을 묻는다 (P0030 I08)
 *
 * ## 무엇을 막는가
 *
 * 상한을 아는 자리가 한 곳도 없었다. 사슬도 재시도도 냉각도 간격도 각자 맞는 판단인데,
 * 아무도 「오늘 몇 번 남았나」를 몰라 멈추라고 말할 자리가 없었다.
 *
 * 실측 2026-09-20
 *   하루 23,318건 — 무료 등급 예산(약 600건)의 38.9배
 *   그중 22,131건은 어차피 한도로 실패했다. 보내 봐야 못 가는 호출이었다
 *
 * ## 왜 갈래를 세지 않고 전수로 보나
 *
 * 「지금 있는 넷이 묻는가」만 보면 다섯째가 생기는 날 아무도 못 잡는다. 그래서
 * guarded-call.ts 가 내보내는 **벤더로 나가는 함수 전부**를 소스에서 찾아 각각 확인한다.
 * 새 갈래를 더하면 그 함수도 자동으로 검사 대상이 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = process.cwd()
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const guarded = strip(readFileSync(join(WEB, 'lib/ai/guarded-call.ts'), 'utf8'))
const gate = strip(readFileSync(join(WEB, 'lib/ai/budget-gate.ts'), 'utf8'))
const rfp = strip(readFileSync(join(WEB, 'lib/rfp/ai/gateway.ts'), 'utf8'))
const budget = strip(readFileSync(join(WEB, 'lib/ai/budget.ts'), 'utf8'))

/**
 * 벤더로 나가는 갈래로 치지 않는 것.
 *
 * 글자만 만지는 도우미와 시험용 주입구다. 여기 이름을 더하는 것은
 * 「이 함수는 벤더를 안 부른다」는 선언이므로, 더할 때 근거를 함께 적는다.
 */
const NOT_A_LANE = new Set([
  'setBudgetGateForTest',  // 시험이 가짜 창구를 끼운다
  'resolveBudgetGate',     // 묻는 창구를 내어 주는 자리 자체다
  'unmaskStreaming',       // 이미 받은 글자에서 자리표만 되돌린다
])

function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`function ${name}`)
  assert.notEqual(start, -1, `${name} 을 찾지 못했다`)
  let i = src.indexOf('(', start)
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) break
  }
  /*
    본문의 여는 중괄호를 찾는다. 반환형이 먼저 오고 그 안에 중괄호가 있을 수 있어서
    (`): Promise<T & { k: v }> {`) 그냥 첫 중괄호를 잡으면 반환형을 본문으로 착각한다 —
    실제로 그 착각 때문에 guardedMedia 가 「예산을 안 묻는다」로 잘못 잡혔다.
    꺾쇠 깊이가 0 인 자리의 중괄호만 본문이다. `=>` 의 `>` 는 꺾쇠가 아니므로 건너뛴다.
  */
  let open = -1
  for (let j = i + 1, angle = 0; j < src.length; j++) {
    if (src[j] === '=' && src[j + 1] === '>') { j++; continue }
    if (src[j] === '<') angle++
    else if (src[j] === '>') angle = Math.max(0, angle - 1)
    else if (src[j] === '{' && angle === 0) { open = j; break }
  }
  assert.notEqual(open, -1, `${name} 본문의 시작을 찾지 못했다`)

  for (let depth = 0, j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1)
  }
  assert.fail(`${name} 본문의 끝을 찾지 못했다`)
}

function lanes(): string[] {
  return [...guarded.matchAll(/^export (?:async )?function (\w+)/gm)]
    .map((m) => m[1])
    .filter((n) => !NOT_A_LANE.has(n))
}

test('★ 벤더로 나가는 갈래가 전부 예산을 묻는다', () => {
  const found = lanes()
  assert.ok(found.length >= 4, `갈래를 ${found.length}개밖에 못 찾았다. 정규식이 빗나갔다`)

  for (const fn of found) {
    assert.match(
      bodyOf(guarded, fn),
      /await\s+askBudget\s*\(/,
      `${fn} 이 예산을 안 묻는다. 창구마다 붙이면 언젠가 한 곳이 빠지고, `
      + '빠진 그 길로 예산 밖 호출이 나간다',
    )
  }
})

test('★ 묻는 자리가 벤더를 부르기 전이다', () => {
  for (const fn of lanes()) {
    const body = bodyOf(guarded, fn)
    const askAt = body.indexOf('askBudget')
    // 실제 벤더 호출은 주입받은 call() 이거나 전송 기록이다. 둘 중 먼저 오는 것보다 앞이어야 한다
    const outbound = [body.indexOf('await call('), body.indexOf('recordTransfer')]
      .filter((i) => i >= 0)
    assert.ok(outbound.length > 0, `${fn} 에서 나가는 자리를 못 찾았다`)
    assert.ok(
      askAt < Math.min(...outbound),
      `${fn} 이 나간 뒤에 묻는다. 그러면 막아도 이미 나간 뒤다`,
    )
  }
})

test('★ 거절은 원장에 남고 전송 기록에는 안 남는다', () => {
  const body = bodyOf(guarded, 'askBudget')
  assert.match(body, /recordCall/, '거절을 원장에 안 적는다. 「왜 아무 일도 안 일어났나」에 답할 수 없다')
  assert.ok(
    !/recordTransfer/.test(body),
    '거절을 전송 기록에 적는다. 나가지 않은 것을 나갔다고 적는 원장은 아무 기록도 없는 것보다 나쁘다',
  )
  assert.match(body, /throw\s+err/, '거절하고도 그냥 진행한다')
})

test('★ RFP 관문도 같은 창구에서 받아 간다', () => {
  assert.match(rfp, /resolveBudgetGate\s*\(\)/, 'RFP 관문이 예산을 안 묻는다')
  // 자기 창구를 따로 만들면 끼워 넣은 가짜가 한쪽에만 들어가고, 그 틈이 곧 새는 길이 된다
  assert.ok(
    !/serverBudgetGate/.test(rfp),
    'RFP 관문이 세는 모듈을 직접 끌어온다. 창구는 guarded-call 한 곳에서만 고른다',
  )
  const at = rfp.indexOf('resolveBudgetGate')
  const callAt = rfp.indexOf('callGateway(')
  assert.ok(at < callAt, '모델을 두드린 뒤에 묻는다. 예산이 없으면 어느 모델로 가든 결과가 같다')
})

test('★ 던지는 쪽이 세는 모듈을 끌어오지 않는다', () => {
  // budget-gate.ts 는 서비스롤을 쓰느라 server-only 를 달고 있다. 던지기만 하려는 쪽이
  // 그 모듈을 정적으로 끌어오면 서버 밖에서는 아예 안 열린다 (실측: RFP 단위 시험 8개 사망)
  for (const [name, src] of [['guarded-call', guarded], ['rfp/ai/gateway', rfp]] as const) {
    assert.ok(
      !/^import[^\n]*from '[^']*budget-gate\.ts'/m.test(src.replace(/import type[^\n]*\n/g, '')),
      `${name} 이 budget-gate 를 정적으로 끌어온다`,
    )
  }
  assert.match(
    budget,
    /export class BudgetDeniedError/,
    '거절 예외가 순수 계층에 없다. 이름과 모양은 규칙이지 왕복이 아니다',
  )
})

test('★ 세는 모듈을 못 열어도 막지 않는다', () => {
  const body = bodyOf(guarded, 'resolveBudgetGate')
  assert.match(body, /\.catch\(/, '못 열면 그대로 터진다. 관측 장치가 새 단일 장애점이 된다')
  assert.match(body, /decideBudget\(null/, '못 열었을 때 통과로 안 떨어진다')
})

test('★ 상한을 못 읽으면 막지 않는다 — 관측 장치가 장애 원인이 되면 안 된다', () => {
  // 실패 경로마다 decideBudget(null, ...) 로 떨어져야 한다
  const body = bodyOf(gate, 'serverBudgetGate')
  const nullPaths = [...body.matchAll(/decideBudget\(\s*null/g)].length
  assert.ok(
    nullPaths >= 3,
    `못 읽는 길이 ${nullPaths}개만 통과로 떨어진다. 상한 읽기 실패·세기 실패·예외 셋을 다 덮어야 한다`,
  )
  assert.match(body, /if \(limitErr\)/, 'supabase-js 는 오류를 던지지 않고 돌려준다. 안 읽으면 조용히 통과가 된다')
})

test('서비스롤을 다루는 모듈은 server-only 를 끈다', () => {
  assert.match(gate, /import 'server-only'/, '관리자 클라이언트를 쓰는 모듈이 브라우저 묶음에 들어갈 수 있다')
})

/*
  여기부터는 소스 대조가 아니라 **실제로 돌려 보는** 시험이다.

  소스 대조는 「묻는 줄이 있나」를 보고, 이 아래는 「물어서 안 된다고 하면 실제로 안 나가나」를
  본다. 둘 다 필요하다 — 줄만 있고 던지지 않는 코드도, 던지지만 원장에 안 적는 코드도
  대조만으로는 통과한다.
*/
import {
  guardedText, guardedMedia, beginGuardedCall, guardedVector,
  setBudgetGateForTest, type AiLedger,
} from '../ai/guarded-call.ts'
import { BudgetDeniedError, decideBudget } from '../ai/budget.ts'

function spyLedger() {
  const calls: unknown[] = []
  const transfers: unknown[] = []
  const ledger: AiLedger = {
    async recordCall(r) { calls.push(r) },
    async recordTransfer(r) { transfers.push(r) },
  }
  return { ledger, calls, transfers }
}

const CTX = { surface: 'ci/discover', purpose: 'discover' }

/** 오늘 30/30 을 써서 하루 한도에 닿은 상태 */
const 소진 = decideBudget(
  { feature: 'ci/discover', dailyLimit: 30, perMinuteLimit: 5, enabled: true },
  { usedToday: 30, usedLastMinute: 0, oldestInWindowIso: null },
)

test('★ 거절되면 벤더로 한 글자도 안 나간다', async (t) => {
  t.after(() => setBudgetGateForTest(null))
  setBudgetGateForTest({ check: async () => 소진 })

  const { ledger, calls, transfers } = spyLedger()
  let 불렸나 = false
  await assert.rejects(
    guardedText('안녕', CTX, ledger, async () => { 불렸나 = true; return { text: 'ok' } }),
    (e: unknown) => e instanceof BudgetDeniedError && e.reason === 'daily',
  )

  assert.equal(불렸나, false, '막혔는데 벤더를 불렀다')
  assert.equal(transfers.length, 0, '나간 것이 없는데 전송 기록이 남았다')
  assert.equal(calls.length, 1, '거절이 원장에 안 남았다. 「왜 아무 일도 안 일어났나」에 답할 수 없다')
  const c = calls[0] as { ok: boolean; error: string; latency_ms: number }
  assert.equal(c.ok, false)
  assert.match(c.error, /ai_budget_denied\(daily\)/)
})

test('★ 거절 예외가 언제 풀리는지 함께 말한다', async (t) => {
  t.after(() => setBudgetGateForTest(null))
  setBudgetGateForTest({ check: async () => 소진 })

  const { ledger } = spyLedger()
  const e = await guardedText('안녕', CTX, ledger, async () => ({ text: 'ok' })).catch((x) => x)
  assert.ok(e instanceof BudgetDeniedError)
  assert.ok(Date.parse(e.retryAtIso) > Date.now(), '풀리는 시각이 지금보다 뒤가 아니다')
  assert.match(e.userMessage, /하루 한도/, '사용자가 읽을 말이 없다')
})

test('★ 전송을 적는 갈래도 적기 전에 막힌다', async (t) => {
  t.after(() => setBudgetGateForTest(null))
  setBudgetGateForTest({ check: async () => 소진 })

  for (const [이름, 실행] of [
    ['guardedMedia', (l: AiLedger) => guardedMedia(
      [{ kind: 'image' as const, bytes: 10 }], CTX, l, async () => ({ text: 'ok' }))],
    ['beginGuardedCall', (l: AiLedger) => beginGuardedCall('안녕', CTX, l)],
    ['guardedVector', (l: AiLedger) => guardedVector('안녕', CTX, l, async () => [0.1])],
  ] as const) {
    const { ledger, transfers } = spyLedger()
    await assert.rejects(실행(ledger), BudgetDeniedError, `${이름} 이 막히지 않았다`)
    assert.equal(transfers.length, 0, `${이름} 이 나가지도 않은 전송을 적었다`)
  }
})

test('★ 상한을 모르면 막지 않는다 — 관측 장치가 일을 멈추면 안 된다', async (t) => {
  t.after(() => setBudgetGateForTest(null))
  // 상한 줄이 없거나 못 읽은 상태 = decideBudget(null, ...)
  setBudgetGateForTest({
    check: async () => decideBudget(null, { usedToday: 0, usedLastMinute: 0, oldestInWindowIso: null }),
  })

  const { ledger, calls } = spyLedger()
  const out = await guardedText('안녕', CTX, ledger, async () => ({ text: 'ok' }))
  assert.equal(out.text, 'ok', '상한을 모른다고 사용자의 일을 멈췄다')
  assert.equal((calls[0] as { ok: boolean }).ok, true)
})

/*
  어떤 창구도 무제한이 아니다 (P0030 I19)

  상한 표에 `crm` 한 줄이 있는데 원장에 남는 창구 이름은 `crm/quick_create` 였다.
  정확히 같은 이름만 찾던 탓에 그 상한이 한 번도 안 걸렸고, 재어 보니 그것만이 아니었다 —
  **창구 마흔하나 중 서른둘이 상한이 아예 없었다.** 게이트는 모르면 통과가 설계라
  그 서른둘은 무제한이었다. 켜 놨다고 생각한 것과 실제가 달랐다.
*/
test('★ 게이트와 화면이 같은 규칙으로 상한을 고른다', () => {
  const gateSrc = strip(readFileSync(join(WEB, 'lib/ai/budget-gate.ts'), 'utf8'))
  const usage = strip(readFileSync(join(WEB, 'lib/ai/usage-query.ts'), 'utf8'))
  for (const [name, src] of [['budget-gate', gateSrc], ['usage-query', usage]] as const) {
    assert.match(src, /pickLimit\(/, `${name} 이 공용 규칙을 안 쓴다 — 둘이 갈라지면 화면이 거짓말을 한다`)
  }
  assert.match(gateSrc, /\.in\('feature', keys\)/, '게이트가 좁은 이름 하나만 읽는다')
  assert.ok(
    !/\.eq\('feature', feature\)/.test(gateSrc),
    '정확히 같은 이름만 찾는 옛 질의가 남아 있다',
  )
})

test('★ 등재부의 창구가 전부 상한에 닿는다', async () => {
  const { AI_LANES } = await import('../ai/actor.ts')
  const { budgetKeysFor, BUDGET_FALLBACK_KEY } = await import('../ai/budget.ts')
  const surfaces = new Set<string>()
  for (const lane of AI_LANES) for (const s of lane.surfaces) surfaces.add(s)
  surfaces.add('rfp')   // lib/rfp/ai/gateway.ts 의 RFP_BUDGET_FEATURE

  assert.ok(surfaces.size >= 30, `창구를 ${surfaces.size}개만 찾았다. 등재부가 비었나`)
  for (const s of surfaces) {
    assert.ok(
      budgetKeysFor(s).includes(BUDGET_FALLBACK_KEY),
      `${s} 가 받아 주는 줄에 안 닿는다 — 이 창구는 무제한이 된다`,
    )
  }
})

test('★ 받아 주는 줄을 씨앗에 심어 둔다 — 규칙만 있고 줄이 없으면 여전히 무제한이다', () => {
  const mig = readFileSync(join(WEB, '..', '..', 'supabase/migrations/268_ai_call_budget_coverage.sql'), 'utf8')
  assert.match(mig, /'\*'/, '받아 주는 줄을 안 심는다')
  assert.match(mig, /on conflict \(feature\) do nothing/i, '이미 사람이 고쳐 둔 값을 덮어쓴다')
})
