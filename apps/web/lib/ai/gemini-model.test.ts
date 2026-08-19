// lib/ai/gemini-model.ts — 모델 SSOT 가드
//
// 왜 이 가드가 필요한가(v0.7.571): 죽은 모델 문자열이 22개 파일에 하드코딩돼 있었고,
// Gemma가 JSON 모드를 조용히 무시한다는 사실을 코드 어디에도 적어두지 않아
// 관리자 설정에서 Gemma를 고른 순간 회의노트 AI가 100% 실패했다.
// 여기서 잠그는 것은 "다시 그렇게 되지 않는다"는 계약이다.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODEL_FALLBACKS,
  describeModelIssue,
  resolveGeminiModelChain,
  supportsJsonMode,
} from './gemini-model.ts'

describe('supportsJsonMode', () => {
  it('★ Gemma 계열은 JSON 모드를 지원하지 않는다 — 실측: HTTP 200인데 산문이 온다', () => {
    assert.equal(supportsJsonMode('gemma-4-26b-a4b-it'), false)
    assert.equal(supportsJsonMode('gemma-4-31b-it'), false)
    assert.equal(supportsJsonMode('GEMMA-3-27B'), false)
  })

  it('Gemini 계열은 지원한다 — 과차단하면 쓸 모델이 없어진다', () => {
    assert.equal(supportsJsonMode('gemini-3.6-flash'), true)
    assert.equal(supportsJsonMode('gemini-3.7-flash'), true)
    assert.equal(supportsJsonMode('gemini-flash-latest'), true)
  })

  it('임베딩·TTS·이미지 전용 모델도 제외한다 — generateContent JSON 용도가 아니다', () => {
    assert.equal(supportsJsonMode('text-embedding-004'), false)
    assert.equal(supportsJsonMode('gemini-2.5-flash-preview-tts'), false)
    assert.equal(supportsJsonMode('gemini-3.1-flash-image'), false)
  })

  it('빈 값은 지원 안 함 — 설정이 비었을 때 1순위로 올라가면 안 된다', () => {
    assert.equal(supportsJsonMode(''), false)
    assert.equal(supportsJsonMode(null), false)
    assert.equal(supportsJsonMode(undefined), false)
  })
})

describe('resolveGeminiModelChain', () => {
  it('설정 모델이 쓸 수 있으면 1순위다 — 어드민 선택을 존중한다', () => {
    const chain = resolveGeminiModelChain('gemini-3.7-flash')
    assert.equal(chain[0], 'gemini-3.7-flash')
  })

  it('★ JSON을 못 내는 설정 모델은 체인에서 빠진다 — 화면이 먼저 살아야 한다', () => {
    const chain = resolveGeminiModelChain('gemma-4-26b-a4b-it')
    assert.ok(!chain.includes('gemma-4-26b-a4b-it'))
    assert.equal(chain[0], DEFAULT_GEMINI_MODEL)
  })

  it('설정이 없으면 기본 모델부터 시작한다', () => {
    assert.equal(resolveGeminiModelChain(null)[0], DEFAULT_GEMINI_MODEL)
    assert.equal(resolveGeminiModelChain('  ')[0], DEFAULT_GEMINI_MODEL)
  })

  it('★ 체인은 항상 2개 이상이다 — 하나가 404·503이어도 다음이 받는다(실측: 가용성이 실시간으로 흔들린다)', () => {
    assert.ok(resolveGeminiModelChain(null).length >= 2)
    assert.ok(resolveGeminiModelChain('gemma-4-31b-it').length >= 2)
  })

  it('중복은 제거한다 — 같은 모델을 두 번 시도해봐야 답이 같다', () => {
    const chain = resolveGeminiModelChain(DEFAULT_GEMINI_MODEL)
    assert.equal(new Set(chain).size, chain.length)
  })

  it('requireJson=false면 Gemma도 쓸 수 있다 — 텍스트만 필요한 호출까지 막지 않는다', () => {
    const chain = resolveGeminiModelChain('gemma-4-31b-it', { requireJson: false })
    assert.equal(chain[0], 'gemma-4-31b-it')
  })
})

describe('describeModelIssue', () => {
  it('★ 대체한 이유를 사람 말로 준다 — 조용히 바꾸면 왜 결과가 다른지 아무도 모른다', () => {
    const msg = describeModelIssue('gemma-4-26b-a4b-it')
    assert.ok(msg)
    assert.ok(msg.includes('gemma-4-26b-a4b-it'))
    assert.ok(msg.includes(DEFAULT_GEMINI_MODEL))
    assert.ok(msg.includes('관리자 설정'))
  })

  it('쓸 수 있는 모델이면 이유가 없다 — 없는 문제를 알리지 않는다', () => {
    assert.equal(describeModelIssue('gemini-3.6-flash'), null)
    assert.equal(describeModelIssue(''), null)
  })
})

describe('상수 계약', () => {
  it('★ 죽은 모델 gemini-2.0-flash가 기본값·체인에 없다 — 이것이 이번 사고의 진원이다', () => {
    assert.notEqual(DEFAULT_GEMINI_MODEL, 'gemini-2.0-flash')
    assert.ok(!GEMINI_MODEL_FALLBACKS.includes('gemini-2.0-flash'))
  })

  it('기본 모델은 체인의 첫 자리다 — 둘이 갈리면 어느 쪽이 진짜인지 모른다', () => {
    assert.equal(GEMINI_MODEL_FALLBACKS[0], DEFAULT_GEMINI_MODEL)
  })

  it('폴백 전부가 JSON 모드를 지원한다 — 못 쓰는 모델을 안전망이라 부를 수 없다', () => {
    for (const m of GEMINI_MODEL_FALLBACKS) assert.equal(supportsJsonMode(m), true, m)
  })
})
