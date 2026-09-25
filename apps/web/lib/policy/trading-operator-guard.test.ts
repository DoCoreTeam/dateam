/**
 * **AI 운영자가 넘을 수 없는 선** (§15.3 · §16)
 *
 * 무엇을 세나
 *   ① AI 가 §15.3 금지 항목에 닿는 길
 *   ② 새 할 일 표
 *   ③ 야간 전용 우회
 *   ④ 자동이 기본인 개입 항목
 *   ⑤ 운영자가 앞선 일(감시·신호·지식)을 죽이는 길
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AI_ALLOWED_ACTIONS, FORBIDDEN_WORDS, whoDoes } from '../trading/operator/remedy-policy.ts'
import { INTERVENTION_ITEMS, DEFAULT_LEVELS, interventionKey, INTERVENTION_KEY_PREFIX }
  from '../trading/operator/intervention.ts'
import { AI_FORBIDDEN_PREFIXES, aiMayPropose } from '../trading/knowledge/proposal-policy.ts'
import { TRADING_SETTINGS } from '../trading/settings/registry.ts'
import { GATE_IDS } from '../trading/gate/safety.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRADING = join(WEB, 'lib', 'trading')
const MIGRATIONS = join(WEB, '..', '..', 'supabase', 'migrations')

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    if (name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

function sources(root = TRADING): { file: string; src: string }[] {
  return walk(root).map((file) => ({
    file: relative(WEB, file),
    src: stripComments(readFileSync(file, 'utf8')),
  }))
}

test('★ 검사 대상이 있다 — 0개면 아래 단정은 언제나 초록이다', () => {
  const files = sources()
  assert.ok(files.length >= 70, `대상이 ${files.length}개뿐이다`)
  assert.ok(files.some((f) => f.src.includes('runOperatorJob')), '운영자를 못 찾았다')
  assert.ok(files.some((f) => f.src.includes('handOff')), '인계를 못 찾았다')
})

// ── ① §15.3 금지 ────────────────────────────────────────

test('★ AI 가 할 수 있는 조치가 셋뿐이고 금지어가 없다', () => {
  assert.equal(AI_ALLOWED_ACTIONS.length, 3)
  for (const a of AI_ALLOWED_ACTIONS) assert.deepEqual(whoDoes(a), { by: 'ai' })
  assert.ok(FORBIDDEN_WORDS.length >= 15)
})

test('★ §15.3 아홉 갈래가 전부 막힌다', () => {
  // 소유자·권한 / 자격증명 / 한도 올리기 / 안전선·게이트 / 실행 방식 /
  // 손절 정책 / 감사 정책 / 개입 수준 / Lockbox 와 관문 선언
  const perCategory: [string, string][] = [
    ['소유자', 'change_owner'],
    ['자격증명', 'rotate_credential'],
    ['한도 올리기', 'raise_limit'],
    ['안전 게이트', 'disable_gate'],
    ['실행 방식', 'place_order'],
    ['손절 정책', 'set_protection'],
    ['감사 정책', 'change_audit'],
    ['개입 수준', 'set_intervention'],
    ['Lockbox', 'open_lockbox'],
  ]
  for (const [what, action] of perCategory) {
    assert.equal(whoDoes(action).by, 'human', `${what} 가 AI 에게 열려 있다 (${action})`)
  }
})

test('★ 설정 쪽에서도 같은 아홉이 막힌다', () => {
  const keys = [
    'owner_user_id', 'kis_env', 'daily_loss_limit_krw',
    'gate_max_broker_failure_streak', 'notify_enabled',
    'protection_recheck_minutes', 'validation_lockbox_days',
    'ai_intervention_retry_notifications', 'operator_enabled',
  ]
  for (const k of keys) assert.ok(aiMayPropose(k), `${k} 를 AI 가 제안할 수 있다`)
  assert.ok(AI_FORBIDDEN_PREFIXES.includes(INTERVENTION_KEY_PREFIX))
})

test('★ 운영자 코드가 설정을 직접 안 쓴다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources(join(TRADING, 'operator'))) {
    if (/saveTradingSetting\s*\(/.test(src)) offenders.push(`${file} — saveTradingSetting`)
    if (/from\('trading_settings'\)/.test(src)) offenders.push(`${file} — trading_settings`)
  }
  assert.deepEqual(offenders, [], `운영자가 설정을 쓴다:\n  ${offenders.join('\n  ')}`)
})

// ── ② 새 할 일 표 ───────────────────────────────────────

test('★ 트레이딩 마이그레이션이 만든 표에 할 일 표가 0개다', () => {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d+_trading/.test(f))
  assert.ok(files.length >= 5, `트레이딩 마이그레이션이 ${files.length}개뿐이다`)
  const created: string[] = []
  for (const f of files) {
    const sql = readFileSync(join(MIGRATIONS, f), 'utf8')
    created.push(...[...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map((m) => m[1]))
  }
  assert.ok(created.length >= 15, `만든 표가 ${created.length}개뿐이다`)
  const taskish = created.filter((t) => /task|todo|assignment|worklist|inbox/i.test(t))
  assert.deepEqual(taskish, [], `할 일 표를 만들었다: ${taskish.join(', ')}`)
})

test('★ 사람 할 일이 기존 업무로 간다', () => {
  const src = readFileSync(join(TRADING, 'operator', 'handoff.ts'), 'utf8')
  assert.ok(src.includes("from('daily_logs')"))
  assert.ok(src.includes("entry_type: 'planned'"))
})

// ── ③ 야간 전용 우회 ────────────────────────────────────

test('★ 게이트·신호 코드가 야간을 따로 보지 않는다', () => {
  const offenders: string[] = []
  for (const { file, src } of [...sources(join(TRADING, 'gate')), ...sources(join(TRADING, 'signal'))]) {
    if (/night/i.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `야간 분기가 생겼다:\n  ${offenders.join('\n  ')}`)
})

test('★ 안전 게이트가 열둘 그대로다', () => {
  assert.equal(GATE_IDS.length, 12)
  const src = readFileSync(join(TRADING, 'gate', 'safety.ts'), 'utf8')
  for (const id of GATE_IDS) {
    assert.ok(src.includes(`hit('${id}'`), `${id} 를 판정하는 자리가 없다`)
  }
})

test('★ 야간 신호가 꺼진 채로 나간다', () => {
  const row = TRADING_SETTINGS.find((s) => s.key === 'night_signal_enabled')
  assert.ok(row)
  assert.equal(row.defaultValue, false)
})

// ── ④ 자동이 기본인 항목 ────────────────────────────────

test('★ 자동이 기본인 개입 항목이 0개다 — 코드와 설정 둘 다', () => {
  for (const item of INTERVENTION_ITEMS) {
    assert.notEqual(DEFAULT_LEVELS[item], 'auto', `${item} 이 코드에서 자동이다`)
    const row = TRADING_SETTINGS.find((s) => s.key === interventionKey(item))
    assert.ok(row, `${item} 설정이 없다`)
    assert.notEqual(row.defaultValue, 'auto', `${item} 이 설정에서 자동이다`)
  }
})

// ── ⑤ 앞선 일을 안 죽인다 ───────────────────────────────

test('★ 운영자가 앞선 일 뒤에 오고 실패해도 안 죽인다', () => {
  const tick = readFileSync(join(TRADING, 'jobs', 'tick.ts'), 'utf8')
  const order = ['runWatch(', 'emitOrExplain(', 'knowledgeOrExplain(', 'operatorOrExplain(']
  const at = order.map((k) => tick.indexOf(k))
  for (const i of at) assert.ok(i > 0, `${order[at.indexOf(i)]} 를 안 부른다`)
  for (let i = 1; i < at.length; i += 1) {
    assert.ok(at[i - 1] < at[i], `${order[i]} 가 ${order[i - 1]} 보다 먼저 온다`)
  }
  for (const fnName of ['knowledgeOrExplain', 'operatorOrExplain']) {
    const fn = tick.slice(tick.indexOf(`async function ${fnName}`))
    assert.ok(fn.includes('} catch'), `${fnName} 이 감싸져 있지 않다`)
  }
})

test('★ 운영자가 신호·알림을 안 만든다', () => {
  for (const { file, src } of sources(join(TRADING, 'operator'))) {
    for (const banned of ['saveSignal', 'decideEmit', 'trading_signals']) {
      assert.equal(src.includes(banned), false, `${file} 이 ${banned} 에 닿는다`)
    }
  }
  /**
   * 알림 재발송은 허용 조치라 아웃박스는 지난다. **새로 만들지는 않는다.**
   *
   * 부르는 꼴(`이름(`)만 보면 안 된다 — 실측: `import { queueNotification }` 만 넣고
   * 안 불렀더니 초록이었다. 들여오는 것 자체가 위반이다
   */
  const remedy = stripComments(readFileSync(join(TRADING, 'operator', 'remedy.ts'), 'utf8'))
  assert.equal(remedy.includes('queueNotification'), false,
    '운영자가 알림을 새로 만들 수 있다 — 들여오면 다음 줄에서 부른다')
  assert.ok(remedy.includes('flushNotifications('), '안 나간 알림을 다시 안 보낸다')
})
