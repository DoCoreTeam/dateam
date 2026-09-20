/**
 * 키를 고르는 자리가 하나로 모인다 (P0030 I14)
 *
 * ## 무엇을 막는가
 *
 * 키를 읽는 길이 셋이었다 — META 직독(`gemini_api_key`), ai-chat 의 `getProviderConfig`,
 * 그리고 새 키 표. 셋이 서로를 몰라서 어느 키가 실제로 쓰였는지 한 곳에서 말할 수 없었고,
 * **판을 보는 곳은 한 곳도 없었다.** 개발하는 사람의 노트북이 운영 키로 벤더를 두드려도
 * 원장에는 운영 호출과 똑같이 남았다(실측 2026-09-20 하루 23,318건, 판 구분 0).
 *
 * ## 왜 기준선인가
 *
 * 직접 읽는 파일이 마흔여섯이다. 지금 전부 막으면 멀쩡히 도는 기능이 멈춘다. 대신 수를 세고,
 * **늘면 실패하고 줄면 기준선을 따라 내린다.** 이 저장소가 기존 위반을 다루는 방식이다
 * (lib/policy/vendor-call-baseline.test.ts 와 같은 모양).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE = JSON.parse(
  readFileSync(join(WEB, 'lib/policy/ai-key-source-baseline.json'), 'utf8'),
) as { 설명: string; 파일: string[] }

/** 키를 직접 집는 모양 */
const DIRECT = /gemini_api_key|readGeminiKey\s*\(|getProviderConfig\s*\(/

/** 세지 않는 파일 — 그 길을 내놓는 자리 자신이다 */
const SELF = new Set([
  'lib/ai/gemini-key.ts',
  'lib/ai/provider-key-source.ts',
  'lib/ai-chat/registry.ts',
])

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
      if (SELF.has(rel)) continue
      if (DIRECT.test(readFileSync(full, 'utf8'))) hits.push(rel)
    }
  }
  for (const root of ['lib', 'app']) walk(join(WEB, root))
  return hits.sort()
}

test('★ 키를 직접 읽는 파일이 기준선보다 늘지 않았다', () => {
  const known = new Set(BASELINE.파일)
  const added = scan().filter((f) => !known.has(f))
  assert.deepEqual(added, [], [
    '공급자 키를 직접 읽는 자리가 늘었다.',
    '그 길은 판(운영·개발)을 안 보므로 개발 판이 운영 키를 쓰게 된다.',
    'lib/ai/provider-key-source 의 resolveProviderKey 를 쓰거나, 정말 예외면 기준선에 사유와 함께 더한다:',
    ...added.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 옮겨서 사라진 파일은 기준선에서도 지운다 — 안 내리면 다시 늘어도 안 잡힌다', () => {
  const now = new Set(scan())
  const gone = BASELINE.파일.filter((f) => !now.has(f))
  assert.deepEqual(gone, [], [
    '기준선에 있는데 이제 키를 직접 안 읽는다. 옮겼으면 그만큼 기준선도 내린다:',
    ...gone.map((f) => `  ${f}`),
  ].join('\n'))
})

test('★ 고르는 자리가 판을 본다', () => {
  const src = readFileSync(join(WEB, 'lib/ai/provider-key-source.ts'), 'utf8')
  assert.match(src, /mayUseProductionKeys/, '판을 안 보고 키를 고른다')
  assert.match(src, /env_blocked/, '막았다는 사실을 말하지 않는다 — 「키를 안 넣었나」와 구별이 안 된다')
})

test('★ 원장이 판을 적는다', () => {
  const ledger = readFileSync(join(WEB, 'lib/ai/ledger.ts'), 'utf8')
  assert.match(ledger, /currentDeployEnv\(\)/, '원장이 판을 안 적는다')
  assert.match(ledger, /\{ \.\.\.row, env \}/, '호출 기록에 판을 안 싣는다')
  const mig = readFileSync(join(WEB, '..', '..', 'supabase/migrations/267_ai_llm_calls_env.sql'), 'utf8')
  assert.match(mig, /add column if not exists env/, '표에 칸이 없다')
})

test('규칙이 도는 대상이 실제로 있다', () => {
  assert.ok(BASELINE.파일.length >= 1, '기준선이 비었다면 스캐너가 빗나간 것이다')
  for (const f of BASELINE.파일) {
    assert.ok(readFileSync(join(WEB, f), 'utf8').length > 0, `${f} 을 못 읽는다`)
  }
})

/*
  자동으로 도는 것은 운영 판에서만 (P0030 I15)

  큐 구동기는 화면이 열려 있는 동안 큐를 계속 비운다. 개발하는 사람이 화면을 켜 두면
  그 노트북이 운영 큐를 대신 돌리고, 그 호출은 운영 한도를 쓴다 — 실측 2026-09-20
  하루 23,318건 중 어느 것이 그렇게 나간 것인지 가릴 방법이 없었다.
*/
test('★ 큐 구동기가 개발 판에서 저절로 안 돈다', () => {
  const src = readFileSync(join(WEB, 'components/ci/QueueDriver.tsx'), 'utf8')
  assert.match(src, /currentDeployEnv\(\) === 'production'/, '판을 안 보고 돈다')
  assert.match(
    src, /if \(!autoDrive\) return/,
    '판을 보기만 하고 자동 실행을 안 막는다 — 값을 읽어 두고 안 쓰면 없는 것과 같다',
  )
  assert.match(src, /setManualStarted\(true\)/, '개발 판에서 사람이 눌러 시작할 길이 없다')
})

test('★ 발행기가 사라진 기본 모델을 안 쓴다', () => {
  const gen = readFileSync(join(WEB, 'scripts/changelog-gen.mjs'), 'utf8')
  assert.ok(
    !/'gemini-2\.0-flash'/.test(gen),
    '구글에서 지워진 모델(404)이 아직 기본값이다. META 에 모델이 없으면 발행이 조용히 실패한다',
  )
  const ssot = readFileSync(join(WEB, 'lib/ai/gemini-model.ts'), 'utf8')
  const want = /DEFAULT_GEMINI_MODEL = '([^']+)'/.exec(ssot)?.[1]
  assert.ok(want, 'SSOT 에서 기본 모델을 못 읽었다')
  assert.match(
    gen, new RegExp(`DEFAULT_MODEL = '${want}'`),
    `발행기의 기본 모델이 SSOT(${want})와 다르다`,
  )
})
