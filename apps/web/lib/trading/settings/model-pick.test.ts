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
import {
  tabsFor, pairForModelKey, pickTroubles, MODEL_PAIRS, NO_KEY_WHY, NO_KEY_HOW,
} from './model-pick.ts'
import { TRADING_SETTINGS } from './registry.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..', '..')
const SETTINGS_DIR = join(WEB, TRADING_APP_DIR, 'settings')

/**
 * **가려 말하는 일은 공용 모달이 한다.**
 *
 * 목록이 비었는지·못 읽었는지·막힌 모델이 몇 개인지는 연동 카드가 쓰는 것과 같은
 * 부품이 말한다. 여기 남는 사실은 그 부품이 모르는 것 하나 — 고를 공급자가 아예 없다.
 */
test('★ 고를 공급자가 없으면 왜와 무엇을 하면 되는지를 같이 말한다', () => {
  assert.ok(NO_KEY_WHY.length > 0, '왜 못 고르는지를 안 말한다')
  assert.ok(NO_KEY_HOW.length > 0, '무엇을 하면 되는지를 안 말한다')
  assert.notEqual(NO_KEY_WHY, NO_KEY_HOW, '사유와 할 일이 같은 말이다')
  // 할 일은 **갈 곳**을 짚어야 한다. 「등록해 주세요」만으로는 어디인지 모른다
  assert.ok(/설정|공급자/.test(NO_KEY_HOW), '어디로 가야 하는지 안 적혀 있다')
})

/* ── 화면과 창구 ───────────────────────────────────────── */

test('★ 모델 칸이 글자 입력이 아니라 고르기다', () => {
  const form = readFileSync(join(SETTINGS_DIR, 'SettingsForm.tsx'), 'utf8')
  assert.ok(form.includes('<ModelPickField'), '고르기 부품을 안 쓴다')
  // 고르기 분기가 글자 입력보다 **앞**이어야 한다. 뒤면 영영 안 닿는다
  assert.ok(form.indexOf('row.pickProvider ?') < form.indexOf("type={row.type === 'number'"),
    '글자 입력이 먼저라 고르기에 안 닿는다')

  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  // 쌍을 아는 함수가 정하고, 화면은 그 결과만 넘긴다 — 키를 화면이 또 적으면 갈린다
  assert.ok(page.includes('pairForModelKey(spec.key)'), '모델 칸에 공급자를 안 넘긴다')
  assert.ok(page.includes('pickProvider: {'), '짝을 안 넘긴다')
})

/**
 * **예약된 판을 본다.**
 * 오늘 값으로 목록을 뽑으면 공급자를 바꿔 둔 날 엉뚱한 목록에서 고르게 된다.
 */
