import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateSetting, getSettingDef, codeDefaults, listSettingDefs } from './registry.ts'
import { resolveSettings, resolveOrigin, getResolved, type SettingRow } from './resolve.ts'
import {
  encryptSecret, decryptSecret, isSecretEnvelope, isMasterKeyAvailable,
  maskIfSecret, MASKED_VALUE, MasterKeyUnavailableError,
} from './crypto.ts'

// ── 레지스트리 ───────────────────────────────────────────────────

test('미등록 키는 저장이 거부된다', () => {
  const r = validateSetting('nope.not.a.key', 'workspace', 1)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.code, 'VALIDATION_FAILED')
})

test('스코프가 다르면 거부된다', () => {
  // account.locale은 user 스코프
  const r = validateSetting('account.locale', 'workspace', 'ko')
  assert.equal(r.ok, false)
})

test('범위를 벗어난 값은 거부된다', () => {
  assert.equal(validateSetting('alert.outlier.threshold', 'workspace', 1).ok, false)   // 최소 1.5
  assert.equal(validateSetting('alert.outlier.threshold', 'workspace', 3).ok, true)
  assert.equal(validateSetting('topic.autoconfirm_threshold', 'workspace', 1.5).ok, false)
  assert.equal(validateSetting('analysis.window_days', 'workspace', 3).ok, false)      // 최소 7
})

test('설정을 하나도 건드리지 않아도 모든 키에 안전한 기본값이 있다', () => {
  const defaults = codeDefaults()
  for (const d of listSettingDefs()) {
    assert.ok(d.key in defaults, `${d.key} 기본값 누락`)
    assert.equal(d.schema.safeParse(defaults[d.key]).success, true, `${d.key} 기본값이 스키마 위반`)
  }
})

test('설계서가 정한 기본값이 지켜진다', () => {
  assert.equal(getSettingDef('alert.outlier.threshold')?.defaultValue, 3)
  assert.equal(getSettingDef('topic.autoconfirm_threshold')?.defaultValue, 0.85)
  assert.equal(getSettingDef('analysis.window_days')?.defaultValue, 28)
})

test('킬 스위치와 예산 상한은 어시스턴트가 건드릴 수 없다', () => {
  assert.equal(getSettingDef('flag.ci_enabled')?.assistantBlocked, true)
  assert.equal(getSettingDef('llm.budget_cap_krw')?.assistantBlocked, true)
})

// ── 스코프 해석 ──────────────────────────────────────────────────

const CTX = { userId: 'u1', workspaceId: 'w1' }

function row(p: Partial<SettingRow> & Pick<SettingRow, 'scope' | 'key' | 'value'>): SettingRow {
  return { scope_id: null, is_encrypted: false, version: 1, ...p }
}

test('해석 순서는 개인 > 워크스페이스 > 시스템 > 코드 기본값', () => {
  const rows: SettingRow[] = [
    row({ scope: 'system', key: 'account.locale', value: 'en' }),
    row({ scope: 'workspace', scope_id: 'w1', key: 'ws.timezone', value: 'UTC' }),
    row({ scope: 'user', scope_id: 'u1', key: 'account.locale', value: 'ko' }),
  ]
  const r = resolveSettings(rows, CTX)
  assert.equal(r['account.locale'], 'ko')          // user가 system을 이긴다
  assert.equal(r['ws.timezone'], 'UTC')            // workspace 값
  assert.equal(r['analysis.window_days'], 28)      // 아무도 안 정하면 코드 기본값
})

test('다른 사용자·다른 워크스페이스 행은 섞여 들어와도 무시된다', () => {
  const rows: SettingRow[] = [
    row({ scope: 'user', scope_id: 'someone-else', key: 'account.locale', value: 'en' }),
    row({ scope: 'workspace', scope_id: 'other-ws', key: 'ws.timezone', value: 'UTC' }),
  ]
  const r = resolveSettings(rows, CTX)
  assert.equal(r['account.locale'], 'ko')      // 기본값 유지
  assert.equal(r['ws.timezone'], 'Asia/Seoul') // 기본값 유지
})

