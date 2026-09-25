/**
 * 지식 카드 — **근거 없으면 카드가 아니다**
 *
 * AI 가 쓴 글은 근거가 없어도 그럴듯하다. 트레이딩 화면에 뜬 그럴듯한 글은
 * 사람이 돈을 넣는 근거가 되고, 관측에서 나왔는지 지어낸 것인지 화면에서는 구별이 안 된다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  validateDraft, normalizeDraft, nextRevision, parseDraft, isRejection, buildCardPrompt,
  MAX_BODY_LENGTH, MAX_TITLE_LENGTH, TRUNCATION_MARK, type CardDraft,
} from './card-policy.ts'
import { KNOWLEDGE_PURPOSES, KNOWLEDGE_SURFACE, knowledgeFeature } from './surface.ts'
import { AI_LANES } from '../../ai/actor.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OK: CardDraft = {
  topic: '개장 직후 변동',
  title: '개장 15분은 변동이 크다',
  body: '2026-06-01 부터 20거래일, 개장 15분의 ATR 중앙값이 그날 평균의 1.8배였다',
  sources: [{ kind: 'observation', ref: 'bars:2026-06-01..2026-06-30', note: '1분 봉 7,600개' }],
}

test('근거가 있으면 카드가 선다', () => {
  assert.equal(validateDraft(OK), null)
})

test('★ 근거가 0건이면 카드를 안 만든다 — 지어낸 글은 화면에 안 올린다', () => {
  const r = validateDraft({ ...OK, sources: [] })
  assert.ok(r)
  assert.equal(r.reason, 'no_sources')
  assert.ok(r.userMessage.includes('근거'))
})

test('★ 근거에 가리키는 것이 없으면 근거가 아니다', () => {
  const r = validateDraft({ ...OK, sources: [{ kind: 'observation', ref: '   ', note: 'n' }] })
  assert.equal(r?.reason, 'empty_source_ref:observation')
})

test('주제나 내용이 비면 안 만든다', () => {
  assert.equal(validateDraft({ ...OK, topic: '  ' })?.reason, 'empty_topic')
  assert.equal(validateDraft({ ...OK, body: '' })?.reason, 'empty_body')
})

test('★ 길면 자르되 자른 사실을 남긴다 — 조용히 잘리면 문장이 중간에 끊긴다', () => {
  const long = normalizeDraft({ ...OK, body: 'ㄱ'.repeat(MAX_BODY_LENGTH + 500) })
  // 상한을 **정확히** 맞춘다. 표시 길이를 눈대중으로 빼면 결과가 상한과 안 맞는다
  assert.equal(long.body.length, MAX_BODY_LENGTH)
  assert.ok(long.body.endsWith(TRUNCATION_MARK))
  // 길다는 이유로 거절하지는 않는다. 고칠 수 있는 일이다
  assert.equal(validateDraft(long), null)
  const t = normalizeDraft({ ...OK, title: 'ㄴ'.repeat(MAX_TITLE_LENGTH + 10) }).title
  assert.equal(t.length, MAX_TITLE_LENGTH)
  assert.ok(t.endsWith(TRUNCATION_MARK))
})

test('★ 덮어쓰지 않고 판을 쌓는다 — 그때 무엇을 알았나가 사라지면 안 된다', () => {
  assert.equal(nextRevision(null), 1)
  assert.equal(nextRevision(3), 4)
})

// ── AI 응답 읽기 ─────────────────────────────────────────

test('제대로 된 응답을 초안으로 읽는다', () => {
  const v = parseDraft('t', {
    title: 'T', body: 'B',
    sources: [{ kind: 'pattern_report', ref: 'r1', note: 'n' }],
  })
  assert.equal(isRejection(v), false)
  assert.equal(!isRejection(v) && v.sources.length, 1)
})

test('★ 모르는 꼴이면 지어내지 않고 거절한다', () => {
  for (const bad of [null, 'text', 42, []]) {
    const v = parseDraft('t', bad)
    assert.ok(isRejection(v), `${JSON.stringify(bad)} 를 카드로 만들었다`)
  }
})

test('★ 근거 배열이 없거나 꼴이 틀리면 거절한다 — 빈 카드가 화면에 안 뜬다', () => {
  assert.ok(isRejection(parseDraft('t', { title: 'T', body: 'B' })))
  assert.ok(isRejection(parseDraft('t', { title: 'T', body: 'B', sources: ['plain'] })))
  // 모르는 kind 는 근거로 안 센다
  assert.ok(isRejection(parseDraft('t', { title: 'T', body: 'B', sources: [{ kind: 'guess', ref: 'x' }] })))
})

test('★ 프롬프트가 지어내지 말라고 말하고, 그것만으로 안 끝낸다', () => {
  const p = buildCardPrompt('주제', ['사실 하나'])
  assert.ok(p.includes('사실에 없는 것을 쓰지 않는다'))
  assert.ok(p.includes('예측하지 않는다'))
  assert.ok(p.includes('숫자를 지어내지 않는다'))
  assert.ok(p.includes('1. 사실 하나'))
  // 말은 한 겹일 뿐이다. 코드와 DB 가 두 겹 더 막는다
  const policy = readFileSync(join(HERE, 'card-policy.ts'), 'utf8')
  assert.ok(policy.includes("reason: 'no_sources'"), '코드가 근거 없음을 안 막는다')
  const sql = readFileSync(
    join(HERE, '..', '..', '..', '..', '..', 'supabase', 'migrations', '285_trading_knowledge.sql'), 'utf8')
  assert.ok(sql.includes('trading_knowledge_cards_sources_not_empty'), 'DB 가 근거 없음을 안 막는다')
})

// ── AI 계층을 지나는가 (§17.1) ───────────────────────────

test('★ 트레이딩 지식 호출이 표면 하나로 모인다', () => {
  assert.equal(KNOWLEDGE_SURFACE, 'trading_knowledge')
  assert.deepEqual([...KNOWLEDGE_PURPOSES], [
    'knowledge_card', 'source_analysis', 'pattern_report',
    'spec_candidate', 'signal_explain', 'setting_help',
  ])
})

test('★ 새 키 풀·새 예산·새 원장을 안 만든다 — 기존 계층을 지난다', () => {
  const src = readFileSync(join(HERE, 'ai-call.ts'), 'utf8')
  assert.ok(src.includes('callGeminiText'), '기존 호출기를 안 쓴다')
  assert.ok(src.includes('resolveProviderKey'), '기존 키 자리를 안 쓴다')
  assert.ok(src.includes('knowledgeFeature('), '원장 이름을 손으로 조립한다 — 표면이 갈라진다')
  assert.equal(knowledgeFeature('knowledge_card'), 'trading_knowledge:knowledge_card')
  // 벤더를 직접 두드리는 자리가 없다
  assert.equal(/fetch\(/.test(src), false, 'Gemini 를 직접 부른다 — 예산과 원장을 건너뛴다')
  assert.equal(/generativelanguage|api_key=|x-goog-api-key/i.test(src), false, '벤더 주소가 코드에 있다')
})

test('★ 지식 호출이 AI_LANES 에 등재됐다 — 주인 없는 호출이 원장에 쌓인다', () => {
  const lane = AI_LANES.find((l) => l.file === 'lib/trading/knowledge/ai-call.ts')
  assert.ok(lane, 'ai-call.ts 가 AI_LANES 에 없다')
  assert.equal(lane.kind, 'background', '크론이 돌리는 자리인데 사람 몫으로 적혔다')
  assert.ok(lane.why.length > 10, '왜 배경인지가 안 적혔다')
})

test('★ 예산이 막히면 카드를 못 만들고 사유가 남는다 — 조용히 빈 카드 0건', () => {
  const src = readFileSync(join(HERE, 'ai-call.ts'), 'utf8')
  assert.ok(src.includes('BudgetDeniedError'), '예산 거절을 따로 안 본다')
  assert.ok(src.includes("reason: 'budget_denied'"), '예산 거절 사유가 안 남는다')
  // 던지지 않는다 — 지식은 곁가지이고 수집을 죽이면 안 된다
  const fn = src.slice(src.indexOf('export async function callKnowledge'))
  assert.equal(/\bthrow\b/.test(fn), false, '지식 호출이 던진다 — 수집까지 같이 죽는다')
})

test('★ 저장이 as-of 를 지나고 available_at 을 안 적는다', () => {
  const src = readFileSync(join(HERE, 'cards.ts'), 'utf8')
  assert.ok(src.includes('applyAsOf('), '읽기가 as-of 를 안 지난다')
  const insertAt = src.indexOf(".insert({")
  const insertBody = src.slice(insertAt, src.indexOf('.select', insertAt))
  assert.equal(/available_at\s*:/.test(insertBody), false, 'insert 가 available_at 을 정한다')
})
