/**
 * 스펙 후보 — **AI 는 제안만 하고 적용은 사람이 한다** (§15.2 · §15.3)
 *
 * 설정 하나가 돈의 크기를 정한다. 그리고 그 변경은 화면에서 아무 일도 안 일어난 것처럼
 * 보인다 — 다음 날 손실로만 드러난다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AI_FORBIDDEN_KEYS, AI_FORBIDDEN_PREFIXES, aiMayPropose, validateProposal,
  applyTiming, nextTradeDate, effectiveDateFor, parseProposals, buildProposalPrompt,
  type Proposal,
} from './proposal-policy.ts'
import { TRADING_SETTINGS } from '../settings/registry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const OK: Proposal = {
  settingKey: 'signal_max_per_day',
  currentValue: 6,
  proposedValue: 4,
  rationale: '개장 후 90분 뒤 신호의 평균이 음수였다',
  evidence: [{ kind: 'pattern_report', ref: 'report:2026-06', note: '30건' }],
}

test('허용된 키에 근거가 있으면 후보가 선다', () => {
  assert.equal(aiMayPropose('signal_max_per_day'), null)
  assert.equal(validateProposal(OK), null)
})

// ── §15.3 금지 목록 ──────────────────────────────────────

test('★ 명세 §15.3 의 「AI 가 절대 바꿀 수 없는 것」이 전부 막힌다', () => {
  // 소유자·권한 · KIS/AI 자격증명 · 일일 손실 한도 올리기 · 안전선 · 안전 게이트 ·
  // 실행 방식 · 손절 보호 정책 · AI 개입 수준 · Lockbox 열기와 관문 통과 선언
  const mustBlock = [
    'owner_user_id',
    'kis_env', 'kis_account_product_code', 'kis_min_interval_ms', 'jev_model',
    'daily_loss_limit_krw',
    'gate_max_broker_failure_streak', 'gate_max_minutes_since_run',
    'gate_max_notify_failure_streak', 'gate_max_unopened_signals',
    'gate_min_validate_trades', 'gate_min_profit_factor',
    'notify_enabled', 'notify_shadow_days_required',
    'protection_recheck_minutes',
    'validation_lockbox_days',
    // AI 개입 수준 자체와 운영자 스위치 (§15.3)
    'ai_intervention_retry_notifications', 'operator_enabled',
  ]
  for (const key of mustBlock) {
    assert.ok(aiMayPropose(key), `${key} 가 AI 에게 열려 있다`)
  }
})

test('★ 접두사로도 막는다 — 새 키가 생겨도 조용히 안 열린다', () => {
  assert.deepEqual([...AI_FORBIDDEN_PREFIXES],
    ['gate_', 'notify_', 'kis_', 'protection_', 'ai_intervention_', 'operator_'])
  for (const p of AI_FORBIDDEN_PREFIXES) {
    assert.ok(aiMayPropose(`${p}brand_new_key_nobody_reviewed`), `${p}* 가 안 막힌다`)
  }
})

test('★ 지금 레지스트리에 있는 금지 갈래 설정이 하나도 안 새어 나간다', () => {
  const leaked = TRADING_SETTINGS
    .filter((s) => ['safety', 'notify', 'broker', 'operator'].includes(s.group))
    .filter((s) => aiMayPropose(s.key) === null)
    .map((s) => s.key)
  assert.deepEqual(leaked, [], `안전 게이트·알림·증권사 설정이 AI 에게 열렸다: ${leaked.join(', ')}`)
  // 금지 목록에 죽은 키만 남으면 이 시험은 아무것도 안 지킨다
  const known = new Set(TRADING_SETTINGS.map((s) => s.key))
  const dead = AI_FORBIDDEN_KEYS.filter((k) => !known.has(k))
  assert.deepEqual(dead, [], `레지스트리에 없는 키가 금지 목록에 있다: ${dead.join(', ')}`)
})

test('빈 키와 모르는 꼴은 막는다', () => {
  assert.ok(aiMayPropose('   '))
  assert.equal(validateProposal({ ...OK, settingKey: 'gate_x' })?.reason, 'forbidden_prefix:gate_')
})

test('근거나 사유가 없으면 후보로 안 올린다', () => {
  assert.equal(validateProposal({ ...OK, evidence: [] })?.reason, 'no_evidence')
  assert.equal(validateProposal({ ...OK, rationale: '  ' })?.reason, 'no_rationale')
  assert.equal(validateProposal({ ...OK, proposedValue: null })?.reason, 'no_value')
  assert.equal(validateProposal({ ...OK, proposedValue: 6 })?.reason, 'same_value')
})

// ── §15.2 언제부터 ───────────────────────────────────────

test('★ 전략을 바꾸는 변경은 다음 거래일부터', () => {
  // 신호를 더 내게 하는 방향
  assert.deepEqual(applyTiming('signal_max_per_day', 6, 10), { when: 'next_trade_day', reason: 'strategy_change' })
  assert.deepEqual(applyTiming('signal_min_net_ev_r', 0.2, 0.1), { when: 'next_trade_day', reason: 'strategy_change' })
})

test('★ 신호를 막는 쪽만 오늘부터 — 위험을 줄이는 일은 기다릴 이유가 없다', () => {
  assert.equal(applyTiming('signal_max_per_day', 6, 4).when, 'today')
  assert.equal(applyTiming('signal_min_net_ev_r', 0.1, 0.3).when, 'today')
  assert.equal(applyTiming('signal_cooldown_minutes', 60, 120).when, 'today')
})

test('★ 모르면 다음 거래일 — 모르는 것을 오늘 적용하면 그날 성과를 못 읽는다', () => {
  assert.equal(applyTiming('brand_new_setting', 1, 2).when, 'next_trade_day')
  assert.equal(applyTiming('signal_max_per_day', 'a', 'b').when, 'next_trade_day')
})

test('다음 거래일은 서울 기준 하루 뒤', () => {
  assert.equal(nextTradeDate('2026-06-01'), '2026-06-02')
  assert.equal(nextTradeDate('2026-12-31'), '2027-01-01')
  assert.equal(effectiveDateFor({ when: 'today', reason: 'x' }, '2026-06-01'), '2026-06-01')
  assert.equal(effectiveDateFor({ when: 'next_trade_day', reason: 'x' }, '2026-06-01'), '2026-06-02')
})

// ── AI 응답 읽기 ─────────────────────────────────────────

test('★ 근거 없는 제안은 읽는 자리에서 비워진다', () => {
  const ps = parseProposals({
    proposals: [
      { setting_key: 'a', proposed_value: 1, rationale: 'r', evidence: [{ kind: 'k', ref: 'x' }] },
      { setting_key: 'b', proposed_value: 1, rationale: 'r', evidence: [{ kind: 'k' }] },
      { setting_key: '', proposed_value: 1 },
    ],
  })
  assert.equal(ps.length, 2)
  assert.equal(ps[0].evidence.length, 1)
  assert.equal(ps[1].evidence.length, 0, '가리키는 것 없는 근거가 남았다')
  // 그리고 근거 0건은 validateProposal 이 막는다
  assert.equal(validateProposal({ ...ps[1], settingKey: 'signal_max_per_day', currentValue: 6 })?.reason, 'no_evidence')
})

test('모르는 꼴이면 빈 목록이다', () => {
  for (const bad of [null, 'text', 42, {}, { proposals: 'x' }]) {
    assert.deepEqual(parseProposals(bad), [])
  }
})

test('프롬프트가 허용 목록과 성과표만 준다', () => {
  const p = buildProposalPrompt(
    [{ key: 'signal_max_per_day', label: '최대 신호 수', current: 6, min: 1, max: 50 }],
    ['전체: 승률 40%'],
  )
  assert.ok(p.includes('있는 키만'))
  assert.ok(p.includes('새로 계산하지 않는다'))
  assert.ok(p.includes('빈 배열이 정답일 때가 많다'))
  assert.ok(p.includes('signal_max_per_day'))
  assert.ok(p.includes('(1~50)'))
})

// ── AI 가 설정을 직접 못 쓴다 ────────────────────────────

test('★ AI 가 부르는 길에 설정 저장이 없다 (§15.3)', () => {
  const src = readFileSync(join(HERE, 'proposal.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  const propose = src.slice(src.indexOf('export async function proposeFromReport'), src.indexOf('async function saveProposal'))
  assert.equal(/saveTradingSetting\s*\(/.test(propose), false,
    'AI 가 부르는 함수가 설정을 직접 쓴다')
  // 후보 표에만 넣는다
  const save = src.slice(src.indexOf('async function saveProposal'), src.indexOf('export type DecideResult'))
  assert.ok(save.includes("from('trading_spec_candidates')"))
  assert.equal(/from\('trading_settings'\)/.test(save), false)
})

test('★ 받아들이는 자리에만 설정 저장이 있고 사람 ID 가 필수다', () => {
  const src = readFileSync(join(HERE, 'proposal.ts'), 'utf8')
  const decide = src.slice(src.indexOf('export async function decideProposal'))
  assert.ok(/saveTradingSetting\s*\(/.test(decide), '받아들여도 설정이 안 바뀐다')
  assert.ok(decide.includes('if (!input.actorUserId)'), '사람 없이도 받아들여진다')
  assert.ok(decide.includes('changedBy: input.actorUserId'), '누가 바꿨는지가 안 남는다')
  // 받을 때 금지 목록을 한 번 더 본다
  assert.ok(decide.includes('aiMayPropose('), '표에 들어온 뒤 금지 목록이 늘어나면 그대로 통과한다')
})

test('★ 적용 날짜를 후보가 정하고 오늘로 덮어쓰지 않는다 (§15.2)', () => {
  const src = readFileSync(join(HERE, 'proposal.ts'), 'utf8')
  const decide = src.slice(src.indexOf('export async function decideProposal'))
  assert.ok(decide.includes('effectiveTradeDate: String(row.effective_trade_date)'),
    '적용 날짜를 후보에서 안 읽는다 — 장중에 전략이 바뀌면 그날 성과가 무엇의 성과인지 모른다')
})
