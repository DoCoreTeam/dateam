// lib/policy/ai-key-pool.test.ts — 키 여러 벌이 흩어지지 않는가
//
// ## 왜 정책 가드인가
//
// 이 판에서 고친 것은 기능 하나가 아니라 **원문 API 키가 흐르는 길**이다.
// 길은 시간이 지나면 갈라진다 — 급할 때 한 자리가 표를 직접 열고, 다음 사람이 그걸 보고
// 따라 하고, 그러면 「어디가 키를 응답에 싣는지」를 셀 수 없게 된다.
// 이 저장소는 그 방식으로 **표 여덟 개가 잠금 없이 열려 있던** 적이 있다(2026-09-20 실측).
// 문서로 적어 두면 안 지켜진다는 것도 이미 확인했다(버전 규칙이 열일곱 판 동안 안 지켜졌다).
//
// 그래서 네 가지를 센다. 셋은 「새지 않는가」이고 하나는 「흩어지지 않는가」다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 키 표에 닿아도 되는 유일한 파일 */
const KEY_STORE = join('lib', 'ai', 'key-store.ts')
/** 키 교체를 스스로 해도 되는 유일한 파일 */
const KEY_ROTATION = join('lib', 'ai', 'key-rotation.ts')

function sourceFiles(dir: string, out: string[] = []): string[] {
  let names: string[]
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.next')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

const ALL = [...sourceFiles(join(WEB, 'lib')), ...sourceFiles(join(WEB, 'app'))]
const rel = (f: string): string => f.slice(WEB.length + 1)
const read = (f: string): string => readFileSync(f, 'utf8')

/* ── 새지 않는가 ──────────────────────────────────────────────── */

test('★ 키 표를 직접 여는 자리는 key-store.ts 하나뿐이다', () => {
  const offenders = ALL
    .filter((f) => !rel(f).endsWith(KEY_STORE))
    .filter((f) => /from\(['"]ai_provider_keys['"]\)/.test(read(f)))
    .map(rel)

  assert.deepEqual(offenders, [],
    '원문 키가 든 표를 여러 자리에서 열면 어디가 응답에 싣는지 셀 수 없다')
})

test('★ 키를 다루는 모듈은 클라이언트 묶음으로 끌려가지 않는다', () => {
  const store = read(join(WEB, KEY_STORE))
  assert.equal(store.split('\n')[0].trim(), "import 'server-only'",
    "server-only 가 없으면 원문 키가 브라우저 묶음에 들어간다")
})

/*
  **브라우저로 가는 자리만 센다.** 서버 컴포넌트도 `.tsx` 라서 파일 확장자로 가르면
  키를 서버에서만 쓰고 넘기지 않는 자리까지 잡힌다(실제로 `rfp/admin/page.tsx` 가 그렇다 —
  키로 사슬을 만들고 화면에는 이름만 넘긴다). 그것까지 막으면 가드가 틀린 것을 잡는 가드가 된다.

  브라우저로 가는 길은 둘이다: `'use client'` 파일이 키를 들거나, 서버가 키를 **prop 으로 넘기거나**.
*/
test('★ 원문 키가 브라우저로 가지 않는다 — 클라이언트 파일과 prop 둘 다', () => {
  const offenders = ALL
    .filter((f) => /\.tsx$/.test(f))
    .filter((f) => {
      const src = read(f)
      const isClient = /^['"]use client['"]/m.test(src.slice(0, 200))
      if (/from\(['"]ai_provider_keys['"]\)/.test(src)) return true
      // 서버가 클라이언트 부품에 prop 으로 넘기는 모양
      if (/apiKey=\{/.test(src)) return true
      // 받은 객체에서 원문을 꺼내 드는 모양
      return isClient && /\.apiKey\b/.test(src)
    })
    .map(rel)

  assert.deepEqual(offenders, [],
    '키가 브라우저로 가면 HTML 본문과 메모리에 원문이 남는다')
})

/*
  가림값을 만드는 자리가 흩어지면, 한 곳만 고쳐도 다른 곳은 원문을 그대로 흘린다.
  만드는 함수는 둘뿐이다 — 키 자체의 `maskApiKey`(lib/ai/key-pool)와
  화면 창구의 `maskKey`(lib/ai/provider-keys). 셋째가 생기면 여기서 잡는다.
*/
test('★ 가림값을 만드는 자리가 늘지 않는다', () => {
  // AI 공급자 키만 본다. `lib/apiKey.ts` 는 **우리가 발급하는** ax_live_ 키라 다른 물건이다
  const makers = ALL
    .filter((f) => rel(f).startsWith('lib/ai/'))
    .filter((f) => /export function mask(ApiKey|Key)\b/.test(read(f)))
    .map(rel)
    .sort()

  assert.deepEqual(makers, ['lib/ai/key-pool.ts', 'lib/ai/provider-keys.ts'])
})

/* ── 흩어지지 않는가 ──────────────────────────────────────────── */

/*
  키 교체를 자기 방식으로 다시 짜면 같은 429 가 어떤 길에서는 교체가 되고 어떤 길에서는
  그냥 실패가 된다. 그 어긋남은 화면에서 전부 「AI 가 안 된다」로 보여 원인을 못 찾는다.
  공통 호출기(gemini-call)는 모델 사슬 안에서 돌아야 해서 자기 고리를 갖는다 — 예외로 적는다.
*/
const ROTATION_ALLOWED = new Set([KEY_ROTATION, join('lib', 'ai', 'gemini-call.ts')].map((p) => p))

/** 규칙을 **정의하는** 모듈. 여기서 쓰는 것은 자기 자신이라 흩어진 것이 아니다 */
const RULE_MODULES = new Set([
  join('lib', 'ai', 'key-pool.ts'),
  join('lib', 'ai', 'key-store-core.ts'),
])

test('★ 키 교체를 스스로 돌리는 자리가 늘지 않는다', () => {
  const offenders = ALL
    .filter((f) => !ROTATION_ALLOWED.has(rel(f)))
    .filter((f) => !RULE_MODULES.has(rel(f)))
    .filter((f) => {
      const src = read(f)
      // 「다음 키로」를 자기 손으로 도는 모양: 키 목록을 돌면서 부른다
      return /orderKeys\(/.test(src) && !/withProviderKeys/.test(src)
    })
    .map(rel)

  assert.deepEqual(offenders, [],
    '교체 규칙이 두 벌이 되면 같은 429 가 길마다 다르게 끝난다')
})

test('★ 키 상태를 표에 적는 자리는 저장소를 지난다', () => {
  const offenders = ALL
    .filter((f) => !rel(f).endsWith(KEY_STORE))
    .filter((f) => !RULE_MODULES.has(rel(f)))
    .filter((f) => /nextKeyState\(/.test(read(f)))
    .map(rel)

  assert.deepEqual(offenders, [],
    '상태 계산이 흩어지면 같은 실패가 어떤 길에서는 쿨다운이고 어떤 길에서는 사용중지가 된다')
})

/* ── 부품이 실제로 쓰이는가 ───────────────────────────────────── */

/*
  v0.7.438 의 교훈: 표와 설정은 만들었는데 **소비 코드가 0** 이라 화면에서는 아무 일도
  안 일어났다. 부품을 세웠으면 부르는 자리가 있어야 한다.
*/
test('★ 키 교체 부품을 실제로 부르는 자리가 있다', () => {
  const callers = ALL
    .filter((f) => rel(f) !== KEY_ROTATION)
    .filter((f) => /withProviderKeys\(/.test(read(f)))
    .map(rel)
    .sort()

  assert.ok(callers.length >= 4, `부르는 자리가 ${callers.length} 곳뿐이다: ${callers.join(', ')}`)
  for (const must of ['lib/stt/provider.ts', 'lib/gemini-embedding.ts', 'lib/rfp/ai/host-caller.ts']) {
    assert.ok(callers.includes(must), `${must} 가 부품을 안 탄다`)
  }
})

test('★ 키 저장소를 실제로 부르는 자리가 있다', () => {
  const callers = ALL
    .filter((f) => !rel(f).endsWith(KEY_STORE))
    .filter((f) => /readKeyPool\(|listKeys\(/.test(read(f)))
    .map(rel)

  assert.ok(callers.length >= 2, `저장소를 부르는 자리가 ${callers.length} 곳뿐이다`)
})

/* ── 원장에 남는 값 ───────────────────────────────────────────── */

/*
  원장은 오래 남고 여러 사람이 읽는다. 거기에 원문 키가 한 번 들어가면 되돌릴 수 없다 —
  표를 잠그고 로그를 가려도 그 줄은 남아 있다. 그래서 「이름만」을 기계가 센다.
*/
test('★ 원장의 key_ref 에 원문 키가 아니라 이름이 들어간다', () => {
  const writers = ALL
    .filter((f) => /keyRef:/.test(read(f)))
    .map((f) => ({ file: rel(f), src: read(f) }))

  // 칸만 만들고 아무도 안 적으면 없는 것과 같다(v0.7.438 전례). 지금 적는 곳은 전사와 임베딩 둘
  assert.deepEqual(writers.map((w) => w.file).sort(),
    ['lib/gemini-embedding.ts', 'lib/stt/provider.ts'])

  for (const w of writers) {
    for (const m of w.src.matchAll(/keyRef:\s*([^,\n}]+)/g)) {
      const value = m[1].trim()
      assert.ok(!/apiKey|api_key/.test(value),
        `${w.file} 가 key_ref 에 원문 키를 넣는다: ${value}`)
    }
  }
})

test('★ 마이그레이션이 표를 새로 만들지 않고 칸만 더한다 — RLS 판이 바뀌지 않게', () => {
  const sql = readFileSync(join(WEB, '..', '..', 'supabase/migrations/266_ai_call_key_ref.sql'), 'utf8')

  assert.ok(!/CREATE TABLE/i.test(sql), '표를 새로 만들면 RLS 를 같은 판에서 켜야 한다(S1)')
  assert.match(sql, /ADD COLUMN IF NOT EXISTS key_ref/)
  assert.match(sql, /drop column if exists key_ref/i, '되돌리는 방법을 적어 둔다')
})
