import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  maskKey,
  validateProviderKey,
  withProviderKey,
  withProviderModel,
  withoutProviderKey,
  describeKeyRemoval,
  describeKeySaved,
  describeConnectionOk,
  describeConnectionFailed,
  describeMissingKey,
  readProviderKey,
  readProviderModel,
  describeKeyRemovalAt,
  metaAfterKeyChange,
  defaultKeyLabel,
  validateKeyLabel,
} from './provider-keys.ts'
import { keyViewStatus, toKeyView, reorderPriorities } from './key-store-core.ts'
import type { KeyPoolEntry } from './key-pool.ts'
import { AI_PROVIDERS, AI_PROVIDER_IDS, getProviderSpec, type AiProviderId } from './provider-catalog.ts'

/** 명세의 접두사로 만든, 그 공급자가 받아 줄 모양의 가짜 키 */
function sampleKey(id: AiProviderId): string {
  return `${getProviderSpec(id).keyPrefixes[0]}${'x'.repeat(40)}`
}

/* ── 넷이 한 벌인가 ────────────────────────────────────────── */

test('창구: 저장 삭제 모델저장 연결확인 넷이 다섯 공급자를 전부 id 하나로 받는다', () => {
  for (const id of AI_PROVIDER_IDS) {
    const key = sampleKey(id)
    assert.equal(validateProviderKey(id, key).ok, true, `${id}: 저장`)

    const saved = withProviderKey(id, key, {})
    assert.equal(readProviderKey(id, saved), key, `${id}: 저장한 키를 되읽는다`)

    const withModel = withProviderModel(id, 'some-model', saved)
    assert.equal(readProviderModel(id, withModel), 'some-model', `${id}: 모델저장`)

    const removed = withoutProviderKey(id, withModel)
    assert.equal(readProviderKey(id, removed.meta), null, `${id}: 삭제`)

    assert.ok(describeConnectionOk(id, 3).length > 0, `${id}: 연결확인 성공 문장`)
    assert.ok(describeConnectionFailed(id, 401).length > 0, `${id}: 연결확인 실패 문장`)
    assert.ok(describeMissingKey(id).length > 0, `${id}: 키 없음 문장`)
  }
})

test('창구: 저장은 원본 META 를 고치지 않고 새 객체를 돌려준다', () => {
  const before = { gemini_api_key: '기존' }
  const after = withProviderKey('claude', sampleKey('claude'), before)
  assert.deepEqual(before, { gemini_api_key: '기존' })
  assert.equal(after.gemini_api_key, '기존') // 남의 공급자 키를 밀어내지 않는다
})

/* ── 접두사 검증이 명세에서 오는가 ─────────────────────────── */

test('검증: 틀린 접두사는 저장하지 않는다', () => {
  for (const id of AI_PROVIDER_IDS) {
    const wrong = validateProviderKey(id, 'nope-1234567890')
    assert.equal(wrong.ok, false, `${id}: 아무 문자열이나 통과했다`)
    assert.match(wrong.error ?? '', /시작해야/, `${id}: 이유를 말하지 않는다`)
  }
  assert.equal(validateProviderKey('gemini', '   ').ok, false)
  assert.match(validateProviderKey('gemini', '').error ?? '', /입력/)
})

test('검증: 남의 공급자 키를 붙여 넣으면 그 자리에서 걸린다', () => {
  // Claude 칸에 OpenAI 키를 넣던 사고. sk- 는 sk-ant- 를 통째로 포함하므로 길이 비교가 필요하다
  assert.equal(validateProviderKey('claude', sampleKey('openai')).ok, false)
  assert.equal(validateProviderKey('openai', sampleKey('claude')).ok, false)
  assert.equal(validateProviderKey('groq', sampleKey('grok')).ok, false)
  assert.equal(validateProviderKey('grok', sampleKey('groq')).ok, false)
  // 제 칸에는 들어간다
  assert.equal(validateProviderKey('claude', sampleKey('claude')).ok, true)
  assert.equal(validateProviderKey('openai', sampleKey('openai')).ok, true)
})

test('검증: 접두사 목록을 이 파일이 또 적지 않는다 (명세가 바뀌면 따라온다)', () => {
  for (const spec of AI_PROVIDERS) {
    const err = validateProviderKey(spec.id, 'definitely-not-a-key').error ?? ''
    for (const prefix of spec.keyPrefixes) {
      assert.ok(err.includes(prefix), `${spec.id}: 안내문이 명세의 접두사 ${prefix} 를 말하지 않는다`)
    }
  }
})

/* ── 원문 키가 새어 나가는가 ───────────────────────────────── */

test('비밀: 성공도 실패도 응답 문장에 원문 키를 담지 않는다', () => {
  for (const id of AI_PROVIDER_IDS) {
    const key = sampleKey(id)
    const lines = [
      JSON.stringify(validateProviderKey(id, key)),
      JSON.stringify(validateProviderKey(id, 'wrong-key-value')),
      describeKeySaved(id, key),
      describeConnectionOk(id, 1),
      describeConnectionFailed(id, 401),
      describeConnectionFailed(id),
      describeMissingKey(id),
      String(describeKeyRemoval(id) ?? ''),
      JSON.stringify(withoutProviderKey(id, withProviderKey(id, key, {})).warning),
    ]
    for (const line of lines) {
      assert.ok(!line.includes(key), `${id}: 응답에 원문 키가 담겼다 — ${line}`)
    }
  }
})