test('★ 공급자를 바꿔 뒀으면 그 공급자의 모델을 보여 준다', () => {
  const page = readFileSync(join(SETTINGS_DIR, 'page.tsx'), 'utf8')
  const at = page.indexOf('const providerValue')
  assert.ok(at > 0, '공급자를 안 정한다')
  const body = page.slice(at, page.indexOf('\n\n', at))
  assert.ok(body.includes('editingValue(pending.get(key))'), '예약된 판을 안 본다')
  assert.ok(body.includes('values[key]'), '예약이 없을 때 오늘 값을 안 본다')
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

/**
 * **여기는 앞 판의 결정을 뒤집은 자리다.**
 *
 * 앞 판은 「창을 열 때만 묻는다」로 잠갔다. 표를 덜 훑자는 뜻이었고 그 자체는 맞다.
 * 그런데 그 결과 「jev · gemini-3.6-flash」처럼 **채워져 있는데 안 도는** 상태가
 * 창을 안 열면 영영 안 보였다(실측 2026-09-28: 판단 0건·신호 0건인데 화면은 멀쩡했다).
 * 고장을 보려고 창을 열어야 한다면 그 화면은 고장을 숨기고 있는 것이다.
 *
 * 그래서 묻기는 하되 **한 번만** 묻는다 — 고르는 자리가 둘이라 마운트에서 같은 물음이
 * 두 번 나가던 것을 진행 중인 하나로 합친다.
 */
test('★ 창을 안 열어도 묻되, 같은 물음이 두 번 안 나간다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  const at = field.indexOf('useEffect(')
  const body = field.slice(at, field.indexOf('}, [', at))
  assert.equal(/\bopen\b/.test(body), false,
    '창을 열어야만 묻는다 — 안 열면 막힌 것이 안 보인다')
  assert.ok(body.includes('if (withKey !== null) return'), '한 번 읽고도 또 읽는다')
  assert.ok(field.includes('askOnce()'), '자리마다 따로 물어 같은 물음이 두 번 나간다')
  assert.ok(field.includes('inflight = null'), '진행 중인 물음을 안 비워 값이 굳는다')
})

/* ── 채워져 있는데 안 도는 것을 말한다 ────────────────── */

const CATALOG = [
  { provider: 'gemini', modelId: 'gemini-3.6-flash' },
  { provider: 'gemini', modelId: 'gemini-3.6-pro' },
  { provider: 'openai', modelId: 'gpt-5' },
  { provider: 'jev', modelId: 'jev-small' },
]

test('★ 고른 공급자에 키가 없으면 그 사실과 키가 있는 공급자를 함께 말한다', () => {
  const [t, ...rest] = pickTroubles({
    provider: 'jev', model: 'jev-small',
    withKey: ['gemini', 'groq', 'openai'], catalog: CATALOG,
  })
  assert.deepEqual(rest, [], '한 가지만 막혔는데 여러 줄을 말한다')
  assert.equal(t.kind, 'provider_has_no_key')
  assert.match(t.why, /키가 없어 판단을 못 부릅니다/)
  assert.match(t.why, /jev/, '어느 공급자인지를 안 말한다')
  // 갈 곳을 짚는다 — 「키가 없습니다」만으로는 무엇을 고를지 모른다
  for (const id of ['gemini', 'groq', 'openai']) assert.match(t.how, new RegExp(id))
})

/**
 * **키가 없는 것과 이 판에서 안 쓰는 것은 다른 일이다** (실측 2026-09-28)
 *
 * Jev 키(`vck_…`)가 등록돼 있는데 화면은 「키가 없어 판단을 못 부릅니다」를 말했다.
 * 둘을 같은 말로 뭉치면 **이미 키를 넣은 사람이 키를 또 넣는다.**
 */
test('★ 키는 있는데 이 판에서 안 쓰는 것을 「키가 없다」로 말하지 않는다', () => {
  const troubles = pickTroubles({
    provider: 'jev', model: 'jev-small',
    withKey: ['gemini'], catalog: CATALOG,
    keyState: { jev: 'env_blocked', gemini: 'pool' },
    envBlockedText: '이 판에 쓸 키를 따로 등록해 주세요',
  })
  assert.equal(troubles[0].kind, 'provider_key_not_for_this_env')
  assert.equal(/키가 없/.test(troubles[0].why), false, `이미 넣은 키를 또 넣으라고 한다: ${troubles[0].why}`)
  assert.match(troubles[0].how, /따로 등록/)

  // 진짜로 없는 것은 그대로 「키가 없다」다
  const missing = pickTroubles({
    provider: 'jev', model: 'jev-small',
    withKey: ['gemini'], catalog: CATALOG,
    keyState: { jev: 'no_key', gemini: 'pool' },
  })
  assert.equal(missing[0].kind, 'provider_has_no_key')
  assert.match(missing[0].why, /키가 없어/)
})

test('★ 사유를 안 주면 예전처럼 둘로만 본다 — 안 주는 자리가 깨지지 않는다', () => {
  const troubles = pickTroubles({ provider: 'jev', model: 'jev-small', withKey: ['gemini'], catalog: CATALOG })
  assert.equal(troubles[0].kind, 'provider_has_no_key')
})

test('★ 창구가 공급자별 사유를 내려 주고 화면이 그것을 쓴다', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function listJudgeModels')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('keyState[id] = choice.reason'), '사유를 안 옮긴다')
  // 키 값은 여전히 안 싣는다
  assert.equal(/apiKey:\s|apiKey\s*\}/.test(body), false, '키 값을 응답에 담는다')

  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes('keyState'), '화면이 사유를 안 읽는다')
  assert.ok(body.includes('envBlockedMessage: ENV_BLOCKED_MESSAGE'), '이 판 문장을 안 실어 보낸다')
  assert.ok(field.includes('envBlockedText'), '화면이 그 문장을 안 쓴다')
  /**
   * 화면이 이 모듈을 **값으로** 들여오면 그 안의 동적 import 가 server-only 를 끌고 와
   * 설정 화면이 통째로 500 이 된다 (실측 2026-09-28). 형만 들여온다.
   */
  assert.equal(/^import \{[^}]*\} from '@\/lib\/ai\/provider-key-source'/m.test(field), false,
    '화면이 키 고르는 모듈을 값으로 들여온다 — 빌드가 server-only 로 죽는다')
})

