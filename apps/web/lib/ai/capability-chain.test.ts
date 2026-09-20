/**
 * 능력마다 부르는 순서가 다르다 (P0030 I10)
 *
 * ## 무엇을 막는가
 *
 * 사슬이 하나뿐이라 요약도 이름표도 같은 모델부터 두드렸고, 그 모델 한도가 차면 전부
 * 같이 죽었다. 실측 2026-09-20: 하루 23,318건 중 22,131건이 한도로 실패 — 대부분이
 * 보내 봐야 못 가는 호출이었다.
 *
 * 무료 한도는 모델마다 따로 찬다. 그래서 «순서»가 곧 «오늘 몇 건이 실제로 나가나»다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_CAPABILITIES } from '@ax/ai-core'
import {
  chainFor, missingCapabilities, CHEAP_FIRST, GEMMA_OK,
  MODEL_BY_DAILY_QUOTA, GEMMA_MAX_INPUT_CHARS,
} from './capability-chain.ts'
import { DEFAULT_GEMINI_MODEL, supportsJsonMode } from './gemini-model.ts'

test('★ 능력 여덟이 전부 표에 있다 — 아홉째가 생기면 여기서 걸린다', () => {
  assert.deepEqual(missingCapabilities(), [])
  assert.equal(AI_CAPABILITIES.length, 8)
})

test('★ 값싼 능력은 하루 한도가 큰 것부터 부른다', () => {
  const chain = chainFor('suggest', { requireJson: true })
  const quotaOrder = MODEL_BY_DAILY_QUOTA.map((m) => m.model).filter(supportsJsonMode)
  assert.deepEqual(chain, quotaOrder, '값싼 능력의 순서가 한도 순서와 다르다')
  assert.equal(chain[0], 'gemini-flash-lite-latest', '가장 늦게 차는 버킷을 먼저 안 쓴다')
})

test('★ 되돌리기 어려운 능력은 기본 모델이 먼저고 한도 큰 쪽이 안전망이다', () => {
  for (const c of AI_CAPABILITIES.filter((x) => !CHEAP_FIRST[x])) {
    const chain = chainFor(c, { requireJson: true })
    assert.equal(chain[0], DEFAULT_GEMINI_MODEL, `${c} 가 기본 모델로 시작하지 않는다`)
    assert.ok(
      chain.includes('gemini-flash-lite-latest'),
      `${c} 사슬에 한도 큰 안전망이 없다 — flash 가 전부 429 인 날 통째로 죽는다`,
    )
    assert.ok(
      chain.indexOf('gemini-flash-lite-latest') > 0,
      `${c} 가 품질을 먼저 안 본다`,
    )
  }
})

test('★ 어드민이 고른 모델이 언제나 1순위다', () => {
  const chain = chainFor('summarize', { configured: 'gemini-3.7-flash' })
  assert.equal(chain[0], 'gemini-3.7-flash', '고른 것을 조용히 무시했다')
  // 중복으로 두 번 나오지 않는다
  assert.equal(chain.filter((m) => m === 'gemini-3.7-flash').length, 1)
})

test('★ JSON 을 못 쓰는 설정 모델은 1순위에서 빠지고 대체 모델로 간다', () => {
  const chain = chainFor('extract', { configured: 'gemma-4-26b-a4b-it', requireJson: true })
  assert.ok(!chain.includes('gemma-4-26b-a4b-it'), 'JSON 을 조용히 무시하는 모델을 세웠다')
  assert.equal(chain[0], DEFAULT_GEMINI_MODEL, '설정을 지우라고 사용자에게 미뤘다')
})

test('★ Gemma 는 열린 능력에, 짧은 입력에, JSON 을 안 강요할 때만 후보다', () => {
  const 열린능력 = AI_CAPABILITIES.filter((c) => GEMMA_OK[c])
  assert.ok(열린능력.length >= 1, 'Gemma 가 아무 데도 못 들어가면 따로인 버킷이 놀고 있다')

  for (const c of 열린능력) {
    const 짧게 = chainFor(c, { requireJson: false, inputChars: 100 })
    assert.ok(짧게.includes('gemma-4-26b-a4b-it'), `${c} 에서 Gemma 가 후보가 아니다`)
    assert.ok(
      짧게.indexOf('gemma-4-26b-a4b-it') === 짧게.length - 1,
      `${c} 에서 Gemma 가 앞에 섰다 — 약점이 있는 모델은 맨 뒤다`,
    )

    const 길게 = chainFor(c, { requireJson: false, inputChars: GEMMA_MAX_INPUT_CHARS + 1 })
    assert.ok(!길게.includes('gemma-4-26b-a4b-it'), `${c} 가 긴 입력에도 Gemma 를 연다`)

    const json강요 = chainFor(c, { requireJson: true, inputChars: 100 })
    assert.ok(!json강요.includes('gemma-4-26b-a4b-it'), `${c} 가 JSON 강요에도 Gemma 를 연다`)
  }
})

test('★ 닫힌 능력에는 Gemma 가 어떤 조건에서도 안 들어간다', () => {
  for (const c of AI_CAPABILITIES.filter((x) => !GEMMA_OK[x])) {
    const chain = chainFor(c, { requireJson: false, inputChars: 1 })
    assert.ok(
      !chain.includes('gemma-4-26b-a4b-it'),
      `${c} 에 Gemma 가 들어갔다 — 자기 초안을 답으로 뱉은 전적이 있다(v0.7.716)`,
    )
  }
})

test('★ 한도 순위에 근거가 적혀 있다 — 숫자 없이 순서만 믿게 하지 않는다', () => {
  for (const m of MODEL_BY_DAILY_QUOTA) {
    assert.ok(m.why.length >= 15, `${m.model} 의 순위 근거가 한 마디다`)
  }
  assert.ok(MODEL_BY_DAILY_QUOTA.length >= 3)
})

test('사슬에 같은 모델이 두 번 안 나온다 — 두 번이면 한도를 두 배로 쓴다', () => {
  for (const c of AI_CAPABILITIES) {
    const chain = chainFor(c, { configured: DEFAULT_GEMINI_MODEL, requireJson: false, inputChars: 10 })
    assert.equal(new Set(chain).size, chain.length, `${c} 사슬에 중복이 있다`)
  }
})

/*
  표를 두 번 적는다.

  위 시험들은 «표와 사슬이 일치하나»를 본다. 그것만으로는 표의 한 글자를 바꾸면
  시험도 따라 바뀌어 조용히 통과한다 — 실제로 extract 를 Gemma 에 열어 봤더니
  아무 시험도 안 울었다. 그래서 **열면 안 되는 목록을 여기 따로 적는다.**
  중복이지만 그 중복이 이 시험의 일이다. 정말 열어야 한다면 두 곳을 고치게 되고,
  두 번째를 고칠 때 이유를 읽게 된다.
*/
test('★ 사람이 그대로 쓰는 결과를 내는 능력은 Gemma 에 절대 안 연다', () => {
  const 절대금지 = {
    extract: '문서에서 사실을 꺼낸다 — 놓친 것을 사람이 못 알아챈다',
    summarize: '원문을 안 읽은 사람은 요약이 어긋난 줄 모른다',
    judge: '판정을 믿고 다음 일이 진행된다',
    generate: '사람이 그대로 내보낼 수 있는 글이다',
    answer: 'v0.7.716 실측 — Gemma 가 자기 초안("User input: … Option 1 …")을 답으로 뱉었다',
    transcribe: '받아쓴 것이 원본 대신 쓰인다',
  } as const
  for (const [c, why] of Object.entries(절대금지)) {
    assert.equal(GEMMA_OK[c as keyof typeof GEMMA_OK], false, `${c} 를 Gemma 에 열었다 — ${why}`)
  }
})

test('★ 되돌리기 어려운 능력을 싼 쪽으로 먼저 보내지 않는다', () => {
  const 싼쪽금지 = ['extract', 'summarize', 'judge', 'generate', 'answer', 'transcribe'] as const
  for (const c of 싼쪽금지) {
    assert.equal(
      CHEAP_FIRST[c], false,
      `${c} 를 싼 모델부터 보내게 바꿨다. 틀렸을 때 사람이 못 알아채는 일이다`,
    )
  }
})
