/**
 * **백테스트와 실시간은 같은 함수를 쓴다** (명세 M4)
 *
 * ## 왜 가드가 필요한가
 *
 * 백테스트용으로 진입 조건이나 확정 봉 규칙을 따로 적으면, 고칠 때 한쪽만 고치는 날이 온다.
 * 그날부터 백테스트는 **실제로 안 도는 전략**의 성적을 말하고, 그 성적으로 관문을 통과한다.
 * 실전에서 안 재현되는 전형적인 경로이고, 화면에서는 아무 일도 안 일어난다.
 *
 * 그래서 검증 쪽(`backtest/`·`validation/`·`replay/`)에 실시간 쪽 함수의 **복사본**이
 * 생기는지 센다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRADING = join(WEB, 'lib', 'trading')

/** 검증 쪽 — 여기에 실시간 함수의 복사본이 생기면 안 된다 */
const VALIDATION_DIRS = ['backtest', 'validation', 'replay', 'calibrate', 'ev', 'stats', 'gate', 'backfill']

/**
 * 실시간 쪽이 주인인 함수들. 검증은 **들여와야** 하고 다시 선언하면 안 된다.
 *
 * 이름을 여기 적는 것이 곧 「이 함수는 하나뿐이다」라는 선언이다.
 */
const LIVE_OWNED = [
  // 지표와 진입 조건 — lib/trading/judge/indicators.ts
  'atr', 'sma', 'recentRange', 'computeIndicators', 'evaluateTriggers', 'requiredBarCount',
  // 확정 봉 규칙 — lib/trading/bars/confirm.ts
  'decideBarConfirmation', 'targetMinuteFor', 'aggregateBars',
  // 판단기 — lib/trading/judge/*
  'createRuleJudge', 'createJevJudge', 'createMlJudge', 'scoreFrom', 'strengthOf',
  // 세션 — lib/trading/calendar/session.ts
  'isContinuousTrading', 'sameDayExitAt', 'buildRegularSession',
  // 리스크 — lib/trading/risk/arithmetic.ts
  'computeRisk', 'worstEntryPrice', 'remainingLossBudget',
]

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!full.endsWith('.ts') || full.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function validationFiles(): { file: string; src: string }[] {
  return VALIDATION_DIRS
    .flatMap((d) => walk(join(TRADING, d)))
    .map((file) => ({ file: relative(WEB, file), src: readFileSync(file, 'utf8') }))
}

test('★ 검증 쪽에 실시간 함수의 복사본이 없다 (M4)', () => {
  const offenders: string[] = []
  for (const { file, src } of validationFiles()) {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
    for (const name of LIVE_OWNED) {
      // 선언이 있으면 복사본이다. 들여오기(import)는 선언이 아니다
      const declared = new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\b`, 'm')
      if (declared.test(body)) offenders.push(`${file} 의 ${name}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    `검증 쪽에 실시간 함수의 복사본이 생겼다:\n  ${offenders.join('\n  ')}\n\n` +
      `고칠 때 한쪽만 고치는 날이 오고, 그날부터 백테스트는 실제로 안 도는 전략의 성적을 말한다(M4).\n` +
      `들여와서 쓴다.`,
  )
})

test('★ 백테스트가 실시간 모듈을 실제로 들여온다 — 안 들여오면 복사본도 없고 호출도 없다', () => {
  const run = readFileSync(join(TRADING, 'backtest', 'run.ts'), 'utf8')
  for (const from of ['../judge/indicators.ts', '../replay/execution.ts', '../risk/arithmetic.ts']) {
    assert.ok(run.includes(from), `backtest/run.ts 가 ${from} 를 안 들여온다`)
  }
})

test('★ 검증 파이프라인이 실시간 판단기를 그대로 쓴다', () => {
  const pipeline = readFileSync(join(TRADING, 'validation', 'pipeline.ts'), 'utf8')
  assert.match(pipeline, /from '\.\.\/judge\/rule\.ts'/, '규칙 판단기를 안 들여온다')
  assert.match(pipeline, /from '\.\.\/judge\/ml\.ts'/, 'ml 기준선을 안 들여온다')
  assert.match(pipeline, /createRuleJudge\(/, '규칙 판단기를 안 부른다')
})

test('규칙이 실제로 도는 대상이 있다 — 0개면 위 단정은 언제나 초록이다', () => {
  const files = validationFiles()
  assert.ok(files.length >= 10, `검사 대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  assert.ok(LIVE_OWNED.length >= 15)
})