test('★ 고를 수 있는 탭에는 실제로 부를 수 있는 공급자만 선다', () => {
  // withKey 는 apiKey 가 실제로 나온 공급자만 담는다 — env_blocked 는 안 담긴다
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function listJudgeModels')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('if (choice.apiKey) withKey.push(id)'), '부를 수 없는 공급자도 탭에 세운다')
  assert.deepEqual(tabsFor(['gemini', 'jev'], ['gemini']), ['gemini'])
})

test('★ 공급자와 모델이 어긋나 있으면 그 사실을 말한다 (실측 jev · gemini-*)', () => {
  const troubles = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash',
    withKey: ['jev', 'gemini'], catalog: CATALOG,
  })
  assert.equal(troubles.length, 1)
  assert.equal(troubles[0].kind, 'model_elsewhere')
  assert.match(troubles[0].why, /gemini-3\.6-flash 모델이 없습니다/)
  assert.match(troubles[0].how, /gemini/, '어느 공급자 것인지를 안 짚는다')
  // 조사를 변수 뒤에 붙이지 않는다 — 영문 이름 뒤의 「이/가」는 반반씩 틀린다
  for (const t of troubles) {
    assert.equal(/[a-z0-9]\s?(이|가|을|를|은|는)\s/.test(`${t.why} ${t.how}`), false,
      `영문 뒤에 조사를 붙였다: ${t.why} · ${t.how}`)
  }
})

test('★ 키도 없고 모델도 어긋나면 둘 다 말한다 — 하나를 고쳐도 안 도는 일을 막는다', () => {
  const troubles = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash',
    withKey: ['gemini', 'openai'], catalog: CATALOG,
  })
  assert.deepEqual(troubles.map((t) => t.kind), ['provider_has_no_key', 'model_elsewhere'])
})

test('★ 어디에도 없는 이름은 「목록에 없다」로 말한다', () => {
  const troubles = pickTroubles({
    provider: 'gemini', model: 'gemini-9-turbo',
    withKey: ['gemini'], catalog: CATALOG,
  })
  assert.equal(troubles[0].kind, 'model_unknown')
  assert.match(troubles[0].why, /gemini-9-turbo/, '어느 이름이 없는지를 안 말한다')
  assert.equal(/[a-z0-9]\s?(이|가)\s/.test(troubles[0].why), false, '영문 뒤에 조사를 붙였다')
})

test('★ 키가 아무 데도 없으면 그 하나만 말한다', () => {
  const troubles = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash', withKey: [], catalog: CATALOG,
  })
  assert.deepEqual(troubles, [{ kind: 'no_provider_at_all', why: NO_KEY_WHY, how: NO_KEY_HOW }])
})

test('★ 아직 안 골랐으면 모델 판정을 안 한다 — 모르는 것은 지어내지 않는다', () => {
  assert.deepEqual(pickTroubles({ provider: 'gemini', model: '', withKey: ['gemini'], catalog: CATALOG }), [])
})

/**
 * **고를 것이 없는데 고르라고 하지 않는다** (사용자 지적 2026-09-28
 * 「jev는 안에 상세모델이 원래 없는거면 어떻게 저장해야 하는거야」).
 *
 * 실측 2026-09-28 `ai_model_catalog` 의 jev 모델이 0개인데 화면은
 * 「공급자를 바꾸거나 다른 모델을 고르세요」라고 말했다. 창을 열어도 빈 목록이었다.
 */
