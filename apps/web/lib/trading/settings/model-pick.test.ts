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
  tabsFor, pairForModelKey, MODEL_PAIRS, NO_KEY_WHY, NO_KEY_HOW,
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

test('★ 화면을 그리는 것만으로 표를 훑지 않는다', () => {
  const field = readFileSync(join(SETTINGS_DIR, 'ModelPickField.tsx'), 'utf8')
  const at = field.indexOf('useEffect(')
  const body = field.slice(at, field.indexOf('}, [', at))
  assert.ok(body.includes('if (!open || withKey !== null) return'),
    '창을 안 열어도 목록을 읽는다 — 설정 화면을 열 때마다 표를 훑는다')
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
