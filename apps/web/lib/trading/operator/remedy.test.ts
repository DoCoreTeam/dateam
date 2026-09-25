/**
 * 조치 — **기본이 사람이다** (§15.3)
 *
 * 금지 목록으로 두면 새 조치가 생길 때 아무도 검토하지 않은 채로 AI 에게 열린다.
 * 적는 것을 잊었을 때 앞은 조용히 열리고 뒤는 조용히 막힌다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ACTION_IDS, ACTION_LABEL, AI_ALLOWED_ACTIONS, FORBIDDEN_WORDS,
  whoDoes, planRemedy, remedyFor, forbiddenWordIn,
} from './remedy-policy.ts'
import { CHECK_IDS, type CheckStatus } from './checks.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('★ AI 가 할 수 있는 조치가 명시 목록 셋뿐이다', () => {
  assert.deepEqual([...AI_ALLOWED_ACTIONS],
    ['retry_notifications', 'backfill_bars', 'reanalyze_source'])
  for (const a of AI_ALLOWED_ACTIONS) assert.ok(ACTION_IDS.includes(a))
})

test('★ 목록 밖은 전부 사람 몫이다 — 기본이 사람이다', () => {
  assert.deepEqual(whoDoes('hand_off'), { by: 'human', why: 'not_in_allowlist' })
  assert.deepEqual(whoDoes('brand_new_action_nobody_reviewed'),
    { by: 'human', why: 'not_in_allowlist' })
  for (const a of AI_ALLOWED_ACTIONS) assert.deepEqual(whoDoes(a), { by: 'ai' })
})

test('★ §15.3 금지 목록에 닿는 조치가 0개다', () => {
  // 명세의 「AI 가 절대 바꿀 수 없는 것」을 조치 이름으로 옮겨 하나씩 확인한다
  const mustBlock = [
    'change_owner', 'rotate_credential', 'update_api_key', 'reveal_secret',
    'raise_limit', 'limit_up', 'disable_gate', 'bypass_gate',
    'place_order', 'execute_trade', 'enable_trade',
    'set_protection', 'change_audit', 'set_intervention', 'open_lockbox', 'declare_pass',
  ]
  for (const a of mustBlock) {
    const r = whoDoes(a)
    assert.equal(r.by, 'human', `${a} 가 AI 에게 열려 있다`)
  }
})

test('★ 금지어 겹이 따로 살아 있다 — 허용 목록만으로는 이 겹이 죽어도 모른다', () => {
  // 허용 목록이 거의 다 막아서, 금지어 겹만 꺼도 시험이 초록이 됐다(실측).
  // 그래서 이 겹을 **직접** 부른다
  for (const w of FORBIDDEN_WORDS) {
    assert.equal(forbiddenWordIn(`retry_${w}_thing`), w, `금지어 ${w} 를 못 찾는다`)
    assert.equal(whoDoes(`retry_${w}_thing`).by, 'human', `금지어 ${w} 가 안 막힌다`)
  }
  assert.equal(forbiddenWordIn('retry_notifications'), null, '멀쩡한 이름을 막는다')
  assert.ok(FORBIDDEN_WORDS.length >= 15)
})

test('★ 금지어를 허용 목록보다 먼저 본다 — 목록에 잘못 넣어도 막힌다', () => {
  // 허용 목록에 금지어가 든 이름이 들어와도 사람 몫이어야 한다
  const wouldBeAllowed = 'retry_order_notifications'
  assert.equal(forbiddenWordIn(wouldBeAllowed), 'order')
  const r = whoDoes(wouldBeAllowed)
  assert.equal(r.by, 'human')
  assert.equal(r.by === 'human' && r.why, 'forbidden_word:order',
    '허용 목록 사유가 먼저 나왔다 — 금지어 겹이 뒤에 있다')
})

test('★ 허용된 셋 어디에도 금지어가 없다 — 있으면 자기 목록이 자기를 막는다', () => {
  for (const a of AI_ALLOWED_ACTIONS) {
    assert.equal(whoDoes(a).by, 'ai', `${a} 가 자기 이름 때문에 막힌다`)
  }
})

// ── 점검마다 무엇을 하나 ─────────────────────────────────

test('ok 면 아무것도 안 한다', () => {
  for (const id of CHECK_IDS) assert.equal(planRemedy(id, 'ok', 'm'), null)
})

test('★ 아무것도 안 하고 넘어가는 길이 없다 — 조치가 없으면 인계다', () => {
  for (const id of CHECK_IDS) {
    for (const status of ['warn', 'fail'] as CheckStatus[]) {
      const d = planRemedy(id, status, 'm')
      assert.ok(d, `${id}/${status} 에 아무 판정도 없다`)
      assert.ok(ACTION_IDS.includes(d.remedy.actionId))
    }
  }
})

test('알림·봉은 AI 가 고치고 나머지는 사람에게 간다', () => {
  assert.equal(planRemedy('notify_flowing', 'fail', 'm')?.by, 'ai')
  assert.equal(planRemedy('bars_complete', 'warn', 'm')?.by, 'ai')
  assert.equal(planRemedy('reconciled', 'fail', 'm')?.by, 'human')
  assert.equal(planRemedy('broker_reachable', 'fail', 'm')?.by, 'human')
})

test('★ 「모른다」에는 고치는 조치를 안 붙인다 — 고쳤는지도 모른다', () => {
  const d = remedyFor('notify_flowing', 'unknown', 'm')
  assert.ok(d)
  assert.equal(d.by, 'human')
  assert.equal(d.by === 'human' && d.why, 'unknown_needs_human')
  assert.equal(d.remedy.actionId, 'hand_off')
  // warn·fail 은 그대로 AI 가 한다
  assert.equal(remedyFor('notify_flowing', 'fail', 'm')?.by, 'ai')
})

test('조치마다 이름이 있다', () => {
  for (const a of ACTION_IDS) assert.ok(ACTION_LABEL[a]?.length > 0, `${a} 에 이름이 없다`)
  assert.equal(new Set(Object.values(ACTION_LABEL)).size, ACTION_IDS.length)
})

test('사람이 읽을 문장이 조치에 실려 간다', () => {
  const d = planRemedy('reconciled', 'fail', '계좌와 기록이 다릅니다')
  assert.equal(d?.remedy.userMessage, '계좌와 기록이 다릅니다')
  assert.equal(d?.remedy.reason, 'reconciled:fail')
})

// ── 실행 자리 ────────────────────────────────────────────

test('★ 실행이 판정을 한 번 더 묻는다 — 판정과 실행 사이에 목록이 줄었을 수 있다', () => {
  const src = readFileSync(join(HERE, 'remedy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function applyRemedy'))
  assert.ok(/const who = whoDoes\(/.test(fn), '실행이 다시 안 묻는다')
  assert.ok(fn.includes("outcome: 'refused'"), '거절을 기록 안 한다')
})

test('★ 되돌릴 수 있는 일만 한다 — 셋 말고는 던진다', () => {
  const src = readFileSync(join(HERE, 'remedy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('async function runAction'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  for (const allowed of AI_ALLOWED_ACTIONS) {
    assert.ok(body.includes(`'${allowed}'`), `${allowed} 를 안 다룬다`)
  }
  assert.ok(body.includes('unknown_action:'), '모르는 조치를 조용히 넘긴다')
})

test('★ 조치가 돈을 움직이거나 설정을 바꾸지 않는다', () => {
  const src = readFileSync(join(HERE, 'remedy.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  for (const banned of ['saveTradingSetting', 'trading_settings', 'saveSignal', 'queueNotification', 'order']) {
    assert.equal(src.includes(banned), false, `조치가 ${banned} 에 닿는다`)
  }
})

test('★ 조치 기록이 덮어쓰기가 아니라 쌓기다', () => {
  const src = readFileSync(join(HERE, 'remedy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function recordAction'))
  const body = fn.slice(0, fn.indexOf('\n}'))
  assert.ok(body.includes('.insert('), '기록이 insert 가 아니다')
  assert.equal(/\.update\(|\.upsert\(|\.delete\(/.test(body), false, '기록을 덮거나 지운다')
})

test('★ 실패도 기록한다 — 안 남기면 「안 했다」와 「하다 실패했다」가 같아진다', () => {
  const src = readFileSync(join(HERE, 'remedy.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function applyRemedy'))
  assert.ok(fn.includes("outcome: 'failed'"))
  assert.ok(fn.includes("outcome: 'applied'"))
})
