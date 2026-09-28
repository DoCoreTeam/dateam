/**
 * 가드 — **넣어 둔 키를 「없다」고 하지 않는다**
 *
 * 실측 2026-09-28: `META.jev_api_key` 에 60자짜리 키가 들어 있는데 현황 화면은
 * 「이 판에서 쓸 AI 키가 따로 등록되지 않았습니다」라고 적고 있었다. 사용자 말 그대로
 * 「키는 다 넣었는데 무슨소린지」. 그리고 조치라고 적은 「이 판에서 쓸 키를 등록하면」은
 * `ai_provider_keys` 에 판 칼럼이 없어 **할 수 없는 일**이었다.
 *
 * 그래서 이 시험은 문구가 예쁜지 보지 않는다. 셋만 본다 —
 * ① 있는 것을 없다고 하나 ② 못 하는 일을 시키나 ③ 화면이 바로 위에 그린 것과 모순되나.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  jevOffTitle, jevConsequenceLine, jevRunningElsewhere,
  JEV_OFF_REASON_LABEL, JEV_OFF_REMEDY_LABEL, JEV_OFF_CONSEQUENCE,
} from './jev-labels.ts'
import { jevStatusOf } from './overview-shape.ts'
import { TRADING_APP_DIR } from '../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

test('★ 키가 있는데 「등록되지 않았다」고 하지 않는다', () => {
  const line = JEV_OFF_REASON_LABEL.env_blocked
  // env_blocked 는 **키가 있을 때만** 나오는 상태다 (chooseKey: meta 가 비면 no_key)
  assert.doesNotMatch(line, /등록되지 않았|등록 안|없습니다/,
    `키가 있는 상태인데 없다고 말한다: ${line}`)
  assert.match(line, /키는|키가|AI 키/, '무엇에 대한 말인지 안 밝힌다')
  // 키가 정말 없는 상태는 따로 있고, 그쪽은 없다고 말해도 된다
  assert.match(JEV_OFF_REASON_LABEL.key_missing, /등록되지 않았/)
})

test('★ 조치가 할 수 있는 일을 말한다 — 없는 칸을 가리키지 않는다', () => {
  const remedy = JEV_OFF_REMEDY_LABEL.env_blocked
  /*
    `ai_provider_keys` 에는 판(env) 칼럼이 없다. 「이 판에서 쓸 키를 등록」은
    화면에 그런 칸이 없어 시키는 대로 해도 안 된다.
  */
  assert.doesNotMatch(remedy, /이 판에서 쓸 키|판에서 쓸 AI 키/,
    `등록할 칸이 없는 일을 시킨다: ${remedy}`)
  // 되는 일: 목록에 한 줄 넣으면 chooseKey 가 판을 안 보고 먼저 쓴다
  assert.match(remedy, /목록/, '실제로 되는 조치(키 목록 등록)를 안 말한다')
})

test('★ 마이그레이션에 판 칼럼이 없다는 사실이 아직 참이다', () => {
  // 칼럼이 생기면 위 시험의 전제가 바뀐다. 전제가 바뀐 줄 모르고 남아 있으면 그게 더 나쁘다
  const sql = readFileSync(join(HERE, '..', '..', '..', '..', 'supabase', 'migrations', '264_ai_provider_keys.sql'), 'utf8')
  const create = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS ai_provider_keys'), sql.indexOf('CREATE TABLE IF NOT EXISTS ai_provider_keys') + 1600)
  assert.doesNotMatch(create, /^\s+env\s/m, '판 칼럼이 생겼다 — 안내 문구를 다시 보라')
})

test('★ 기록이 있으면 「규칙 판단만 기록됩니다」라고 하지 않는다', () => {
  const withRecords = jevConsequenceLine({ reason: 'env_blocked', todayCount: 17 })
  assert.notEqual(withRecords, JEV_OFF_CONSEQUENCE,
    '화면이 바로 위에 AI 판단을 그려 놓고 규칙 판단만 쌓인다고 말한다')
  assert.match(withRecords, /17건/, '몇 건 쌓였는지 안 적는다 — 사실이 숫자 없이 서면 안 믿긴다')
  assert.equal(withRecords, jevRunningElsewhere(17))

  // 기록이 없으면 앞으로 벌어질 일을 그대로 말한다
  assert.equal(jevConsequenceLine({ reason: 'env_blocked', todayCount: 0 }), JEV_OFF_CONSEQUENCE)
  // 정말 꺼진 두 경우는 건수와 무관하게 결과가 같다
  assert.equal(jevConsequenceLine({ reason: 'key_missing', todayCount: 9 }), JEV_OFF_CONSEQUENCE)
  assert.equal(jevConsequenceLine({ reason: 'model_missing', todayCount: 9 }), JEV_OFF_CONSEQUENCE)
})

test('★ 제목이 「꺼짐」과 「이 화면만 안 씀」을 가른다', () => {
  assert.notEqual(jevOffTitle('env_blocked'), jevOffTitle('key_missing'),
    '막힌 것이 이 화면뿐인데 기능이 꺼진 것과 같은 제목을 단다')
  assert.doesNotMatch(jevOffTitle('env_blocked'), /꺼져/, '꺼진 것이 아니다')
  assert.match(jevOffTitle('key_missing'), /꺼져/)
})

test('오늘 건수가 상태에 실려 화면까지 간다', () => {
  const s = jevStatusOf({ model: 'jev/x', keyReason: 'env_blocked', aiJudgedToday: 17 })
  assert.equal(s.reason, 'env_blocked')
  assert.equal(s.aiJudgedToday, 17, '건수를 안 실으면 화면이 그 사실을 말할 수 없다')
  // 안 주면 0 — 「0 건이다」가 아니라 「모른다」에 가까우므로 결과 줄은 안 바뀐다
  assert.equal(jevStatusOf({ model: 'jev/x', keyReason: 'env_blocked' }).aiJudgedToday, 0)
})

test('★ 화면이 그 값을 실제로 그린다 — 만들어만 두지 않는다', () => {
  const src = readFileSync(join(HERE, '..', '..', TRADING_APP_DIR, 'JevPanel.tsx'), 'utf8')
  assert.ok(src.includes('jevConsequenceLine('), '결과 줄을 고르는 자리를 안 부른다')
  assert.ok(src.includes('aiJudgedToday'), '오늘 건수를 안 넘긴다 — 넘기지 않으면 늘 옛 문장이 나온다')
  assert.ok(src.includes('jevOffTitle('), '제목을 고정값으로 그린다')
})

test('★ 현황과 설정이 같은 사실에 같은 말을 한다', () => {
  /*
    설정 화면은 「키는 있지만 이 판에서는 쓰지 않습니다」라고 맞게 말하고 있었고
    현황 화면만 「등록되지 않았습니다」였다. 한 앱의 두 화면이 다른 말을 하면
    사용자는 어느 쪽이 참인지 고를 수 없다.
  */
  const gateway = readFileSync(join(HERE, '..', 'ai', 'provider-key-source.ts'), 'utf8')
  assert.match(gateway, /ENV_BLOCKED_MESSAGE/, '설정 쪽 문장이 사라졌다')
  for (const line of [JEV_OFF_REASON_LABEL.env_blocked, JEV_OFF_REMEDY_LABEL.env_blocked]) {
    assert.doesNotMatch(line, /없습니다$/, `있는 것을 없다고 끝맺는다: ${line}`)
  }
})
