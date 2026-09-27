/**
 * 세 문항으로 시작하기 — **규정을 안 비켜 가는가** (§12 · §15.3 · M6 · M7)
 *
 * 처음 여는 사람을 위한 자리라 값이 한 번에 여럿 바뀐다. 그래서 값이 맞는지보다
 * **무엇이 바뀌는지가 보이는가**와 **못 바꾸는 것을 안 바꾸는가**를 먼저 센다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fillFrom, riskView, raisesLossLimit, STANCES, type Answers } from './onboarding.ts'
import { TRADING_SETTINGS } from './registry.ts'
import { AI_FORBIDDEN_KEYS } from '../knowledge/proposal-policy.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SETTINGS_DIR = join(HERE, '..', '..', '..', TRADING_APP_DIR, 'settings')
const ANSWER: Answers = { stance: 'normal', targetKrw: 300000, lossLimitKrw: 500000 }

test('★ 채우는 키가 전부 레지스트리에 있다 — 지어낸 키가 저장 창구까지 안 간다', () => {
  for (const stance of STANCES) {
    for (const f of fillFrom({ ...ANSWER, stance })) {
      assert.ok(TRADING_SETTINGS.some((s) => s.key === f.key), `${f.key} 가 등재돼 있지 않다`)
    }
  }
})

test('★ 채우는 값이 전부 그 설정의 범위 안이다', () => {
  for (const stance of STANCES) {
    for (const f of fillFrom({ ...ANSWER, stance })) {
      const spec = TRADING_SETTINGS.find((s) => s.key === f.key)
      assert.ok(spec)
      if (typeof f.value !== 'number') continue
      if (spec.min !== undefined) assert.ok(f.value >= spec.min, `${f.key} 가 최솟값 아래다: ${f.value}`)
      if (spec.max !== undefined) assert.ok(f.value <= spec.max, `${f.key} 가 최댓값 위다: ${f.value}`)
    }
  }
})

test('★ 정수로 쓰던 값은 정수로 남는다', () => {
  for (const stance of STANCES) {
    for (const f of fillFrom({ ...ANSWER, stance })) {
      const spec = TRADING_SETTINGS.find((s) => s.key === f.key)
      if (typeof spec?.defaultValue !== 'number' || !Number.isInteger(spec.defaultValue)) continue
      assert.ok(Number.isInteger(f.value), `${f.key} 가 ${f.value} 다`)
    }
  }
})

/**
 * **금지 목록은 막는 것이 아니라 사람이 답해야 한다는 표시다** (§15.3).
 *
 * 명세가 금지한 것은 AI 가 바꾸는 경우다. 이 자리는 사람이 직접 답하므로 허용이고,
 * 대신 그 사실이 줄마다 남아야 한다. 둘을 코드가 갈라 알아야 한다.
 */
test('★ AI 가 못 바꾸는 값에는 사람이 답했다는 표가 붙는다 (§15.3)', () => {
  const filled = fillFrom(ANSWER)
  const limit = filled.find((f) => f.key === 'daily_loss_limit_krw')
  assert.ok(limit, '손실 한도를 안 채운다')
  assert.ok(AI_FORBIDDEN_KEYS.includes('daily_loss_limit_krw'), '금지 목록이 바뀌었다')
  assert.equal(limit.needsPerson, true, '금지 키인데 표가 안 붙었다')

  const free = filled.find((f) => f.key === 'signal_max_per_day')
  assert.ok(free)
  assert.equal(free.needsPerson, false, '안 막힌 키에 표가 붙었다')
})

test('★ 답이 정하는 것만 채운다 — 고쳐 둔 값이 조용히 사라지지 않게', () => {
  const keys = fillFrom(ANSWER).map((f) => f.key)
  assert.ok(keys.length <= 8, `한 번에 ${keys.length}개를 바꾼다`)
  for (const key of keys) {
    assert.ok(
      key.startsWith('daily_') || key.startsWith('signal_'),
      `${key} 는 세 문항과 상관이 없다`,
    )
  }
})

test('성향이 값을 한 걸음 움직인다 — 보통은 기본값 그대로', () => {
  const normal = fillFrom({ ...ANSWER, stance: 'normal' })
  for (const f of normal) {
    if (f.key.startsWith('daily_')) continue
    const spec = TRADING_SETTINGS.find((s) => s.key === f.key)
    assert.equal(f.value, spec?.defaultValue, `${f.key} 가 기본값이 아니다`)
  }
  const careful = fillFrom({ ...ANSWER, stance: 'careful' })
  const bold = fillFrom({ ...ANSWER, stance: 'bold' })
  const of = (list: typeof normal, key: string) => list.find((f) => f.key === key)?.value
  // 조심스럽게는 신호를 적게, 적극적으로는 많게
  assert.ok(Number(of(careful, 'signal_max_per_day')) < Number(of(bold, 'signal_max_per_day')),
    '성향이 신호 수를 안 바꾼다')
  // 조심스럽게는 기대 수익 문턱을 높게
  assert.ok(Number(of(careful, 'signal_min_net_ev_r')) > Number(of(bold, 'signal_min_net_ev_r')),
    '성향이 문턱을 거꾸로 움직인다')
})

