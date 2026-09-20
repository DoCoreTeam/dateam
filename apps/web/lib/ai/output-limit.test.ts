/**
 * 생각은 끄는 것이 기본이고 상한은 능력이 정한다 (P0030 I11)
 *
 * ## 무엇을 막는가
 *
 * 생각 예산을 끄는 자리가 저장소 전체에 **한 곳**뿐이었다(daily/flow-reason). 나머지는
 * 전부 벤더 기본값으로 생각했고, 생각 토큰은 답에 안 보이면서 값은 그대로 나간다.
 * 출력 상한은 어디서나 32,768 이었다 — 상한은 최대치지 쓸 만큼이 아닌데, 넉넉하면
 * 모델이 넉넉하게 답한다.
 *
 * 기본을 뒤집는 변경이라, 빠뜨렸을 때 **싸지는 쪽**으로 빠뜨리게 만드는 것이 요점이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_CAPABILITIES } from '@ax/ai-core'
import { OUTPUT_LIMIT, THINKING_ON, NO_THINKING, generationFor, missingOutputLimits } from './output-limit.ts'

const WEB = process.cwd()
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

test('★ 능력 여덟이 전부 상한을 갖는다', () => {
  assert.deepEqual(missingOutputLimits(AI_CAPABILITIES), [])
  for (const c of AI_CAPABILITIES) {
    assert.ok(OUTPUT_LIMIT[c].tokens > 0, `${c} 상한이 0 이다`)
    assert.ok(OUTPUT_LIMIT[c].why.length >= 10, `${c} 상한의 근거가 한 마디다`)
  }
})

test('★ 어느 능력도 예전 기본값(32,768)을 그대로 쓰지 않는다', () => {
  for (const c of AI_CAPABILITIES) {
    assert.ok(
      OUTPUT_LIMIT[c].tokens < 32_768,
      `${c} 가 아직 32,768 이다. 상한을 능력별로 나눈 뜻이 없다`,
    )
  }
})

test('★ 생각은 꺼짐이 기본이고 켜는 능력만 근거와 함께 적혀 있다', () => {
  const 켠것 = AI_CAPABILITIES.filter((c) => THINKING_ON[c])
  assert.ok(켠것.length <= 2, `생각을 ${켠것.length}개 능력에서 켰다. 기본을 뒤집은 뜻이 없어진다`)
  for (const c of 켠것) {
    assert.ok(
      (THINKING_ON[c] ?? '').length >= 15,
      `${c} 에 생각을 켠 이유가 한 마디다. 늘리는 쪽이 근거를 댄다`,
    )
  }
  for (const c of AI_CAPABILITIES.filter((x) => !THINKING_ON[x])) {
    assert.deepEqual(generationFor(c).thinkingConfig, NO_THINKING, `${c} 가 생각을 안 껐다`)
  }
})

test('★ 부르는 쪽이 직접 준 값이 표를 이긴다 — 재어 본 값이 사라지면 안 된다', () => {
  const g = generationFor('suggest', { maxOutputTokens: 300, thinkingConfig: { thinkingBudget: 0 } })
  assert.equal(g.maxOutputTokens, 300)
  assert.deepEqual(g.thinkingConfig, { thinkingBudget: 0 })
})

test('★ 벤더를 부르는 자리가 전부 생각 예산을 실어 보낸다', () => {
  // gemini-call: 요청 본문에 한 번
  const call = strip(read('lib/ai/gemini-call.ts'))
  assert.match(call, /generationConfig:\s*\{[\s\S]{0,400}thinkingConfig/,
    'gemini-call 의 요청 본문에 생각 예산이 없다 — 벤더 기본값으로 생각한다')

  // guarded-gemini: 벤더를 부르는 자리마다
  const gg = strip(read('lib/ai/guarded-gemini.ts'))
  const 설정자리 = [...gg.matchAll(/generationConfig:\s*\{/g)].length
  const 기본자리 = [...gg.matchAll(/\.\.\.generationOf\(input\)/g)].length
  assert.ok(설정자리 >= 3, `벤더 호출 자리를 ${설정자리}개만 찾았다. 정규식이 빗나갔다`)
  assert.equal(
    기본자리, 설정자리,
    `${설정자리}곳 중 ${기본자리}곳만 생각을 끈다. 한 곳이라도 빠지면 그 길로 생각 토큰이 계속 나간다`,
  )
})

test('★ 부르는 쪽 값이 기본보다 뒤에 얹힌다 — 순서가 뒤집히면 표가 덮는다', () => {
  const gg = strip(read('lib/ai/guarded-gemini.ts'))
  // 자리마다 «기본이 먼저, 부른 쪽이 나중»인지 본다. 중괄호로 끊으면 `{}` 에 걸려 헛짚는다
  const 기본 = [...gg.matchAll(/\.\.\.generationOf\(input\)/g)].map((m) => m.index ?? -1)
  const 덮개 = [...gg.matchAll(/\.\.\.\(input\.extraConfig \?\? \{\}\)/g)].map((m) => m.index ?? -1)
  assert.equal(기본.length, 덮개.length, '기본과 덮개의 자리 수가 다르다')
  assert.ok(기본.length >= 3, `자리를 ${기본.length}개만 찾았다. 정규식이 빗나갔다`)
  for (let i = 0; i < 기본.length; i++) {
    assert.ok(
      기본[i] < 덮개[i],
      `${i + 1}번째 자리에서 표가 부른 쪽 값보다 뒤에 온다. 재어 본 값(300토큰)이 덮인다`,
    )
  }
})

test('상한이 낮아도 조용히 잘리지 않는다 — 잘렸다고 말하는 길이 그대로다', () => {
  const call = read('lib/ai/gemini-call.ts')
  assert.match(call, /reason: 'truncated'/, '잘림을 말하는 길이 사라졌다')
  assert.match(call, /출력 상한\(\$\{maxOutputTokens\} 토큰\)에서 잘림/, '잘렸다는 말에 숫자가 없다')
})
