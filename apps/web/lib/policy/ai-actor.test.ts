/**
 * 벤더로 나가는 호출에 주인이 붙는다 (P0030 I08a)
 *
 * ## 무엇을 막는가
 *
 * 실측 2026-09-20: 원장 50,243건이 **전부** actor_id 가 비어 있었다. 하루 23,318건이
 * 나가는데 누가 태웠는지 한 건도 못 가렸다. 원장이 있는데 물음에 답을 못 하는 상태였다.
 *
 * ## 왜 등재부를 대조하나
 *
 * 「지금 있는 열 곳을 고쳤나」만 보면 서른여섯째가 생기는 날 아무도 못 잡는다.
 * 여기서는 소스를 전수로 훑어 **벤더로 나가는 파일 목록**을 만들고, 그것이 등재부와
 * 한 글자도 안 틀리는지 본다. 새 자리를 만들면 등재부에 없어서 실패하고,
 * 관문으로 옮겨 사라지면 등재부에 남아서 실패한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_LANES, laneOf, needsActor, unwiredLanes, UNWIRED_BASELINE } from '../ai/actor.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 벤더로 나가는 갈래를 여는 함수들. 여기 이름이 늘면 등재부도 함께 늘어야 한다 */
const LANE_OPENERS = [
  'beginGuardedCall', 'guardedText', 'guardedMedia', 'guardedVectors', 'guardedVector',
  'guardedGeminiText', 'guardedGeminiStream', 'guardedGeminiParts',
  'callGeminiJson', 'callGeminiText', 'callGeminiParts',
]

/**
 * 여는 함수를 찾는 조각. **제네릭 인자를 건너뛴다** — `guardedVector<number[]>(` 처럼
 * 이름과 괄호 사이에 꺾쇠가 끼면 `이름\s*\(` 은 안 맞는다. 그 한 글자 차이로
 * lib/gemini-embedding.ts 가 등재부 검사에서 통째로 빠져 있었다 (실측 2026-09-20).
 */
const OPENER_SRC = `\\b(?:${LANE_OPENERS.join('|')})\\s*(?:<[^()]*?>\\s*)?\\(`

/**
 * 갈래를 «여는» 것이 아니라 «만드는» 파일들.
 *
 * 공통 호출기 자신과, 그 호출기가 안에서 쓰는 부품이다. 등재부에 넣으면
 * 「주인을 넘겨라」를 자기 자신에게 요구하게 된다.
 */
const LANE_ITSELF = new Set([
  'lib/ai/guarded-call.ts',    // 갈래 자체
  'lib/ai/guarded-gemini.ts',  // 갈래를 감싼 Gemini 붙임쇠
  'lib/ai/gemini-call.ts',     // Gemini 공통 호출기
  'lib/ai/fallback-text.ts',   // 사슬이 전부 실패한 뒤의 두 번째 공급자
  'lib/api-docs/ai-layer.ts',  // 이름을 문서로 적어 둔 곳이지 호출이 아니다
])

const OPEN_RE = new RegExp(OPENER_SRC)

function scanLaneFiles(): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.includes('.test.')) continue
      const rel = relative(WEB, full)
      if (LANE_ITSELF.has(rel)) continue
      if (OPEN_RE.test(readFileSync(full, 'utf8'))) hits.push(rel)
    }
  }
  for (const root of ['lib', 'app']) walk(join(WEB, root))
  return hits.sort()
}

const read = (f: string) => readFileSync(join(WEB, f), 'utf8')

/**
 * 벤더를 부르는 **인자 덩어리**만 잘라 낸다.
 *
 * 파일 아무 데나 있는 `actorId` 를 세면 안 된다 — 인자로 받아 두고 정작 호출에는 안 넘기는
 * 코드가 그대로 통과한다. 실제로 그렇게 통과했다(daily-prompt-governance 에서 넘기는 줄
 * 하나만 빼도 가드가 안 울었다). 그래서 여는 함수의 괄호 안만 본다.
 */
/**
 * 이 호출이 주인을 넘기나.
 *
 * 인자 안에 `actorId` 가 바로 있으면 맞다. 없으면 **맥락을 변수로 넘긴 길**이다 —
 * 같은 객체를 호출 뒤에도 읽어야 해서 미리 만들어 두는 자리가 있다(crm/ai/runner).
 * 그때는 그 변수의 선언을 찾아 거기에 `surface` 와 `actorId` 가 함께 있는지 본다.
 * 변수 이름만 보고 통과시키면 아무 객체나 넘겨도 맞다고 하게 된다.
 */
