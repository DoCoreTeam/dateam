/**
 * 설정 레지스트리가 명세와 어긋나지 않게 한다
 *
 * **왜 값을 테스트가 다시 적나**: 여기 적힌 숫자는 레지스트리의 사본이 아니라
 * **명세 §19 의 사본**이다. 두 곳이 같은 값을 말해야 하고, 누군가 레지스트리에서
 * 슬쩍 바꾸면 이 파일이 명세를 들고 막는다. 사본이라 갈린다는 지적은 맞지만,
 * 갈렸을 때 **어느 쪽이 맞는지 아는** 사본이라 둔다 — 명세가 맞다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TRADING_SETTINGS,
  defaultSettings,
  tradingSetting,
  validateSetting,
  validateSettingSet,
} from './registry.ts'
import { pickEffective } from './pick-effective.ts'
import { TRADING_GROUP_LABEL } from './labels.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING_DIR = join(HERE, '..')

/** 명세 §19 「기본값 (질문 없이 이 값으로 진행)」 표 열 줄 */
const SPEC_19: readonly { row: string; key: string; value: string | number }[] = [
  { row: '상품', key: 'instrument_root', value: 'MINI_KOSPI200' },
  { row: '판단 봉', key: 'decision_tf', value: '1m' },
  { row: '보유 기준', key: 'min_hold_minutes', value: 15 },
  { row: 'Jev 대기 시간', key: 'jev_timeout_seconds', value: 10 },
  { row: '일일 손실 한도', key: 'daily_loss_limit_krw', value: 500000 },
  { row: '일일 목표', key: 'daily_target_krw', value: 300000 },
  { row: '주문 방식(체결 재현용)', key: 'replay_order_type', value: 'market' },
  { row: '수수료율', key: 'fee_rate', value: 0 },
  { row: '확정 봉 여유', key: 'bar_grace_seconds', value: 10 },
  { row: '결측 판정', key: 'bar_missing_after_seconds', value: 25 },
  { row: 'KIS 호출 최소 간격', key: 'kis_min_interval_ms', value: 200 },
  { row: '당일 청산 알림 N', key: 'session_close_exit_minutes', value: 15 },
  { row: '개발 환경 KIS 키', key: 'kis_env', value: 'real' },
]

test('명세 §19 의 초기값이 전부 등재돼 있고 값이 같다', () => {
  const defaults = defaultSettings()
  for (const { row, key, value } of SPEC_19) {
    assert.ok(tradingSetting(key), `§19 「${row}」에 해당하는 설정 ${key} 가 레지스트리에 없다`)
    assert.equal(defaults[key], value, `§19 「${row}」의 초기값이 다르다`)
  }
  assert.equal(SPEC_19.length, 13, '§19 표 열 줄이 설정 키 13개가 된다(한 줄에 값 둘인 줄이 셋)')
})

test('키는 겹치지 않고, 값마다 언제부터 쓰는지와 근거가 적혀 있다', () => {
  const seen = new Set<string>()
  for (const s of TRADING_SETTINGS) {
    assert.ok(!seen.has(s.key), `설정 키가 두 번 나온다: ${s.key}`)
    seen.add(s.key)
    assert.ok(s.usedFrom, `${s.key} 에 usedFrom 이 없다 — 아무도 안 읽는 값이 조용히 쌓인다`)
    assert.ok(s.source.length > 0, `${s.key} 에 근거(명세 절)가 없다`)
    assert.ok(s.help.length > 0, `${s.key} 에 설명이 없다 — 이름만으로는 왜 그 값인지 모른다`)
    if (s.type === 'choice') {
      assert.ok((s.choices ?? []).length >= 2, `${s.key} 는 고를 것이 둘 이상이어야 한다`)
      assert.ok(
        (s.choices ?? []).includes(String(s.defaultValue)),
        `${s.key} 의 초기값이 고를 수 있는 값에 없다`,
      )
    }
  }
  assert.ok(seen.size >= 37, '등재된 설정이 37개보다 적다')
})

test('비밀값은 설정에 없다 (S3)', () => {
  const src = readFileSync(join(HERE, 'registry.ts'), 'utf8')
  const forbidden = ['appkey', 'appsecret', 'account_no', 'app_secret', 'password', 'private_key']
  for (const word of forbidden) {
    assert.equal(
      new RegExp(word, 'i').test(src),
      false,
      `설정 레지스트리에 「${word}」가 있다. 자격증명은 암호화 표에만 둔다`,
    )
  }
  for (const s of TRADING_SETTINGS) {
    // 이름이 비밀 **그 자체**를 가리키는 키만 막는다.
    // `kis_token_refresh_margin_minutes` 처럼 비밀을 다루는 동작의 숫자는 설정이 맞다 —
    // 「token 이 들어가면 비밀」로 재면 진짜 설정까지 같이 막혀 규칙이 무시당한다
    assert.equal(
      /(^|_)(secret|password|credential|appkey|appsecret)(_|$)|_(token|key|secret|password)$/i.test(s.key),
      false,
      `${s.key} 는 비밀 그 자체로 읽힌다. 자격증명은 암호화 표에만 둔다`,
    )
  }
})