test('★ 한 번의 위험을 돈으로 말한다 (M6)', () => {
  const ok = riskView(100000, 500000)
  assert.equal(ok.fits, true)
  assert.equal(ok.times, 5)
  // 한도가 한 번의 위험보다 작으면 어떤 신호도 못 나간다
  const bad = riskView(600000, 500000)
  assert.equal(bad.fits, false)
  assert.equal(bad.times, 0)
  // 못 쟀으면 맞다고 하지 않는다
  assert.equal(riskView(0, 500000).fits, false)
})

test('★ 손실 한도를 올리는 답을 알아본다', () => {
  assert.equal(raisesLossLimit(700000, 500000), true)
  assert.equal(raisesLossLimit(300000, 500000), false)
  assert.equal(raisesLossLimit(700000, '알 수 없음'), false)
})

/* ── 창구와 화면 ───────────────────────────────────────── */

test('★ 미리보기 창구에는 저장하는 길이 없다', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function previewStart')
  assert.ok(at > 0, '미리보기 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.equal(/saveTradingSetting/.test(body), false, '묻기만 해야 하는 창구가 저장한다')
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')
})

test('★ 저장이 화면이 보낸 값이 아니라 답에서 다시 계산한 값을 쓴다', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function applyStart')
  assert.ok(at > 0, '저장 창구가 없다')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  /**
   * **여기는 앞 판의 문장을 고친 자리다.**
   *
   * 앞 판은 `fillFrom(answers)` 글자를 찾아 「화면이 보낸 값을 안 쓴다」를 지켰다.
   * 지금은 미리보기 표를 고칠 수 있어야 하므로(사용자 지적 2026-09-28 「이대로
   * 채우기는 있는데 수정은 못하네? 이상하다 CRUD는 기본인건데」) 손댄 값이 들어온다.
   *
   * 지켜야 하는 것은 글자가 아니라 **화면이 만든 줄을 그대로 저장하지 않는 것**이다.
   * 손댄 값도 `fillFrom` 을 다시 지나며 답이 만든 키에만 얹히고 등록부 규칙으로 걸러진다.
   */
  assert.ok(body.includes('fillFrom(answers, overrides)'), '손댄 값을 다시 안 만든다')
  const signature = actions.slice(at, actions.indexOf('{', actions.indexOf(')', at)))
  assert.equal(/FilledValue/.test(signature), false,
    '화면이 만든 줄을 통째로 받는다 — 그러면 아무 키나 저장된다')
  assert.ok(body.includes('saveTradingSettingValue('), '기존 창구를 안 지난다')
  assert.ok(body.includes('tradingAccess()'), '소유자 확인을 안 한다')
  assert.ok(body.indexOf('tradingAccess()') < body.indexOf('fillFrom('), '확인보다 먼저 일한다')
})

/* ── 채우기 전에 고칠 수 있다 ─────────────────────────── */

test('★ 손댄 값은 답이 만든 키에만 얹힌다 — 여기가 설정 전체를 여는 문이 되지 않는다', () => {
  const base = fillFrom(ANSWER)
  const withEdit = fillFrom(ANSWER, {
    daily_target_krw: 777000,
    // 답이 안 만드는 키. 등록부에 있는 진짜 키라도 이 자리로는 못 들어간다
    owner_user_id: 'someone-else',
    // 아예 없는 키
    made_up_key: 1,
  })
  assert.deepEqual(
    withEdit.map((f) => f.key), base.map((f) => f.key),
    '답이 안 만든 키가 표에 끼어들었다',
  )
  assert.equal(withEdit.find((f) => f.key === 'daily_target_krw')?.value, 777000)
})

test('★ 범위 밖 값은 계산된 값으로 돌아간다 — 저장 못 할 값을 「이렇게 채웁니다」로 안 보여 준다', () => {
  const spec = TRADING_SETTINGS.find((s) => s.key === 'signal_max_per_day')
  assert.ok(spec?.max !== undefined, '이 시험이 기대는 상한이 없어졌다')
  const over = fillFrom(ANSWER, { signal_max_per_day: (spec?.max ?? 0) + 1 })
  const row = over.find((f) => f.key === 'signal_max_per_day')
  assert.equal(row?.edited, false, '범위 밖 값을 손댄 값으로 받아들였다')
  assert.equal(row?.value, row?.computed, '계산된 값으로 안 돌아갔다')

  // 형이 안 맞는 것도 같다
  const wrongType = fillFrom(ANSWER, { daily_target_krw: 'many' as unknown as number })
  assert.equal(wrongType.find((f) => f.key === 'daily_target_krw')?.edited, false)
})