function 주인이있나(src: string, args: string): boolean {
  if (/\bactorId\b/.test(args)) return true
  for (const m of args.matchAll(/\b([a-zA-Z_$][\w$]*)\b(?:\s+as\s+\w+)?\s*[,)]/g)) {
    const decl = new RegExp(`const ${m[1]}\\s*(?::[^=]*)?=\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(src)
    // 선언 안에 actorId 가 있으면 맞다. 맥락 객체일 수도(surface 를 든) 호출 인자 묶음일 수도
    // 있는데(prompt·apiKey 를 든 common), 둘 다 그 값이 관문까지 간다
    if (decl && /\bactorId\b/.test(decl[1])) return true
  }
  return false
}

function callArgsIn(src: string): string[] {
  const out: string[] = []
  const re = new RegExp(OPENER_SRC, 'g')
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let i = m.index + m[0].length - 1
    for (let depth = 0; i < src.length; i++) {
      if (src[i] === '(') depth++
      else if (src[i] === ')' && --depth === 0) break
    }
    out.push(src.slice(m.index, i + 1))
  }
  return out
}


test('★ 벤더로 나가는 파일이 전부 등재부에 있다', () => {
  const missing = scanLaneFiles().filter((f) => !laneOf(f))
  assert.deepEqual(missing, [], [
    '벤더로 나가는 자리가 생겼는데 등재부에 없다.',
    '누가 태웠는지 못 가리는 호출이 또 늘어난다 — 원장 50,243건이 전부 비어 있던 이유다.',
    'lib/ai/actor.ts 의 AI_LANES 에 kind 와 why 를 적어 더한다:',
    ...missing.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 사라진 자리는 등재부에서도 지운다', () => {
  const now = new Set(scanLaneFiles())
  const stale = AI_LANES.map((l) => l.file).filter((f) => !now.has(f))
  assert.deepEqual(stale, [], [
    '등재부에 있는데 실제로는 벤더를 안 부른다. 안 맞는 목록은 다음 사람을 속인다:',
    ...stale.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 사람이 누르는 자리는 벤더를 부르는 그 자리에서 주인을 넘긴다', () => {
  const 빠진곳: string[] = []
  for (const lane of AI_LANES.filter(needsActor)) {
    const args = callArgsIn(read(lane.file))
    assert.ok(args.length > 0, `${lane.file} 에서 벤더를 부르는 자리를 못 찾았다`)
    const 안넘기는곳 = args.filter((a) => !주인이있나(read(lane.file), a))
    if (안넘기는곳.length > 0) {
      빠진곳.push(`  ${lane.file} — ${lane.why} (${안넘기는곳.length}/${args.length}곳)`)
    }
  }
  assert.deepEqual(빠진곳, [], [
    '사람이 누르는 창구인데 벤더를 부르는 자리에 actorId 가 없다.',
    '인자로 받아 두고 안 넘기면 원장에서는 똑같이 빈칸이다:',
    ...빠진곳,
  ].join('\n'))
})

test('★ 배경 작업은 사람이 없다는 사유와 이름을 갖는다', () => {
  for (const lane of AI_LANES.filter((l) => l.kind === 'background')) {
    assert.ok(lane.why.length >= 10, `${lane.file} 의 사유가 「배경」 한 마디다. 다음 사람이 판단을 못 한다`)
    assert.ok(lane.surfaces.length >= 1, `${lane.file} 에 창구 이름이 없다. 사람이 없으면 이름이 주인을 대신한다`)
    // 이름이 문자열 그대로 소스에 있어야 원장에서 그 이름으로 가려진다
    const src = read(lane.file)
    for (const s of lane.surfaces) {
      assert.ok(src.includes(`'${s}'`), `${lane.file} 에 창구 이름 '${s}' 가 문자열로 없다`)
    }
  }
})

test('★ 아직 안 이어 붙인 자리가 늘지 않았다', () => {
  const now = unwiredLanes()
  assert.ok(
    now.length <= UNWIRED_BASELINE,
    `주인 없는 사람 창구가 ${UNWIRED_BASELINE} 에서 ${now.length} 로 늘었다. `
    + '「나중에」로 여는 길을 새로 만들지 않는다',
  )
  // 줄였으면 기준선도 따라 내린다 — 안 내리면 다음에 다시 늘려도 안 잡힌다
  assert.equal(
    now.length, UNWIRED_BASELINE,
    `${UNWIRED_BASELINE - now.length}곳을 이어 붙였으면 UNWIRED_BASELINE 도 ${now.length} 로 내린다`,
  )
})

test('★ 공통 호출기에 주인을 넘길 칸이 있다', () => {
  const src = read('lib/ai/gemini-call.ts')
  assert.match(src, /actorId\?: string \| null/, 'gemini-call 이 주인을 받을 칸이 없다')
  assert.match(
    src, /actorId: opts\.actorId \?\? null/,
    '받기만 하고 관문에 안 넘긴다. 받아서 버리는 칸은 없는 것보다 나쁘다',
  )
})

test('★ 받은 주인이 원장까지 간다', async () => {
  const { guardedText, setBudgetGateForTest } = await import('../ai/guarded-call.ts')
  const calls: unknown[] = []
  const ledger = {
    async recordCall(r: unknown) { calls.push(r) },
    async recordTransfer() {},
  }
  setBudgetGateForTest({ check: async () => ({ allowed: true as const, remainingToday: 9 }) })
  try {
    await guardedText('안녕', { surface: 'x', purpose: 'y', actorId: 'u-42' }, ledger, async () => ({ text: 'ok' }))
  } finally {
    setBudgetGateForTest(null)
  }
  assert.equal((calls[0] as { actor_id: string }).actor_id, 'u-42', '넘긴 주인이 원장에 안 적혔다')
})

/*
  값이 실제로 실려 오나 (P0030 I08d)

  위 시험들은 «벤더를 부르는 자리에 actorId 가 적혀 있나»를 본다. 그것만으로는
  `actorId: null` 을 적어 두고 통과한다 — 일부러 그렇게 바꿔 봤더니 아무도 안 울었다.
  주인을 **데이터에서 끌어오는** 길은 그 끌어오는 질의가 살아 있는지도 함께 봐야 한다.
  타입에 칸만 내고 질의를 안 고치면 런타임에 빈칸이 되고, 형 검사는 그것을 못 잡는다.
*/
test('★ 배경 일꾼은 주인을 데이터에서 실제로 읽어 온다', () => {
  const src = read('lib/meeting/transcribe-parts.ts')
  assert.match(src, /select\('id, user_id'\)/, '노트 주인을 읽는 질의가 없다')
  assert.match(
    src, /transcribeOnePart\([^)]*owners\.get\(/,
    '읽어 놓고 안 넘긴다. 원장은 예전처럼 빈칸이 된다',
  )
  assert.match(
    src, /if \(error\)/,
    'supabase-js 는 오류를 던지지 않고 돌려준다. 안 보면 조용히 주인 없는 호출이 된다',
  )
})