test('비밀: 가림값은 앞뒤 네 자만 남기고 원문 길이를 그대로 알리지 않는다', () => {
  const key = sampleKey('groq')
  const masked = maskKey(key)
  assert.ok(!masked.includes(key))
  assert.match(masked, /^gsk_/)
  assert.ok(masked.endsWith('xxxx'))
  assert.equal(maskKey('짧음'), '****') // 짧은 값은 통째로 가린다
})

/* ── 해제할 때 무엇이 함께 멈추는가 ────────────────────────── */

test('해제: Groq 을 해제하면 회의 녹음 전사가 함께 멈춘다는 사실을 말한다', () => {
  const { warning } = withoutProviderKey('groq', {
    stt_api_key: sampleKey('groq'),
    stt_model: 'whisper-large-v3',
    stt_provider: 'groq',
  })
  assert.ok(warning, 'Groq 해제에 아무 경고가 없다')
  assert.match(warning, /회의/)
  assert.match(warning, /멈춥니다/)
})

test('해제: 키가 데리고 다니던 설정도 함께 지운다', () => {
  const { meta } = withoutProviderKey('groq', {
    stt_api_key: sampleKey('groq'),
    stt_model: 'whisper-large-v3',
    stt_provider: 'groq',
    gemini_api_key: '남의 것',
  })
  assert.equal('stt_api_key' in meta, false)
  assert.equal('stt_model' in meta, false)   // 남으면 「설정했는데 왜 이 모델이지」가 남는다
  assert.equal('stt_provider' in meta, false)
  assert.equal(meta.gemini_api_key, '남의 것') // 남의 공급자는 건드리지 않는다
})

test('해제: 또 하는 일이 없는 공급자는 헛경고를 하지 않는다', () => {
  assert.equal(describeKeyRemoval('claude'), null)
  assert.equal(describeKeyRemoval('openai'), null)
})

/* ── 서버액션이 이 창구만 쓰는가 (정적 가드) ───────────────── */

const ACTIONS = fileURLToPath(new URL('../../app/admin/settings/actions.ts', import.meta.url))
const actionsSource = () => readFileSync(ACTIONS, 'utf8')

test('가드: 서버액션이 넷을 공급자 id 로 받는 한 벌로 내놓는다', () => {
  const src = actionsSource()
  for (const name of ['saveProviderKey', 'deleteProviderKey', 'saveProviderModel', 'checkProviderConnection']) {
    assert.match(src, new RegExp(`export async function ${name}\\s*\\(\\s*\\n?\\s*provider: AiProviderId`), `${name} 가 공급자 id 를 첫 인자로 받지 않는다`)
  }
})

test('가드: 옛 서버액션이 자기 로직 없이 새 창구를 부르기만 한다', () => {
  // META 키 이름을 화면 쪽 파일이 또 적으면 검증도 두 벌이 된다. 이름은 명세에서만 온다
  const src = actionsSource()
  for (const spec of AI_PROVIDERS) {
    assert.ok(!src.includes(spec.meta.apiKey), `actions.ts 가 ${spec.id} 의 META 키 이름(${spec.meta.apiKey})을 직접 적는다`)
    assert.ok(!src.includes(spec.meta.model), `actions.ts 가 ${spec.id} 의 META 모델 이름(${spec.meta.model})을 직접 적는다`)
  }
})

test('가드: 모델 목록을 공급자마다 따로 fetch 하지 않는다', () => {
  // 주소는 명세에, 부르는 방법은 레지스트리에 있다. 여기에 또 적히면 셋이 갈린다
  const src = actionsSource()
  for (const host of ['generativelanguage.googleapis.com', 'api.anthropic.com', 'api.openai.com', 'api.groq.com', 'api.x.ai']) {
    assert.ok(!src.includes(host), `actions.ts 가 ${host} 를 직접 부른다`)
  }
})

/* ── 키가 여러 개일 때 ────────────────────────────────────────────
   여기가 틀리면 둘 다 조용하다. 거짓 경고는 두 번째부터 안 읽히고,
   META 를 안 맞추면 「지웠는데 그 키로 계속 돈다」가 된다. */

const NOW = Date.parse('2026-09-20T12:00:00.000Z')

function entry(over: Partial<KeyPoolEntry> & { id: string }): KeyPoolEntry {
  return {
    provider: 'groq', label: over.id, apiKey: 'gsk_1234567890abcdefghij',
    priority: 0, isActive: true, cooldownUntil: null,
    disabledReason: null, consecutiveFailures: 0,
    ...over,
  }
}