test('★ 그 공급자의 모델이 0개면 「목록을 아직 안 받았습니다」라고 말한다', () => {
  const t = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash',
    withKey: ['jev'], catalog: [{ provider: 'gemini', modelId: 'gemini-3.6-flash' }],
  })
  assert.equal(t.length, 1, '고를 것이 없는데 여러 가지를 말한다')
  assert.equal(t[0].kind, 'catalog_empty')
  assert.equal(/다른 모델을 고르세요/.test(t[0].how), false, '고를 것이 없는데 고르라고 한다')
  assert.match(t[0].how, /목록 받기/, '받는 길을 안 알려 준다')
})

test('★ 관문이면 이름 꼴을 함께 말한다 — 짐작이 아니라 사실이다', () => {
  const empty = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash', withKey: ['jev'], catalog: [],
    slashModelIds: true,
  })
  assert.match(empty[0].how, /벤더\/모델/, '관문 이름 꼴을 안 말한다')

  // 목록은 있는데 이름이 안 맞을 때도 그 사실이 이유다
  const wrong = pickTroubles({
    provider: 'jev', model: 'gemini-3.6-flash', withKey: ['jev'],
    catalog: [{ provider: 'jev', modelId: 'google/gemini-2.5-flash' }],
    slashModelIds: true,
  })
  assert.equal(wrong[0].kind, 'model_unknown')
  assert.match(wrong[0].how, /google\/gemini-2\.5-flash/, '예시를 안 준다')

  // 관문이 아니면 그 말을 안 붙인다 — 아무 데나 붙이면 말이 값을 잃는다
  const plain = pickTroubles({
    provider: 'gemini', model: 'nope', withKey: ['gemini'],
    catalog: [{ provider: 'gemini', modelId: 'gemini-2.5-flash' }],
  })
  assert.equal(/벤더\/모델/.test(plain[0].how), false, '관문이 아닌데 관문 말을 한다')
})

test('★ 목록이 0개인 것과 이름이 안 맞는 것을 갈라 말한다 — 조치가 다르다', () => {
  const empty = pickTroubles({ provider: 'jev', model: 'x', withKey: ['jev'], catalog: [] })
  const wrong = pickTroubles({
    provider: 'jev', model: 'x', withKey: ['jev'],
    catalog: [{ provider: 'jev', modelId: 'google/gemini-2.5-flash' }],
  })
  assert.notEqual(empty[0].kind, wrong[0].kind)
})

test('★ 화면이 고칠 수 있는 길을 함께 준다 — 말만 하고 끝내지 않는다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes('refreshJudgeModels('), '목록 받는 창구를 안 부른다')
  assert.ok(field.includes('MODEL_LIST_FETCH'), '단추 글자를 화면에서 짓는다')
  assert.ok(field.includes('MODEL_LIST_FETCHING'), '기다리는 동안 무엇을 하는지 안 말한다 (B-7)')
  // 받은 뒤 그 자리에서 다시 읽는다 — 창을 닫았다 열게 하지 않는다
  assert.match(field, /if \(r\.ok\) \{ setWithKey\(null\); await load\(\) \}/, '받고도 화면이 안 바뀐다')
  // 고칠 것이 있을 때만 단추가 뜬다
  assert.match(field, /troubles\.some\(\(t\) => t\.kind === 'catalog_empty' \|\| t\.kind === 'model_unknown'\)/,
    '늘 떠 있는 단추가 된다')
})

test('★ 제대로 고른 자리는 아무 말도 안 한다 — 늘 뜨는 경고는 안 읽힌다', () => {
  assert.deepEqual(pickTroubles({
    provider: 'gemini', model: 'gemini-3.6-flash', withKey: ['gemini', 'openai'], catalog: CATALOG,
  }), [])
})

