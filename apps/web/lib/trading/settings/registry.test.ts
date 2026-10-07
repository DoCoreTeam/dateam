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
  JUDGE_PROVIDERS,
  numberDefault,
} from './registry.ts'
import { AI_PROVIDERS, openAiCompatibleBaseUrl, type AiProviderId } from '../../ai/provider-catalog.ts'
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
  assert.ok(seen.size >= 40, '등재된 설정이 40개보다 적다')
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

/**
 * SG-01 은 값이 **둘** 있어야 걸린다 — 스프레드가 얼마나 넓어야 이상이고,
 * 봉이 몇 분 안 와야 결측인가. 둘 중 하나라도 등록부에 없으면 재는 코드가
 * 자기 숫자를 들게 되고, 그러면 화면에서 고칠 수 없는 값이 판단을 바꾼다.
 */
test('★ SG-01 이 볼 기준값 둘이 등록부에 있다', () => {
  const wanted = ['gate_spread_abnormal_multiple', 'gate_bar_late_minutes']
  const found = TRADING_SETTINGS.filter((s) => wanted.includes(s.key))
  assert.equal(found.length, 2, `SG-01 기준값이 ${found.length}개다: ${found.map((s) => s.key).join(', ')}`)
  for (const s of found) {
    assert.equal(s.group, 'safety', `${s.key} 가 안전 게이트 묶음에 없다 — 화면의 다른 절에 섞인다`)
    assert.equal(typeof s.min, 'number', `${s.key} 에 하한이 없다`)
    assert.equal(typeof s.max, 'number', `${s.key} 에 상한이 없다`)
    assert.ok(s.source.includes('SG-01'), `${s.key} 의 근거가 SG-01 이 아니다`)
  }
  // 범위를 벗어난 값은 막힌다. 배수 1 은 「중앙값보다 넓으면 전부 이상」이라 매분 걸린다
  assert.equal(validateSetting('gate_spread_abnormal_multiple', 1)?.reason,
    'below_min:gate_spread_abnormal_multiple')
  assert.equal(validateSetting('gate_bar_late_minutes', 0)?.reason,
    'below_min:gate_bar_late_minutes')
})

/**
 * 게이트 이름을 설정 이름표에 적어 두면 사람이 그 줄을 보고 어느 게이트를 고치는지 안다.
 * 틀린 번호를 적으면 다른 게이트를 고친 줄 알고 화면을 덮는다 —
 * 실제로 증거금 기준값이 `SG-06` 으로 적혀 있었고 코드는 `SG-09` 를 올리고 있었다.
 */
