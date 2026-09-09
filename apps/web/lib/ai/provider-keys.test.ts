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
} from './provider-keys.ts'
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
