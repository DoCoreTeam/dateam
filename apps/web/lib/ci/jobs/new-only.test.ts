/**
 * 사람이 안 눌러도 도는 AI 는 전부 신규만 거른다 (P0030 I06)
 *
 * ## 무엇을 막는가
 *
 * 파생값 계산은 콘텐츠 한 건이 들어올 때마다 워크스페이스 전체를 다시 훑는 단계들을
 * 부른다. 훑는 범위는 자료가 쌓일수록 커지고 부르는 횟수는 인입 건수만큼 늘어나서,
 * 둘이 곱해진다. 그래서 그 자리의 AI 는 **이미 본 것을 빼는 장치**와 **한 번에 몇 건까지**가
 * 둘 다 있어야 한다.
 *
 * 실측 2026-09-20
 *   하루 신규 콘텐츠 7.3건에 AI 호출 23,318건 — 새 것 하나당 3,193번
 *   그 대부분이 발견 하나였고, 자동 단계 다섯 중 그것만 거르기와 상한이 둘 다 없었다
 *
 * ## 왜 등재부를 쓰나
 *
 * 「지금 있는 다섯이 규칙을 지키는가」만 보면 여섯째가 생기는 날 아무도 못 잡는다.
 * 그래서 파생값 계산이 부르는 것과 등재부를 맞춰 본다. 목록에 없는 것을 부르면 실패한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AUTO_AI_STAGES, AI_CALL_MARKERS, aiStages } from './auto-ai-stages.ts'

const CI = join(process.cwd(), 'lib', 'ci')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const read = (rel: string) => strip(readFileSync(join(CI, rel), 'utf8'))

const handlers = read('jobs/handlers.ts')

/** 함수 하나의 본문 (인자 목록을 먼저 건너뛴다) */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1, `${name} 을 찾지 못했다`)
  let i = src.indexOf('(', start)
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) break
  }
  const open = src.indexOf('{', i)
  for (let depth = 0, j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1)
  }
  assert.fail(`${name} 본문의 끝을 찾지 못했다`)
}

test('★ 파생값 계산이 부르는 재훑기는 전부 등재돼 있다', () => {
  const body = bodyOf(handlers, 'handleProject')
  // `await runXxx(` 꼴만 본다. 값 계산(computeDerived)도 걸리므로 아래 허용 목록으로 뺀다
  const called = [...body.matchAll(/await\s+([a-zA-Z][\w]*)\s*\(/g)].map((m) => m[1])

  /** AI 와 무관한 값 계산. 워크스페이스를 훑지 않고 이 콘텐츠만 본다 */
  const PURE = new Set(['computeDerived', 'recomputeChannelDerived'])
  const listed = new Set(AUTO_AI_STAGES.map((s) => s.fn))

  for (const fn of new Set(called)) {
    if (PURE.has(fn)) continue
    assert.ok(
      listed.has(fn),
      `${fn} 이 등재부에 없다. 파생값 계산이 부르는 재훑기는 `
      + 'lib/ci/jobs/auto-ai-stages.ts 에 적고, AI 를 쓴다면 거르기와 회당 상한을 증명해야 한다',
    )
  }
})

test('★ AI 를 부르는 재훑기는 이미 본 것을 뺀다', () => {
  for (const s of aiStages()) {
    const src = read(s.file)
    const body = bodyOf(src, s.fn)
    const seenBy = s.ai.calls === 'ai' ? s.ai.seenBy : ''
    assert.ok(
      body.includes(seenBy),
      `${s.fn} 에서 「${seenBy}」를 찾지 못했다. `
      + '이미 본 것을 안 빼면 자료가 쌓일수록 같은 것을 다시 묻는다',
    )
  }
})

test('★ AI 를 부르는 재훑기는 한 번에 몇 건까지인지 정해져 있다', () => {
  for (const s of aiStages()) {
    const src = read(s.file)
    const body = bodyOf(src, s.fn)
    const capBy = s.ai.calls === 'ai' ? s.ai.capBy : ''
    assert.ok(
      body.includes(capBy),
      `${s.fn} 에서 상한 「${capBy}」를 찾지 못했다. `
      + '상한이 없으면 밀린 것이 많은 날 한 번에 하루치 예산을 통째로 쓴다',
    )
  }
})

test('★ 「AI 를 안 쓴다」고 적힌 단계는 실제로 안 쓴다', () => {
  for (const s of AUTO_AI_STAGES) {
    if (s.ai.calls !== 'none') continue
    const body = bodyOf(read(s.file), s.fn)
    for (const marker of AI_CALL_MARKERS) {
      assert.ok(
        !body.includes(marker),
        `${s.fn} 이 ${marker} 를 부른다. 등재부에는 AI 를 안 쓴다고 적혀 있다. `
        + '둘 중 하나가 거짓이고, 거짓인 쪽은 대개 등재부다',
      )
    }
  }
})

test('발견과 공식은 등재부에 없다 — 단건 처리에서 떼어 버튼으로 옮겼다', () => {
  const listed = AUTO_AI_STAGES.map((s) => s.fn)
  assert.ok(!listed.includes('runDiscovery'), 'runDiscovery 가 다시 자동으로 돈다')
  assert.ok(!listed.includes('runPatterns'), 'runPatterns 가 다시 자동으로 돈다')
})

test('등재부에 같은 함수가 두 번 적히지 않는다', () => {
  const names = AUTO_AI_STAGES.map((s) => s.fn)
  assert.equal(new Set(names).size, names.length, '중복이 있으면 한쪽만 고쳐도 통과한다')
})

test('등재된 단계는 왜 자동인지 적혀 있다', () => {
  for (const s of AUTO_AI_STAGES) {
    assert.ok(s.why.trim().length >= 10, `${s.fn} 이 자기가 왜 자동인지 말하지 않는다`)
  }
})
