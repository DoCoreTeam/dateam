/**
 * 말로 설정 바꾸기 — **규정을 안 비켜 가는가** (§15.2 · §15.3 · M6 · M7 · M8)
 *
 * 말로 바꾸는 길이 생기면 그 길이 규정의 뒷문이 되기 쉽다. 그래서 값이 맞는지보다
 * **못 바꾸는 것을 정말 못 바꾸는지**를 먼저 센다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { planChanges, buildAssistantPrompt, parseAssistantResponse } from './assistant.ts'
import { AI_FORBIDDEN_KEYS } from '../knowledge/proposal-policy.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SETTINGS_DIR = join(HERE, '..', '..', '..', TRADING_APP_DIR, 'settings')
const VALUES = { signal_max_per_day: 6, atr_period: 14, daily_loss_limit_krw: 500000 }

test('제대로 온 줄은 미리보기에 오른다', () => {
  const plan = planChanges(
    [{ key: 'signal_max_per_day', value: 3, why: '보수적으로 가고 싶어서' }], VALUES)
  assert.equal(plan.changes.length, 1)
  assert.equal(plan.changes[0].currentValue, 6)
  assert.equal(plan.changes[0].nextValue, 3)
  assert.equal(plan.rejected.length, 0)
})

/**
 * **금지 목록은 후보로도 안 오른다** (§15.3).
 * 소유자·자격증명·안전선·안전 게이트·실행 방식은 사람만 바꾼다.
 */
test('★ AI 가 못 바꾸는 키는 미리보기에 아예 안 오른다 (§15.3)', () => {
  assert.ok(AI_FORBIDDEN_KEYS.length > 0, '금지 목록이 비었다')
  for (const key of AI_FORBIDDEN_KEYS) {
    const plan = planChanges([{ key, value: 1, why: '바꾸고 싶어서' }], VALUES)
    assert.equal(plan.changes.length, 0, `${key} 가 후보로 올랐다`)
    assert.equal(plan.rejected.length, 1, `${key} 를 조용히 버렸다`)
    assert.match(plan.rejected[0].reason, /forbidden/, `${key} 가 다른 사유로 걸렸다`)
  }
})

test('★ 없는 키·범위 밖 값·같은 값은 걸러진다', () => {
  const plan = planChanges([
    { key: '없는설정', value: 1, why: '왜' },
    { key: 'atr_period', value: 9999, why: '왜' },
    { key: 'atr_period', value: 14, why: '왜' },
    { key: 'signal_max_per_day', value: 3, why: '' },
  ], VALUES)
  assert.equal(plan.changes.length, 0)
  assert.deepEqual(plan.rejected.map((r) => r.reason),
    ['unknown_key', 'out_of_range', 'same_value', 'no_why'])
})

test('★ 안 올라간 줄을 조용히 버리지 않는다 — 버리면 같은 말을 또 하게 된다', () => {
  const plan = planChanges([{ key: '없는설정', value: 1, why: '왜' }], VALUES)
  assert.equal(plan.rejected.length, 1)
  assert.ok(plan.rejected[0].userMessage.length > 0, '사유가 사람 말이 아니다')
})

test('같은 키가 두 번 오면 뒤의 것을 버린다 — 어느 것이 이겼는지 모르면 안 된다', () => {
  const plan = planChanges([
    { key: 'signal_max_per_day', value: 3, why: 'a' },
    { key: 'signal_max_per_day', value: 4, why: 'b' },
  ], VALUES)
  assert.equal(plan.changes.length, 1)
  assert.equal(plan.changes[0].nextValue, 3)
  assert.equal(plan.rejected[0].reason, 'duplicate')
})

/**
 * **질문에 비밀이 안 실린다** (S3).
 * 키·계좌번호는 설정이 아니라 자격증명이고 레지스트리에 없다.
 */
test('★ 질문에 금지 키와 비밀이 안 실린다 (S3)', () => {
  const prompt = buildAssistantPrompt('보수적으로', VALUES)
  for (const key of AI_FORBIDDEN_KEYS) {
    assert.equal(prompt.includes(key), false, `질문에 금지 키 ${key} 가 실렸다`)
  }
  for (const word of ['appkey', 'appsecret', 'api_key', '계좌번호']) {
    assert.equal(prompt.toLowerCase().includes(word), false, `질문에 ${word} 가 실렸다`)
  }
  // 바꿀 수 있는 것은 실려야 고를 수 있다
  assert.ok(prompt.includes('signal_max_per_day'), '바꿀 수 있는 키가 질문에 없다')
})

test('산문이 오면 숫자로 만들지 않는다', () => {
  assert.deepEqual(parseAssistantResponse('잘 모르겠습니다'), [])
  assert.deepEqual(parseAssistantResponse('{"changes":"많이"}'), [])
  assert.equal(parseAssistantResponse('앞말 {"changes":[{"key":"a"}]} 뒷말').length, 1)
})

/* ── 창구 ──────────────────────────────────────────────── */

test('★ 미리보기 창구에는 저장하는 길이 없다 — 확인 전에는 아무것도 안 바뀐다', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function proposeSettingChanges')
  assert.ok(at > 0, '미리보기 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.equal(/saveTradingSetting|saveTradingSettingValue/.test(body), false,
    '묻기만 해야 하는 창구가 저장한다')
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')
})

test('★ 저장이 기존 창구를 지나 다음 거래일부터 듣는다 (M7)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function applySettingChanges')
  assert.ok(at > 0, '저장 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('saveTradingSettingValue('), '기존 창구를 안 지난다')
  // 저장 직전에 규정을 한 번 더 본다 — 화면이 보낸 값은 밖에서 온 값이다
  assert.ok(body.includes('planChanges('), '화면이 보낸 값을 그대로 저장한다')
  assert.ok(body.indexOf('planChanges(') < body.indexOf('saveTradingSettingValue('),
    '검사보다 먼저 저장한다')
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')
})

test('★ AI 호출이 기존 계층을 지난다 (M12)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function proposeSettingChanges')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('callKnowledge('), '새 호출 길을 냈다 — 예산·가림·원장을 안 지난다')
  assert.ok(body.includes("purpose: 'setting_help'"), '원장에 적힐 이름이 없다')
})

test('★ 화면이 저장 전에 무엇이 바뀌는지 보여 준다', () => {
  const panel = readFileSync(join(SETTINGS_DIR, 'AssistantPanel.tsx'), 'utf8')
  assert.ok(panel.includes('c.currentValue'), '지금 값을 안 보여 준다')
  assert.ok(panel.includes('c.nextValue'), '바꿀 값을 안 보여 준다')
  assert.ok(panel.includes('c.why'), '왜 바꾸는지를 안 보여 준다')
  assert.ok(panel.includes('plan.rejected'), '안 올라간 줄을 안 보여 준다')
  assert.ok(panel.includes('ASSISTANT_WHEN'), '언제부터 듣는지를 안 말한다')
  // 말은 라벨 표에서 온다
  assert.ok(panel.includes("from '@/lib/trading/settings/assistant-labels'"), '말을 화면 안에서 짓는다')
})