test('레지스트리에서 사라진 키는 유령으로 남지 않는다', () => {
  const rows: SettingRow[] = [row({ scope: 'system', key: 'removed.legacy.key', value: 'x' })]
  const r = resolveSettings(rows, CTX)
  assert.equal('removed.legacy.key' in r, false)
})

test('값의 출처 스코프를 알 수 있다', () => {
  const rows: SettingRow[] = [
    row({ scope: 'workspace', scope_id: 'w1', key: 'analysis.window_days', value: 14 }),
  ]
  assert.equal(resolveOrigin(rows, CTX, 'analysis.window_days'), 'workspace')
  assert.equal(resolveOrigin(rows, CTX, 'alert.outlier.threshold'), 'default')
})

test('타입이 깨진 저장값은 기본값으로 안전하게 떨어진다', () => {
  const rows: SettingRow[] = [
    row({ scope: 'workspace', scope_id: 'w1', key: 'analysis.window_days', value: 'not-a-number' }),
  ]
  const r = resolveSettings(rows, CTX)
  assert.equal(getResolved<number>(r, 'analysis.window_days'), 28)
})

// ── 암호화 ───────────────────────────────────────────────────────

test('마스터 키가 없으면 시크릿 저장을 거부한다 (평문 폴백 없음)', () => {
  const saved = process.env.CI_SETTINGS_MASTER_KEY
  delete process.env.CI_SETTINGS_MASTER_KEY
  try {
    assert.equal(isMasterKeyAvailable(), false)
    assert.throws(() => encryptSecret('secret'), MasterKeyUnavailableError)
  } finally {
    if (saved !== undefined) process.env.CI_SETTINGS_MASTER_KEY = saved
  }
})

test('암호화 왕복이 성립한다', () => {
  process.env.CI_SETTINGS_MASTER_KEY = 'test-master-key-for-unit-test'
  const env = encryptSecret('my-platform-api-key')
  assert.equal(isSecretEnvelope(env), true)
  assert.notEqual(env.ct, 'my-platform-api-key')
  assert.equal(decryptSecret(env), 'my-platform-api-key')
  delete process.env.CI_SETTINGS_MASTER_KEY
})

test('같은 평문도 매번 다른 암호문이 된다 (IV 랜덤)', () => {
  process.env.CI_SETTINGS_MASTER_KEY = 'test-master-key-for-unit-test'
  assert.notEqual(encryptSecret('same').ct, encryptSecret('same').ct)
  delete process.env.CI_SETTINGS_MASTER_KEY
})

test('변조된 암호문은 복호에 실패한다 (GCM 인증)', () => {
  process.env.CI_SETTINGS_MASTER_KEY = 'test-master-key-for-unit-test'
  const env = encryptSecret('payload')
  const tampered = { ...env, ct: Buffer.from('tampered-bytes').toString('base64') }
  assert.throws(() => decryptSecret(tampered))
  delete process.env.CI_SETTINGS_MASTER_KEY
})

test('시크릿은 해석 결과에 평문으로 실려 나가지 않는다', () => {
  process.env.CI_SETTINGS_MASTER_KEY = 'test-master-key-for-unit-test'
  const env = encryptSecret('super-secret')
  const rows: SettingRow[] = [
    { scope: 'system', scope_id: null, key: 'llm.budget_cap_krw', value: env, is_encrypted: true, version: 1 },
  ]
  const r = resolveSettings(rows, CTX)                       // 기본: 복호 안 함
  assert.notEqual(r['llm.budget_cap_krw'], 'super-secret')
  const withSecrets = resolveSettings(rows, CTX, { decryptSecrets: true })
  assert.equal(withSecrets['llm.budget_cap_krw'], 'super-secret')
  delete process.env.CI_SETTINGS_MASTER_KEY
})

test('API 응답에서 시크릿은 마스킹된다', () => {
  assert.deepEqual(maskIfSecret({ v: 1, iv: 'a', ct: 'b', tag: 'c' }, true), MASKED_VALUE)
  assert.equal(maskIfSecret(28, false), 28)
})