test('★ 공급자 이름을 이 모듈이 정하지 않는다 — 표는 한 곳에만 둔다', () => {
  const troubles = pickTroubles({
    provider: 'jev', model: 'jev-small', withKey: ['gemini'], catalog: CATALOG,
    providerName: (id) => (id === 'jev' ? '우리 관문' : id.toUpperCase()),
  })
  assert.match(troubles[0].why, /우리 관문/)
  assert.match(troubles[0].how, /GEMINI/)

  const src = readFileSync(join(HERE, 'model-pick.ts'), 'utf8')
  assert.equal(/PROVIDER_LABELS|import /.test(src), false,
    '순수 모듈이 표를 들여온다 — 이름이 두 곳에서 갈린다')
})

test('★ 화면이 이 판정을 실제로 그린다 — 창을 여닫는 것과 무관하게', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes('pickTroubles({'), '판정을 안 부른다')
  assert.ok(field.includes('troubles.map('), '판정을 부르고 안 그린다')
  // 그리는 자리가 `open &&` 안에 있으면 창을 열어야만 보인다
  const at = field.indexOf('troubles.map(')
  const before = field.slice(Math.max(0, at - 200), at)
  assert.equal(/\{open &&/.test(before), false, '열어야만 보이는 자리에 그린다')
})

test('★ 키 값이 들어올 자리가 애초에 없다 (S3)', () => {
  const src = readFileSync(join(HERE, 'model-pick.ts'), 'utf8')
  const at = src.indexOf('export interface ModelPickState')
  const body = src.slice(at, src.indexOf('\n}', at))
  assert.equal(/apiKey|secret|token/i.test(body), false, '입력 꼴에 비밀 자리가 있다')
  assert.ok(body.includes('withKey: readonly string[]'), '있음·없음만 받는 자리가 없다')
})

/**
 * **공급자와 모델은 한 벌이다** (사용자 지적 2026-09-27)
 *
 * 모델만 바꾸고 공급자가 그대로면 그 공급자에 없는 모델을 가리키게 된다.
 * 화면에는 이름이 멀쩡히 적혀 있는데 그 자리는 한 건도 안 돈다.
 */
test('★ 모델 칸마다 짝이 되는 공급자 칸이 있다', () => {
  assert.ok(MODEL_PAIRS.length >= 2, '쌍이 모자란다')
  for (const pair of MODEL_PAIRS) {
    assert.ok(TRADING_SETTINGS.some((s) => s.key === pair.providerKey), `${pair.providerKey} 설정이 없다`)
    assert.ok(TRADING_SETTINGS.some((s) => s.key === pair.modelKey), `${pair.modelKey} 설정이 없다`)
    assert.deepEqual(pairForModelKey(pair.modelKey), pair)
  }
  assert.equal(pairForModelKey('atr_period'), null, '아무 칸이나 고르기가 된다')
})

/**
 * **이름에 벤더를 안 박는다.**
 * 등록된 키가 넷인데 이름부터 한 벌에 묶여 있으면 나머지 키는 있으나 마나다.
 */
test('★ 설정 이름에 벤더가 박힌 자리가 0개다', () => {
  const offenders = TRADING_SETTINGS
    .filter((s) => /gemini|claude|openai|grok|groq/i.test(s.label))
    .map((s) => `${s.key}: ${s.label}`)
  assert.deepEqual(offenders, [], `이름에 벤더가 박혀 있다:\n  ${offenders.join('\n  ')}`)
})

test('★ 탭에는 키가 등록된 공급자만 선다 — 없는 키를 고르면 영영 안 돈다', () => {
  assert.deepEqual(tabsFor(['gemini', 'openai', 'jev'], ['gemini', 'jev']), ['gemini', 'jev'])
  assert.deepEqual(tabsFor(['gemini', 'openai'], []), [])
})

test('★ 저장이 둘을 함께 한다 — 한쪽만 바뀌는 길이 없다', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function savePickedModel')
  assert.ok(at > 0, '함께 저장하는 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes('saveTradingSettingValue(providerKey, provider)'), '공급자를 안 저장한다')
  assert.ok(body.includes('saveTradingSettingValue(modelKey, model)'), '모델을 안 저장한다')
  // 등재된 쌍이 아니면 아무것도 안 한다 — 밖에서 온 키다
  assert.ok(body.includes('MODEL_PAIRS.find('), '아무 키나 저장한다')
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')

  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes('savePickedModel('), '화면이 함께 저장하는 창구를 안 부른다')
})