/**
 * **매매 숫자를 레지스트리 밖에 또 적지 못하게 한다.**
 *
 * 실제로 나는 사고는 「설정을 만들어 놓고 코드는 자기 상수를 읽는 것」이다.
 * 그러면 화면은 바뀐 값을 보여 주는데 판단은 옛 값으로 돈다.
 * 그래서 설정 키와 같은 이름의 모듈 상수를 `lib/trading/**` 안에서 금지한다.
 */
test('설정 키와 같은 이름의 상수를 레지스트리 밖에 선언하지 않는다', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
      // 값을 **선언하는** 자리는 레지스트리 하나뿐이다. 나머지는 전부 검사 대상이고,
      // 저장소(store.ts)도 예외가 아니다 — 거기서 상수로 들면 화면과 판단이 갈린다
      if (full === join(HERE, 'registry.ts')) continue
      if (entry.endsWith('.test.ts')) continue
      files.push(full)
    }
  }
  walk(TRADING_DIR)

  const offenders: string[] = []
  for (const key of TRADING_SETTINGS.map((s) => s.key)) {
    const constName = key.toUpperCase()
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (new RegExp(`\\bconst\\s+${constName}\\s*=`).test(src)) {
        offenders.push(`${file.slice(TRADING_DIR.length + 1)} 의 ${constName}`)
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `설정 값을 코드에 다시 적었다:\n  ${offenders.join('\n  ')}\n` +
      `설정은 loadTradingSettings 로 읽는다 — 상수로 들면 화면과 판단이 갈린다`,
  )
  // 규칙이 실제로 도는 대상이 있어야 한다. 파일이 0개면 위 단정은 언제나 초록이다
  assert.ok(files.length > 0, `검사 대상 파일이 0개다: ${TRADING_DIR}`)
})

test('모르는 키·틀린 형·범위 밖은 사유와 함께 막힌다', () => {
  assert.equal(validateSetting('decision_tf', '1m'), null)

  const unknown = validateSetting('nope', 1)
  assert.equal(unknown?.reason, 'unknown_key:nope')
  assert.ok((unknown?.userMessage ?? '').length > 0, '사람이 읽을 문장이 없다')

  assert.equal(validateSetting('jev_timeout_seconds', '10')?.reason, 'type_mismatch:jev_timeout_seconds')
  assert.equal(validateSetting('jev_timeout_seconds', 0)?.reason, 'below_min:jev_timeout_seconds')
  assert.equal(validateSetting('jev_timeout_seconds', 31)?.reason, 'above_max:jev_timeout_seconds')
  assert.equal(validateSetting('decision_tf', '3m')?.reason, 'not_a_choice:decision_tf')
})

test('단기 이동평균이 장기보다 길거나 같은 조합은 막힌다 — 교차가 일어나지 않는다', () => {
  const same = { ...defaultSettings(), sma_fast_period: 20, sma_slow_period: 20 }
  assert.equal(validateSettingSet(same)?.reason, 'fast_not_faster')
  const flipped = { ...defaultSettings(), sma_fast_period: 30, sma_slow_period: 20 }
  assert.equal(validateSettingSet(flipped)?.reason, 'fast_not_faster')
})

test('결측 판정이 확정 여유보다 빠른 조합은 막힌다', () => {
  assert.equal(validateSettingSet(defaultSettings()), null)

  const bad = { ...defaultSettings(), bar_grace_seconds: 25, bar_missing_after_seconds: 10 }
  const rejection = validateSettingSet(bad)
  assert.equal(rejection?.reason, 'missing_before_grace')

  // 같은 값이어도 막는다 — 확정될 기회가 0초다
  const tie = { ...defaultSettings(), bar_grace_seconds: 10, bar_missing_after_seconds: 10 }
  assert.equal(validateSettingSet(tie)?.reason, 'missing_before_grace')
})

test('거래일 기준으로 유효한 판만 고른다 — 미리 저장한 다음 판은 안 샌다', () => {
  const rows = [
    { key: 'jev_timeout_seconds', value: 10, version: 1, effective_trade_date: '2026-09-01' },
    { key: 'jev_timeout_seconds', value: 12, version: 2, effective_trade_date: '2026-09-20' },
    // 내일부터 유효한 판. 오늘 판단에 섞이면 「다음 거래일부터」 규칙이 깨진다
    { key: 'jev_timeout_seconds', value: 20, version: 3, effective_trade_date: '2026-09-26' },
  ]
  const picked = pickEffective(rows, '2026-09-25')
  assert.equal(picked.get('jev_timeout_seconds')?.value, 12)
  assert.equal(picked.get('jev_timeout_seconds')?.version, 2)

  const tomorrow = pickEffective(rows, '2026-09-26')
  assert.equal(tomorrow.get('jev_timeout_seconds')?.value, 20)
})