test('★ 남은 키가 있으면 함께 멈춘다는 경고를 하지 않는다 — 거짓 경고는 두 번째부터 안 읽힌다', () => {
  assert.equal(describeKeyRemovalAt('groq', 1), null)
  assert.equal(describeKeyRemovalAt('groq', 2), null)
})

test('★ 마지막 하나를 지울 때만 무엇이 함께 멈추는지 말한다', () => {
  const warning = describeKeyRemovalAt('groq', 0)
  assert.ok(warning)
  assert.match(warning, /회의 녹음/)
})

test('함께 멈출 것이 없는 공급자는 마지막이어도 경고가 없다', () => {
  assert.equal(describeKeyRemovalAt('claude', 0), null)
})

test('★ 표를 고치면 META 의 기존 칸이 첫 줄과 같아진다 — 그 칸을 읽는 자리가 아직 마흔이다', () => {
  const meta = { stt_api_key: '옛키', stt_model: 'whisper' }

  const next = metaAfterKeyChange('groq', '새첫줄키', meta)

  assert.equal(next.stt_api_key, '새첫줄키')
  assert.equal(next.stt_model, 'whisper', '딸린 설정까지 지우지 않는다')
  assert.equal(meta.stt_api_key, '옛키', '원본은 그대로 둔다')
})

test('줄이 하나도 없으면 META 칸을 비운다 — 없는 키가 있는 것처럼 보이면 안 된다', () => {
  const next = metaAfterKeyChange('groq', null, { stt_api_key: '옛키' })
  assert.equal('stt_api_key' in next, false)
})

test('이름을 안 적으면 순서로 짓는다 — 이름 없는 줄은 원장에서 못 가린다', () => {
  assert.equal(defaultKeyLabel([]), '기본')
  assert.equal(defaultKeyLabel(['기본']), '2번째')
  assert.equal(defaultKeyLabel(['기본', '2번째']), '3번째')
})

test('이름이 겹치면 저장 전에 막는다 — 표에 유니크가 걸려 있어 안 막으면 그냥 실패한다', () => {
  assert.equal(validateKeyLabel('새것', ['기본']).ok, true)
  assert.equal(validateKeyLabel('기본', ['기본']).ok, false)
  assert.equal(validateKeyLabel('  ', []).ok, false)
  assert.equal(validateKeyLabel('가'.repeat(41), []).ok, false)
})

/* ── 화면에 보이는 줄 ─────────────────────────────────────────── */

test('★ 화면용 줄에 원문 키가 없다', () => {
  const view = toKeyView(entry({ id: 'a', apiKey: 'gsk_secret-1234567890' }), NOW)

  assert.ok(!JSON.stringify(view).includes('secret'), '가림값이 아니라 원문이 화면으로 나간다')
  assert.match(view.maskedKey, /\*{4}/)
})

test('★ 상태는 넷 중 하나로 정해진다 — 사람이 끈 것이 먼저고 그다음이 고칠 것이다', () => {
  assert.equal(keyViewStatus(entry({ id: 'a' }), NOW), 'usable')
  assert.equal(keyViewStatus(entry({ id: 'b', isActive: false }), NOW), 'off')
  assert.equal(keyViewStatus(entry({ id: 'c', disabledReason: 'auth', isActive: false }), NOW), 'auth_broken',
    '인증이 깨져 자동으로 꺼진 줄을 「꺼 둠」이라 하면 사람이 다시 켜고 끝낸다')
  assert.equal(
    keyViewStatus(entry({ id: 'd', cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }), NOW),
    'cooling')
})

test('상태마다 사람이 읽을 말이 붙는다 — 같은 상태가 화면마다 다른 말이 되지 않게', () => {
  const cooling = toKeyView(
    entry({ id: 'd', cooldownUntil: new Date(NOW + 60_000).toISOString(), disabledReason: 'quota' }), NOW)
  assert.match(cooling.statusText, /한도/)
  assert.ok(cooling.cooldownUntil, '언제 풀리는지를 함께 준다')
  assert.equal(toKeyView(entry({ id: 'a' }), NOW).cooldownUntil, null)
})

/* ── 순서 바꾸기 ──────────────────────────────────────────────── */

test('★ 위로 내리면 앞줄과 자리를 바꾸고 바뀐 둘만 돌려준다', () => {
  assert.deepEqual(reorderPriorities(['a', 'b', 'c'], 'b', 'up'),
    [{ id: 'b', priority: 0 }, { id: 'a', priority: 1 }])
})

test('아래로 내리면 뒷줄과 바꾼다', () => {
  assert.deepEqual(reorderPriorities(['a', 'b', 'c'], 'b', 'down'),
    [{ id: 'c', priority: 1 }, { id: 'b', priority: 2 }])
})

test('★ 끝에서 더 밀면 아무것도 바꾸지 않는다 — 빈 목록이지 오류가 아니다', () => {
  assert.deepEqual(reorderPriorities(['a', 'b'], 'a', 'up'), [])
  assert.deepEqual(reorderPriorities(['a', 'b'], 'b', 'down'), [])
  assert.deepEqual(reorderPriorities(['a', 'b'], '없는줄', 'up'), [])
})