test('★ 지식·설명도 고른 공급자로 간다 — 한 벤더에 안 묶인다', () => {
  const tick = readFileSync(join(HERE, '..', 'jobs', 'tick.ts'), 'utf8')
  assert.ok(tick.includes("str('knowledge_model', '')"), '지식이 옛 키를 읽는다')
  assert.ok(tick.includes("str('knowledge_provider', 'gemini')"), '지식이 공급자를 안 읽는다')
  assert.equal(/str\('gemini_model'/.test(tick), false, '벤더가 박힌 키가 남아 있다')

  const call = readFileSync(join(HERE, '..', 'knowledge', 'ai-call.ts'), 'utf8')
  assert.ok(call.includes('input.provider ?? '), '지식 호출이 공급자를 안 받는다')
  assert.ok(call.includes('callCompatibleText('), '다른 공급자로 갈 길이 없다')
})

/**
 * **모달을 자작하지 않는다** (§2-5 동종 UI 통일)
 *
 * 사용자 지적 2026-09-27 「디자인 미쳤어?」, 2026-09-28 「디자인이 안되어 있다니깐
 * 모달이랑 버튼 배치랑 글자 크기도 저기만 유독 이상하네」.
 *
 * 앞 판에서 이 자리를 「머리·본문·바닥이 있나」로 잠갔는데, 그것은 **자작한 창을
 * 굳히는 가드**였다. 골격을 세는 대신 공용 부품을 쓰는지를 본다.
 */
test('★ 모델 고르기가 앱의 공용 모달을 쓴다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes("from '@/components/ui/ModelPickerModal'"),
    '공용 모달을 안 쓴다 — 연동 카드와 다른 창이 된다')
  assert.ok(field.includes('<ModelPickerModal'), '부품을 들여만 놓고 안 그린다')

  // 자작 창의 자취가 남아 있으면 둘 중 하나가 죽은 코드다
  const css = readFileSync(join(SETTINGS_DIR, 'ModelPickField.module.css'), 'utf8')
  for (const part of ['.backdrop', '.panel', '.head', '.foot', '.tabs', '.list']) {
    assert.equal(css.includes(part), false, `${part} 가 남아 있다 — 자작 창의 자취다`)
  }
  assert.equal(/position:\s*fixed|z-index/.test(css), false, '화면이 창을 직접 세운다')
})

/**
 * **관문은 부르는 쪽이 들고 있다.**
 *
 * 부품이 관리자 서버 액션을 직접 부르면 소유자가 관리자가 아닌 날 모달이 통째로
 * 「관리자 권한이 필요합니다」가 된다. 두 화면의 문이 서로 다르기 때문이다.
 */
