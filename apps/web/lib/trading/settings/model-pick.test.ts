/**
 * 모델 고르기 — **「모델이 없습니다」로 뭉치지 않는다**
 *
 * 키가 없는 것과, 목록을 아직 안 받은 것과, 못 읽은 것은 조치가 전부 다르다.
 * 뭉치면 사람은 셋 중 아무거나 시도하고, 대개 틀린 것을 시도한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pickState, PICK_STATE_LABEL, PICK_STATE_REMEDY } from './model-pick.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', '..')
const SETTINGS_DIR = join(WEB, TRADING_APP_DIR, 'settings')

const rows = [
  { provider: 'gemini', modelId: 'gemini-3.8-flash', label: null, availability: 'ok' },
  { provider: 'gemini', modelId: 'gemini-2.5-pro', label: null, availability: 'ok' },
  { provider: 'openai', modelId: 'gpt-5-mini', label: null, availability: 'ok' },
]

test('★ 넷을 갈라 말한다 — 조치가 다르기 때문이다', () => {
  assert.deepEqual(pickState({ hasKey: true, rows, error: null, provider: 'gemini' }),
    { kind: 'ready', count: 2 })
  // 키가 없다 → 키 등록이 먼저
  assert.deepEqual(pickState({ hasKey: false, rows, error: null, provider: 'gemini' }),
    { kind: 'no_key' })
  // 키는 있는데 그 공급자 목록이 0건 → 새로고침이 먼저
  assert.deepEqual(pickState({ hasKey: true, rows, error: null, provider: 'jev' }),
    { kind: 'empty' })
  // 못 읽었다 → 빈 목록과 다른 사실이다
  assert.deepEqual(pickState({ hasKey: true, rows: null, error: '표를 못 읽음', provider: 'gemini' }),
    { kind: 'failed', reason: '표를 못 읽음' })
})

test('★ 안 읽은 것을 빈 목록으로 말하지 않는다', () => {
  assert.equal(pickState({ hasKey: true, rows: null, error: null, provider: 'gemini' }).kind, 'failed')
})

test('★ 상태마다 무엇을 하면 되는지 말한다', () => {
  for (const kind of ['no_key', 'empty', 'failed'] as const) {
    assert.ok(PICK_STATE_LABEL[kind], `${kind} 사유가 없다`)
    assert.ok(PICK_STATE_REMEDY[kind], `${kind} 에 할 일이 없다`)
  }
  // 고를 수 있으면 아무 말도 안 한다 — 늘 뜨는 안내는 배경이 된다
  assert.equal(PICK_STATE_LABEL.ready, '')
})

/* ── 화면과 창구 ───────────────────────────────────────── */

test('★ 모델 칸이 글자 입력이 아니라 고르기다', () => {
  const form = readFileSync(join(SETTINGS_DIR, 'SettingsForm.tsx'), 'utf8')
  assert.ok(form.includes('<ModelPickField'), '고르기 부품을 안 쓴다')
  // 고르기 분기가 글자 입력보다 **앞**이어야 한다. 뒤면 영영 안 닿는다
  assert.ok(form.indexOf('row.pickProvider ?') < form.indexOf("type={row.type === 'number'"),
    '글자 입력이 먼저라 고르기에 안 닿는다')

  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  assert.ok(page.includes("spec.key === 'jev_model' ? { pickProvider: judgeProvider }"),
    '모델 칸에 공급자를 안 넘긴다')
})

/**
 * **예약된 판을 본다.**
 * 오늘 값으로 목록을 뽑으면 공급자를 바꿔 둔 날 엉뚱한 목록에서 고르게 된다.
 */
test('★ 공급자를 바꿔 뒀으면 그 공급자의 모델을 보여 준다', () => {
  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  const at = page.indexOf('const judgeProvider')
  assert.ok(at > 0, '공급자를 안 정한다')
  const body = page.slice(at, page.indexOf('\n\n', at))
  assert.ok(body.includes("editingValue(pending.get('jev_provider'))"), '예약된 판을 안 본다')
  assert.ok(body.includes('values.jev_provider'), '예약이 없을 때 오늘 값을 안 본다')
})

/**
 * **소유자 문을 지난다** (S2).
 *
 * AI 화면의 목록 창구는 관리자 전용이다. 그것을 그대로 부르면
 * 「화면은 열리는데 창구가 403」이 된다.
 */
test('★ 목록 창구가 소유자 확인을 먼저 지난다 (S2)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function listJudgeModels')
  assert.ok(at > 0, '목록 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')
  assert.ok(body.indexOf('tradingAccess()') < body.indexOf('createAdminClient('),
    '확인보다 먼저 표를 연다')

  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.equal(/listModelCatalog|app\/\(ai\)/.test(field), false,
    '화면이 관리자 전용 창구를 부른다 — 화면은 열리는데 창구가 막힌다')
})

test('★ 키 원문이 목록 응답에 안 실린다 (S3)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function listJudgeModels')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  // 있음·없음만 옮긴다. 값은 이 함수 밖으로 안 나간다
  assert.ok(body.includes('if (choice.apiKey) withKey.push(id)'), '키가 있는지를 안 본다')
  assert.equal(/apiKey:\s|apiKey\s*\}/.test(body), false, '키 값을 응답에 담는다')
})

test('★ 화면을 그리는 것만으로 표를 훑지 않는다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  const at = field.indexOf('useEffect(')
  const body = field.slice(at, field.indexOf('}, [', at))
  assert.ok(body.includes('if (!open || rows !== null) return'),
    '창을 안 열어도 목록을 읽는다 — 설정 화면을 열 때마다 표를 훑는다')
})