// ── 규칙이 읽을 값이 실제로 있나 ─────────────────────────

/**
 * `SignalRuleThresholds`·`SafetyThresholds` 는 값을 **인자로** 받는다.
 * 그 인자를 채울 설정 키가 없으면 배선할 때 숫자를 코드에 적게 되고,
 * 그러면 설정 화면과 규칙이 다른 값을 본다 — 「바꿨는데 안 바뀐다」가 된다.
 *
 * 이름으로 짝을 짓지 않고 **손으로 대응표를 적는다.** 이름 규칙으로 짝을 지으면
 * 이름을 바꾸는 순간 조용히 안 걸린다.
 */
const THRESHOLD_TO_KEY: Record<string, string> = {
  // SignalRuleThresholds
  minNetExpectedValueR: 'signal_min_net_ev_r',
  minEnterNowProb: 'signal_min_enter_now_prob',
  openingBlockMinutes: 'signal_opening_block_minutes',
  closingBlockMinutes: 'signal_closing_block_minutes',
  dailyTargetKrw: 'daily_target_krw',
  cooldownAfterLosses: 'signal_cooldown_after_losses',
  cooldownMinutes: 'signal_cooldown_minutes',
  maxSignalsPerDay: 'signal_max_per_day',
  sameDirectionGapMinutes: 'signal_same_direction_gap_minutes',
  minTargetCostMultiple: 'signal_min_target_cost_multiple',
  // SafetyThresholds
  maxBrokerFailureStreak: 'gate_max_broker_failure_streak',
  maxMinutesSinceRun: 'gate_max_minutes_since_run',
  maxNotifyFailureStreak: 'gate_max_notify_failure_streak',
  maxUnopenedSignals: 'gate_max_unopened_signals',
}

/** `export interface X { ... }` 안의 칸 이름을 읽는다 */
function fieldsOf(file: string, interfaceName: string): string[] {
  const src = readFileSync(join(HERE, '..', ...file.split('/')), 'utf8')
  const start = src.indexOf(`export interface ${interfaceName} {`)
  assert.notEqual(start, -1, `${interfaceName} 를 못 찾았다`)
  const body = src.slice(start, src.indexOf('\n}', start))
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
  return [...body.matchAll(/^\s{2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)].map((m) => m[1])
}

test('★ 신호 규칙의 기준값 칸마다 설정 키가 있다 — 없으면 그 규칙은 기준값 없이 돈다', () => {
  const fields = fieldsOf('signal/rules.ts', 'SignalRuleThresholds')
  assert.ok(fields.length >= 10, `칸을 ${fields.length}개밖에 못 읽었다 — 정규식이 형을 못 따라간다`)
  for (const field of fields) {
    const key = THRESHOLD_TO_KEY[field]
    assert.ok(key, `SignalRuleThresholds.${field} 에 대응하는 설정 키가 대응표에 없다`)
    assert.ok(TRADING_SETTINGS.some((s) => s.key === key), `설정 ${key} 가 레지스트리에 없다`)
  }
})

test('★ 안전 게이트의 기준값 칸마다 설정 키가 있다', () => {
  const fields = fieldsOf('gate/safety.ts', 'SafetyThresholds')
  assert.ok(fields.length >= 4)
  for (const field of fields) {
    const key = THRESHOLD_TO_KEY[field]
    assert.ok(key, `SafetyThresholds.${field} 에 대응하는 설정 키가 대응표에 없다`)
    assert.ok(TRADING_SETTINGS.some((s) => s.key === key), `설정 ${key} 가 레지스트리에 없다`)
  }
})

test('★ 게이트를 끄는 설정이 없다 — 끌 수 있으면 언젠가 꺼 놓은 채로 돈다', () => {
  for (const s of TRADING_SETTINGS.filter((s) => s.group === 'safety')) {
    assert.equal(s.type, 'number', `안전 게이트 설정 ${s.key} 가 켜고 끄는 값이다`)
    assert.equal(/enabled|disable|bypass|skip|off/i.test(s.key), false, `${s.key} 가 끄는 이름이다`)
  }
})

test('★ 알림 켜기는 꺼진 채로 시작한다 (C4)', () => {
  const row = TRADING_SETTINGS.find((s) => s.key === 'notify_enabled')
  assert.ok(row)
  assert.equal(row.defaultValue, false, '검증 전에 알림이 켜진 채로 배포된다')
})

test('새 묶음에도 이름이 있다 — 이름 없는 절은 화면에서 사라진다', () => {
  const groups = new Set(TRADING_SETTINGS.map((s) => s.group))
  for (const g of groups) {
    assert.ok(TRADING_GROUP_LABEL[g], `묶음 ${g} 에 이름이 없다`)
  }
})
