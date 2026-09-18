/**
 * 러너가 **실제로 답한 것**을 기록하는지 잠근다
 *
 * ## 왜 이것이 중요한가 (실측 2026-09-19)
 *
 * 어댑터가 공급자를 넘게 되면서, 고른 모델과 답한 모델이 달라질 수 있게 됐다.
 * 그때 기록이 고른 모델을 적으면 **사용량 집계가 쓰지도 않은 모델에 쌓인다** —
 * 나중에 「왜 이 모델 비용이 이렇게 나오지」를 아무도 설명하지 못한다.
 *
 * AI 채팅 쪽에는 같은 취지의 가드가 이미 있다
 * (「★ 실제로 답한 공급자·모델을 기록한다 — 사용량 집계가 거짓이 되면 안 된다」).
 * CRM 만 없었다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { formatFallbackNotice } from '../../ai-chat/model-chain.ts'

const SRC = readFileSync(new URL('./runner.ts', import.meta.url), 'utf-8')

test('★ 기록에 실제로 답한 모델이 들어간다 — 고른 모델이 아니라', () => {
  assert.match(SRC, /let usedModel: string = adapter\.model/, '기본값이 고른 모델이어야 한다')
  assert.match(SRC, /if \(res\.usedModel\) usedModel = res\.usedModel/)
  // 성공·실패 두 기록과 시스템 로그 힌트가 전부 그 값을 쓴다
  const uses = SRC.match(/model: usedModel/g) ?? []
  assert.equal(uses.length, 2, `기록 두 곳 중 ${uses.length}곳만 실제 모델을 쓴다`)
  assert.match(SRC, /hint: usedModel/)
  assert.ok(!/model: adapter\.model, promptVersion/.test(SRC), '고른 모델을 적는 길이 남아 있다')
})

test('★ 안 알려 주는 어댑터는 예전처럼 동작한다 — mock 과 옛 구현이 안 깨진다', () => {
  // usedModel 의 기본값이 adapter.model 이라 res 가 비어도 기록이 빈칸이 되지 않는다
  assert.match(SRC, /let usedModel: string = adapter\.model/)
  assert.match(SRC, /usedProvider\?: string/, '계약이 선택이어야 한다')
  assert.match(SRC, /usedModel\?: string/)
})

test('★ 갈아탔으면 결과에 한 줄이 실린다 — 조용히 바꾸지 않는다', () => {
  assert.match(SRC, /switchedNote\?: string/)
  assert.match(SRC, /switchedNote: switchedNote\(\)/)
  assert.match(SRC, /if \(usedModel === adapter\.model\) return undefined/,
    '안 갈아탔는데 알림이 뜨면 사용자가 매번 «뭔가 잘못됐나» 를 겪는다')
})

test('★ 알림 문장을 새로 만들지 않는다 — 같은 사실을 화면마다 다르게 적지 않는다', () => {
  assert.match(SRC, /formatFallbackNotice\(/)
  assert.match(SRC, /from '\.\.\/\.\.\/ai-chat\/model-chain\.ts'/)
  // 문장 SSOT 가 실제로 갈아탄 사실을 말하는지
  const line = formatFallbackNotice({
    fromLabel: '설정 모델', fromModel: 'gemini-3-flash-preview',
    toLabel: 'openai', toModel: 'gpt-5.5',
  })
  assert.match(line, /gemini-3-flash-preview/)
  assert.match(line, /gpt-5\.5/)
})

test('실패 기록도 실제로 시도한 모델을 남긴다 — 어디서 막혔는지가 사유의 절반이다', () => {
  const fail = SRC.slice(SRC.indexOf('const recordFailure'), SRC.indexOf('// 실제 비용으로 정산'))
  assert.match(fail, /model: usedModel/)
})