test('★ 공용 모달이 자기 관문을 안 들고 다닌다', () => {
  const here = join(WEB, 'components', 'ui', 'ModelPickerModal.tsx')
  const modal = readFileSync(here, 'utf8')
  assert.equal(/from '@\/app\/\(ai\)/.test(modal), false,
    '부품이 관리자 전용 창구를 직접 부른다')
  assert.ok(modal.includes('load: () =>'), '목록 읽기를 인자로 안 받는다')
  assert.ok(modal.includes('refresh?:'), '새로고침이 필수라 읽기 전용 화면이 못 쓴다')
  // 못 하는 일이면 단추를 안 그린다
  assert.ok(modal.includes('{refresh && ('), '새로고침을 못 해도 단추를 그린다')

  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.ok(field.includes('load={load}'), '목록 읽기를 안 넘긴다')
  assert.equal(/refresh=\{/.test(field), false,
    '읽기만 하는 화면이 새로고침을 넘긴다 — 누르면 관리자 문에서 막힌다')
})

test('★ 화면이 꼴을 인라인으로 안 짓는다 — 토큰과 모듈로 간다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  assert.equal(/style=\{\{/.test(field), false, '인라인 style 이 남아 있다')
  assert.equal(/rgba\(|#[0-9a-fA-F]{6}/.test(field), false, '색을 화면에서 짓는다')
})

test('★ 화면 문구가 라벨 표에서 온다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  /**
   * 주석은 뺀다. **주석 속 한글은 위반이 아니다** — 오히려 다음 사람에게 필요한 것이고,
   * 주석을 위반으로 세면 설명을 안 쓰게 된다.
   *
   * 한 줄 안에서만 찾는다. 줄을 넘겨 찾으면 주석 블록 두 개 사이가 통째로 잡힌다.
   */
  const code = field
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
  const hangul = code.flatMap((l) => l.match(/'[^'\n]*[가-힣][^'\n]*'/g) ?? [])
  assert.deepEqual(hangul, [], `화면에 한글을 직접 적었다: ${hangul.join(', ')}`)
})

/* ── 같은 말이 두 뜻으로 쓰이지 않는다 ────────────────── */

import { JUDGE_LABEL } from '../judgment-labels.ts'
import { JEV_OFF_TITLE, JEV_OFF_REASON_LABEL, JEV_OFF_REMEDY_LABEL } from '../jev-labels.ts'
import { tradingSetting } from './registry.ts'

/**
 * **사용자 질문 2026-09-28** 「jev에도 모델명이 있다고? 나는 잘 모르는 이야긴데
 * 그냥 jev 자체 아닌가?」
 *
 * 이 저장소에서 Jev 는 **AI 판단기의 이름**인데 공급자 목록에도 같은 낱말이 있다
 * (Vercel 관문). 화면에 그 낱말만 찍으면 읽는 사람은 그것이 모델 이름인지 회사 이름인지
 * 판단기 이름인지 알 수 없다 — 물어봐야 아는 화면은 안 만든 화면과 같다.
 */
test('★ 판단기 이름은 무엇을 하는 것인지로 부른다', () => {
  assert.equal(JUDGE_LABEL.jev, 'AI 판단', '판단기 자리에 설명 없는 낱말이 남아 있다')
  assert.equal(JUDGE_LABEL.rule, '규칙 판단')
  // 판단기 이름과 공급자 이름이 화면에서 같은 낱말이면 안 된다
  assert.equal(/^Jev$/.test(JUDGE_LABEL.jev), false)
})

test('★ 꺼져 있다는 말도 판단기 쪽 말로 한다', () => {
  assert.match(JEV_OFF_TITLE, /AI 판단/)
  for (const v of Object.values(JEV_OFF_REASON_LABEL)) {
    assert.equal(/Jev/.test(v), false, `설명 없는 낱말이 남아 있다: ${v}`)
  }
  for (const v of Object.values(JEV_OFF_REMEDY_LABEL)) {
    assert.equal(/Jev/.test(v), false, `할 일에 설명 없는 낱말이 남아 있다: ${v}`)
  }
  // 할 일은 **갈 곳**을 짚는다
  assert.match(JEV_OFF_REMEDY_LABEL.model_missing, /AI 판단에 쓸 모델/)
})

test('★ 설정 이름과 설명이 무엇을 정하는 값인지 말한다', () => {
  const provider = tradingSetting('jev_provider')
  const model = tradingSetting('jev_model')
  assert.ok(provider && model)
  // 이름에 설명 없는 낱말을 안 쓴다
  assert.equal(/Jev/.test(provider!.label), false, `설정 이름에 설명 없는 낱말: ${provider!.label}`)
  assert.equal(/Jev/.test(model!.label), false, `설정 이름에 설명 없는 낱말: ${model!.label}`)
  // 설명은 그 낱말이 무엇인지 한 번은 말해 준다 — 안 쓰는 것과 설명 없이 쓰는 것은 다르다
  assert.match(provider!.help, /관문/, '관문이라는 사실을 안 말한다')
  // 관문 모델 이름 꼴을 알려 준다 — 그것을 몰라서 403 이 났다
  assert.match(model!.help, /google\/gemini/, '이름 꼴 예시가 없다')
})