test('★ 손댄 줄에 표가 남는다 — 계산된 값과 화면에서 갈린다', () => {
  const edited = fillFrom(ANSWER, { daily_loss_limit_krw: 900000 })
  const row = edited.find((f) => f.key === 'daily_loss_limit_krw')
  assert.equal(row?.edited, true)
  assert.equal(row?.value, 900000)
  assert.equal(row?.computed, ANSWER.lossLimitKrw, '손대기 전 값을 안 들고 있어 되돌릴 수 없다')
  // 같은 값을 다시 적은 것은 고친 것이 아니다 — 아닌 줄에 표가 붙으면 표를 안 믿는다
  assert.equal(fillFrom(ANSWER, { daily_loss_limit_krw: ANSWER.lossLimitKrw })[1].edited, false)
})

test('★ 고친 손실 한도로 위험을 다시 잰다 (M6)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const at = actions.indexOf('export async function previewStart')
  const body = actions.slice(at, actions.indexOf('\n}\n', at))
  assert.ok(body.includes("filledNumber(filled, 'daily_loss_limit_krw'"),
    '답의 값으로 견준다 — 표에서 한도를 고쳐도 화면이 옛 숫자로 「몇 번분입니다」를 말한다')

  const panel = readFileSync(join(SETTINGS_DIR, 'StartPanel.tsx'), 'utf8')
  assert.ok(panel.includes('riskView(risk.onceKrw'), '화면이 손댄 값으로 다시 안 잰다')
  assert.ok(panel.includes("from '@/lib/trading/settings/onboarding'"),
    '화면이 자기 셈을 따로 뒀다 — 창구와 갈린다')
})

test('★ 미리보기 표를 그 자리에서 고칠 수 있다', () => {
  const panel = readFileSync(join(SETTINGS_DIR, 'StartPanel.tsx'), 'utf8')
  assert.match(panel, /id=\{`start-fill-\$\{f\.key\}`\}/, '값 칸이 읽기 전용이다')
  assert.match(panel, /setEdits\(/, '고친 값을 안 들고 있다')
  assert.ok(panel.includes('START_EDITED_MARK'), '고친 줄에 표를 안 붙인다')
  assert.ok(panel.includes('START_RESET_ONE'), '되돌릴 길이 없다')
  // 고친 값으로 채우기가 간다
  assert.ok(panel.includes('applyStart(answers, overridesOf())'), '고친 값이 채우기에 안 실린다')
  assert.ok(panel.includes('previewStart(answers, overridesOf())'), '고친 값으로 다시 안 묻는다')
})

test('★ 창구를 새로 안 연다 — 쓰던 둘을 그대로 쓴다 (S2)', () => {
  const actions = readFileSync(join(SETTINGS_DIR, 'actions.ts'), 'utf8')
  const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1])
  for (const name of ['previewStart', 'applyStart']) {
    assert.ok(exported.includes(name), `${name} 이 없어졌다`)
  }
  assert.equal(exported.filter((n) => /^(apply|preview)Start/.test(n)).length, 2,
    '시작하기 창구가 늘었다 — 늘어난 창구마다 소유자 확인을 다시 붙여야 한다')
})

test('★ 화면이 채울 값과 위험을 저장 전에 보여 준다', () => {
  const panel = readFileSync(join(SETTINGS_DIR, 'StartPanel.tsx'), 'utf8')
  assert.ok(panel.includes('f.label') && panel.includes('f.value'), '무엇이 채워지는지 안 보여 준다')
  assert.ok(panel.includes('shownRisk'), '고친 값 기준으로 안 보여 준다')
  assert.ok(panel.includes('riskLine('), '한 번에 얼마를 잃는지 안 말한다')
  assert.ok(panel.includes('raiseWarning'), '한도를 올릴 때 경고가 없다')
  assert.ok(panel.includes('START_WHEN'), '언제부터 듣는지를 안 말한다')
  assert.ok(panel.includes('f.needsPerson'), '사람이 답한 값이라는 표를 안 그린다')
  assert.ok(panel.includes("from '@/lib/trading/settings/start-labels'"), '말을 화면 안에서 짓는다')
})

test('★ 화면에 한글을 직접 안 적는다 (CEO.md §0-2)', () => {
  const panel = readFileSync(join(SETTINGS_DIR, 'StartPanel.tsx'), 'utf8')
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l))
  const hangul = code.flatMap((l) => l.match(/'[^'\n]*[가-힣][^'\n]*'/g) ?? [])
  assert.deepEqual(hangul, [], `화면에 한글을 직접 적었다: ${hangul.join(', ')}`)
})
