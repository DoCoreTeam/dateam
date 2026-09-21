/**
 * 공급자를 부르는 자리는 **등록된 키를 전부 쓰는 자리**를 지난다
 *
 * ## 무엇을 막는가 (실측 2026-09-21)
 *
 * 관리자 화면에 Gemini 키가 넷 있었고 하나는 유료였다. 그런데 견적서를 올리면
 * 「등록된 AI 공급자가 전부 사용량 한도에 걸렸습니다」가 떴다. `ai_provider_keys`
 * 여섯 줄의 `last_used_at` 이 전부 비어 있었다 — 한 번도 안 불린 것이다.
 *
 * 교체 규칙은 `lib/ai/key-rotation.ts` 에 이미 한 벌 있었다. **AI 채팅 스트림만 그것을 탔고**
 * CRM 추출과 심층분석과 서버 액션 여섯 자리가 `getProvider(...).streamChat(...)` 을 직접 불러
 * META 의 키 한 개로 끝냈다. 규칙이 있는데 아무도 안 부르는 상태였고, 그 상태를
 * 세는 곳이 없었다.
 *
 * ## 어떻게 세는가
 *
 * 이름이 아니라 **호출 자리**를 센다. `withProviderKeys` 를 import 만 해 두고 안 부르는
 * 파일은 통과하면 안 된다(이 저장소가 같은 함정에 네 번 빠졌다). 주석은 지우고 센다 —
 * 머리주석에 적힌 예시가 위반으로 잡히거나, 반대로 위반을 가려 주면 둘 다 거짓말이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 주석을 지운 소스. 주석 속 예시가 규칙을 통과시키거나 가로막으면 둘 다 거짓이 된다 */
function code(rel: string): string {
  return readFileSync(join(WEB, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const CALLS_PROVIDER = /\.streamChat\s*\(/
const CALLS_ROTATION = /withProviderKeys\s*\(/
const CALLS_SSOT = /streamChatWithKeys\s*\(/

/**
 * 공급자를 직접 불러도 되는 자리. **이유를 함께 적는다** —
 * 이유 없이 목록만 길어지면 그 목록이 곧 구멍이다.
 */
const MAY_CALL_PROVIDER: Record<string, string> = {
  'lib/ai-chat/stream-with-keys.ts':
    '교체 SSOT 자신. 여기 한 자리에서만 공급자 어댑터를 직접 부른다',
  'app/api/admin/ai-chat/stream/route.ts':
    'withProviderKeys 를 직접 써서 키 교체와 화면 안내(reset)를 함께 한다',
  'lib/rfp/ai/host-caller.ts':
    'withProviderKeys 를 직접 써서 잡 안에서 키를 갈아탄다',
}

/** 키 교체를 지나야 하는 호출처. 고친 자리가 조용히 되돌아가는 것을 막는다 */
const MUST_USE_SSOT = [
  'lib/crm/ai/adapters/host.ts',
  'lib/ai-chat/analyze-gemini.ts',
  'lib/ai-chat/analyze-core.ts',
  'lib/ai-chat/analyze-runner-worker.ts',
  'app/(ai)/ai/actions.ts',
  'app/(ai)/ai/analyze/actions.ts',
  'app/(ai)/ai/analyze/template-actions.ts',
]

function scan(): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.includes('.test.')) continue
      const rel = relative(WEB, full)
      if (CALLS_PROVIDER.test(code(rel))) hits.push(rel)
    }
  }
  for (const root of ['lib', 'app']) walk(join(WEB, root))
  return hits.sort()
}

/* ── 직접 부르는 자리가 늘지 않았나 ─────────────────── */

test('★ 공급자를 직접 부르는 파일은 허용 목록뿐이다 — 새 자리는 키 하나로 끝난다', () => {
  const unexpected = scan().filter((f) => !(f in MAY_CALL_PROVIDER))
  assert.deepEqual(unexpected, [], [
    '아래 파일이 공급자를 직접 부른다. 등록해 둔 나머지 키가 한 번도 안 쓰인다.',
    'lib/ai-chat/stream-with-keys.ts 의 streamChatWithKeys 를 쓰거나,',
    '키 교체와 화면 안내를 같이 해야 하면 withProviderKeys 를 직접 쓰고 이 목록에 이유와 함께 적어라.',
    unexpected.join('\n'),
  ].join('\n'))
})

test('★ 허용 목록은 죽은 줄을 남기지 않는다 — 안 쓰는 예외가 다음 사람의 근거가 된다', () => {
  const actual = new Set(scan())
  const stale = Object.keys(MAY_CALL_PROVIDER).filter((f) => !actual.has(f))
  assert.deepEqual(stale, [], '목록에만 남은 파일이다. 지워라')
})

/* ── 허용된 자리가 실제로 키를 갈아타나 ─────────────── */

test('★ 직접 부르는 자리는 키 교체를 실제로 부른다 — import 만 남아도 통과하면 가드가 아니다', () => {
  for (const rel of Object.keys(MAY_CALL_PROVIDER)) {
    if (rel === 'lib/ai-chat/stream-with-keys.ts') continue
    const src = code(rel)
    assert.ok(CALLS_ROTATION.test(src), `${rel}: withProviderKeys 를 부르지 않는다`)
    // 교체를 부르기만 하고 공급자 호출을 그 밖에 두면 키는 안 갈린다
    assert.ok(
      src.indexOf('withProviderKeys') < src.search(CALLS_PROVIDER),
      `${rel}: 공급자 호출이 키 교체 밖에 있다`,
    )
  }
})

test('★ SSOT 는 받은 키가 아니라 **그때 고른 키**를 넘긴다 — 안 넘기면 교체가 흉내만 난다', () => {
  const src = code('lib/ai-chat/stream-with-keys.ts')
  assert.match(src, /\(key\)\s*=>[\s\S]{0,120}apiKey:\s*key/,
    '바깥 apiKey 를 그대로 넘기면 키를 갈아도 같은 키로 부른다')
  assert.ok(!/apiKey:\s*apiKey|\.\.\.params,\s*apiKey\s*\}/.test(src),
    '받은 키를 그대로 쓰는 자리가 남아 있다')
})

/* ── 고친 자리가 되돌아가지 않았나 ──────────────────── */

test('★ 고친 호출처 일곱 곳이 그대로 SSOT 를 지난다', () => {
  for (const rel of MUST_USE_SSOT) {
    const src = code(rel)
    assert.ok(CALLS_SSOT.test(src), `${rel}: streamChatWithKeys 를 안 부른다`)
    assert.ok(!CALLS_PROVIDER.test(src), `${rel}: 공급자를 다시 직접 부른다`)
  }
})

/* ── 순서 규칙이 남아 있나 ──────────────────────────── */

test('키 교체는 모델 폴백보다 먼저다 — 키가 남았는데 더 싼 모델로 내려가면 안 된다', () => {
  const src = code('lib/ai-chat/analyze-core.ts')
  const first = src.search(CALLS_SSOT)
  const fallback = src.indexOf('fallbackModel')
  assert.ok(first > -1 && fallback > -1)
  assert.ok(
    src.slice(0, first).split('\n').length <= src.slice(0, src.indexOf('model: fb')).split('\n').length,
    '모델을 바꾼 뒤에야 키를 갈아탄다',
  )
})