test('★ 안전 게이트 설정의 이름표 번호가 실제로 올리는 게이트와 같다', () => {
  const safety = readFileSync(join(TRADING_DIR, 'gate', 'safety.ts'), 'utf8')
  const RAISED: Record<string, string> = {
    gate_spread_abnormal_multiple: 'SG-01',
    gate_bar_late_minutes: 'SG-01',
    gate_max_broker_failure_streak: 'SG-02',
    gate_max_minutes_since_run: 'SG-03',
    gate_max_notify_failure_streak: 'SG-06',
    gate_max_unopened_signals: 'SG-07',
    gate_margin_tight_rate_percent: 'SG-09',
    gate_price_limit_near_ticks: 'SG-11',
  }
  for (const s of TRADING_SETTINGS.filter((x) => x.group === 'safety')) {
    const id = RAISED[s.key]
    assert.ok(id, `안전 게이트 설정 ${s.key} 가 어느 게이트를 올리는지 대응표에 없다`)
    /**
     * **번호는 근거에 남고 이름에는 안 나온다.**
     *
     * 전에는 이름표가 `SG-01 …` 으로 시작하는지를 봤다. 그런데 사람은 `SG-01` 을 모른다
     * (사용자 지적 2026-09-27 「이게 무슨말이야」). 추적은 끊기면 안 되므로
     * 번호를 `source` 로 옮겼고, 이 가드도 그 자리를 본다.
     */
    assert.ok(s.source.includes(id), `${s.key} 의 근거 절이 ${id} 가 아니다: ${s.source}`)
    assert.ok(safety.includes(`'${id}'`), `${id} 를 올리는 코드가 safety.ts 에 없다`)
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

/**
 * **공급자 목록을 손으로 안 적는다** (§7.2)
 *
 * 사본을 적어 두면 공급자를 하나 늘린 날 그 줄이 안 따라오고, 화면에는 멀쩡한 공급자가
 * 영영 안 보인다. 이 저장소가 같은 함정에 여러 번 빠졌다.
 */
test('★ 판단 공급자를 목록에서 고른다 — 글자로 적지 않는다', () => {
  const spec = TRADING_SETTINGS.find((s) => s.key === 'jev_provider')
  assert.ok(spec, '판단 공급자 설정이 없다')
  assert.equal(spec.type, 'choice', '글자로 적게 두면 오타 하나로 판단이 안 돈다')
  assert.ok((spec.choices ?? []).length > 0, '고를 것이 없다')
  assert.equal(spec.defaultValue, 'jev', '기본값이 지금 동작과 다르다')
  assert.ok((spec.choices ?? []).includes('jev'))
})

test('★ 고를 수 있는 것은 판단을 부를 문이 있는 공급자뿐이다', () => {
  for (const id of JUDGE_PROVIDERS) {
    assert.notEqual(openAiCompatibleBaseUrl(id as AiProviderId), null,
      `${id} 는 부를 문이 없는데 목록에 있다 — 골라도 판단기가 안 만들어진다`)
  }
  // 문이 없는 공급자는 안 나온다. claude 는 SDK 로만 말한다
  for (const spec of AI_PROVIDERS) {
    if (openAiCompatibleBaseUrl(spec.id) === null) {
      assert.equal(JUDGE_PROVIDERS.includes(spec.id), false, `${spec.id} 가 문 없이 목록에 있다`)
    }
  }
})

test('★ 목록이 공급자 명세에서 나온다 — 새 공급자가 따라온다', () => {
  const src = readFileSync(join(HERE, 'registry.ts'), 'utf8')
  const at = src.indexOf('export const JUDGE_PROVIDERS')
  const body = src.slice(at, src.indexOf('\n\n', at))
  assert.ok(body.includes('AI_PROVIDERS'), '명세에서 안 가져온다')
  assert.equal(/\['jev'|"jev"/.test(body), false, '목록을 손으로 적었다')
})

/**
 * **권장은 고르는 자리에 있어야 한다.**
 *
 * 전에는 이 가드가 도움말에 실측 날짜와 권장 모델 이름이 적혀 있는지를 봤다.
 * 그래서 도움말이 개발 기록이 됐고 사용자가 읽고 「이게 무슨말이야」라고 물었다
 * (2026-09-27). 권장은 글로 적는 것이 아니라 **고를 때 보여 주는 것**이다.
 */
test('★ 고르는 설정에는 고를 것이 있다 — 빈칸에 적어 넣게 두지 않는다', () => {
  const choices = TRADING_SETTINGS.filter((s) => s.type === 'choice')
  assert.ok(choices.length > 0, '고르는 설정이 하나도 없다')
  for (const s of choices) {
    assert.ok((s.choices ?? []).length > 0, `${s.key} 가 고를 것을 안 준다`)
  }
})

/* ── 현황이 스스로 다시 읽는 간격 ─────────────────────── */

/**
 * **실시간처럼 보이는 화면은 스스로 읽는 화면이다** (사용자 지적 2026-09-28
 * 「실시간으로 보여지는 화면 형태여야」).
 *
 * 간격을 env 로 두면 값을 바꾸려고 배포를 기다려야 하고, 그러면 아무도 안 바꾼다.
 * 그래서 설정값이고, 설정값이면 화면이 그 값을 **실제로 읽어야** 뜻이 있다.
 */
const TRADING_APP = join(HERE, '..', '..', '..', 'app', '(trading)', 'trading')

test('★ 현황 새로 읽는 간격이 설정이다 — env 가 아니다', () => {
  const s = tradingSetting('overview_refresh_seconds')
  assert.ok(s, '간격 설정이 등록부에 없다')
  assert.equal(s?.type, 'number')
  assert.equal(s?.group, 'basic', '묶음이 없으면 설정 화면에서 안 보인다')
  assert.ok((s?.min ?? 0) >= 5, '0 이나 1초를 허용하면 서버를 쉬지 않고 두드린다')
  assert.ok((s?.max ?? 0) <= 3600)
  // 현재가는 별도 스트림이 받는다. 무거운 전체 화면은 30초마다 읽는다.
  assert.equal(defaultSettings().overview_refresh_seconds, 30)

  const page = readFileSync(join(TRADING_APP, 'page.tsx'), 'utf8')
  assert.match(page, /values\.overview_refresh_seconds/, '화면이 그 값을 안 읽는다')
  assert.match(page, /<LiveRefresh\s+everySeconds=\{/, '읽은 값을 안 넘긴다')
})

test('★ 현재가 간격은 전체 현황 새로 읽기와 다른 설정이다', () => {
  const price = tradingSetting('price_push_seconds')
  const overview = tradingSetting('overview_refresh_seconds')
  assert.ok(price)
  assert.equal(price?.type, 'number')
  assert.equal(price?.group, 'basic')
  assert.equal(price?.defaultValue, 1)
  assert.equal(price?.min, 1)
  assert.equal(price?.max, 10)
  assert.notEqual(price?.key, overview?.key)

  const page = readFileSync(join(TRADING_APP, 'page.tsx'), 'utf8')
  assert.match(page, /values\.price_push_seconds/, '화면이 현재가 간격을 안 읽는다')
  assert.match(page, /pricePushSeconds=\{pricePushSeconds\}/, '차트에 현재가 간격을 안 넘긴다')
})

/**
 * **「30초마다 다시 읽습니다」는 지금 무엇을 하는지를 말하지 않는다**
 * (사용자 지적 2026-09-28 「실시간이어야 하는데 30초는 왜? 이게 뭘 하고 있는건지 모르겠네」).
 *
 * 가격은 1분 봉이라 데이터가 1분에 한 번만 바뀐다. 그 사실과 다음 읽기까지 남은 초를
 * 함께 말해야 사람이 「멈춘 것」과 「기다리는 것」을 가를 수 있다.
 */
test('★ 맨 위 줄이 마지막 봉 시각과 남은 시간을 말한다', () => {
  const src = readFileSync(join(TRADING_APP, 'LiveRefresh.tsx'), 'utf8')
  assert.match(src, /lastBarAt/, '마지막 봉 시각을 안 받는다')
  assert.match(src, /마지막 봉/, '마지막 봉이 언제 것인지 안 말한다')
  assert.match(src, /초 뒤 다시 읽습니다/, '남은 시간을 안 말한다')
  // 봉이 없으면 없다고 한다 — 빈 칸을 지어내지 않는다
  assert.match(src, /가격 봉이 아직 없습니다/, '봉이 없는 날 빈 자리가 된다')

  const page = readFileSync(join(TRADING_APP, 'page.tsx'), 'utf8')
  assert.match(page, /lastBarAt=\{overview\.chart\.lastBarAt\}/, '화면이 그 값을 안 넘긴다')
})

test('★ 1초 시계가 서버를 안 두드린다 — 살아 있는 것을 보여 주려고 서버를 죽이지 않는다', () => {
  const src = readFileSync(join(TRADING_APP, 'LiveRefresh.tsx'), 'utf8')
  const at = src.indexOf('tick = setInterval(')
  assert.ok(at > 0, '1초 시계가 없다')
  const body = src.slice(at, src.indexOf('}, 1000)', at))
  assert.equal(/router\.refresh|fetch\(|listJudge|load\(/.test(body), false,
    '1초마다 서버를 두드린다')
  assert.match(body, /setLeftSec/, '남은 시간을 안 줄인다')
  // 탭이 뒤에 있으면 숫자도 안 센다 — 안 보는 화면에서 도는 시계다
  assert.match(body, /document\.hidden/, '안 보는 화면에서도 시계가 돈다')
})

test('★ 안 보는 화면을 위해 서버를 두드리지 않는다', () => {
  const src = readFileSync(join(TRADING_APP, 'LiveRefresh.tsx'), 'utf8')
  /**
   * **이름이 어디 있는지가 아니라 어느 자리에 있는지를 본다.**
   *
   * 파일 아무 데나 `document.hidden` 이 있으면 통과시키면, 돌아왔을 때 쓰는 쪽에만
   * 남기고 시계가 부르는 쪽에서 지워도 초록이 된다 — 실제로 그렇게 깨 봤더니 통과했다.
   * 그래서 **시계가 부르는 함수의 몸통**을 잘라 그 안에서 찾는다.
   */
  const at = src.indexOf('const read = ')
  assert.ok(at > 0, '시계가 부르는 함수를 못 찾겠다 — 이름이 바뀌었으면 가드도 따라와야 한다')
  const body = src.slice(at, src.indexOf('\n    }', at))
  assert.match(body, /document\.hidden/, '시계가 탭이 뒤에 있는지 안 보고 읽는다')
  assert.match(src, /setInterval\(read,/, '시계가 그 함수를 안 부른다')
  assert.match(src, /visibilitychange/, '돌아왔을 때 한 번 안 읽어 옛 값이 남는다')
  assert.match(src, /router\.refresh\(\)/, '창구를 새로 열어 읽는다 — 관문이 갈린다')
  assert.equal(/process\.env/.test(src), false, '간격을 env 에서 읽는다')
  // 값은 넘겨받는다. 화면이 스스로 정하면 설정과 화면이 다른 간격을 본다
  assert.equal(/setInterval\([^,]+,\s*\d{3,}\s*\)/.test(src), false, '간격을 코드에 박았다')
})

test('★ 다시 읽는 중임을 말하고 마지막으로 읽은 때를 적는다 (B-7)', () => {
  const src = readFileSync(join(TRADING_APP, 'LiveRefresh.tsx'), 'utf8')
  assert.match(src, /다시 읽는 중/, '기다리는 자리가 무엇을 하는지 안 말한다')
  assert.match(src, /읽음/, '마지막으로 읽은 때를 안 적는다')
  assert.match(src, /role="status"/, '화면 읽기 도구가 이 줄이 바뀐 것을 모른다')
  // 시각은 화면이 잰다 — 서버가 적어 보내면 그것은 「서버가 그린 때」다
  assert.match(src, /seoulTimeText\(/, '시각을 우리 표기로 안 적는다')
})


// ── 월물 교체 기한 ───────────────────────────────────────

/**
 * 실측 2026-10-07. 기본값이 3 이면 「최종거래일까지 3 거래일」에 걸려
 * 거래가 아직 안 넘어온 월물로 이틀을 보낸다 — 그날 거래량이 10월물 112,701 대 11월물 5,036 이었다.
 * 미니 코스피200 은 월물이 매달 있어 거래가 만기 직전에야 넘어온다.
 */
test('★ 월물 교체 기한 기본값이 1 거래일이다 — 3 이면 거래가 안 넘어온 월물로 이틀을 보낸다', () => {
  assert.equal(numberDefault('rollover_days_before_last'), 1)
})

test('기한은 거래량이 정하는 교체의 마지막 보루라고 말한다 — 화면이 「이것이 규칙」으로 읽히지 않게', () => {
  const help = tradingSetting('rollover_days_before_last')?.help ?? ''
  assert.match(help, /거래량/, '무엇이 교체를 정하는지 안 말한다')
  assert.match(help, /보루|마지막/, '이 값이 예외라는 것을 안 말한다')
})

test('숫자가 아닌 설정의 기본값을 물으면 던진다 — 조용한 0 이 한도나 기한이 되지 않게', () => {
  assert.throws(() => numberDefault('kis_env'))
  assert.throws(() => numberDefault('없는_키'))
})
