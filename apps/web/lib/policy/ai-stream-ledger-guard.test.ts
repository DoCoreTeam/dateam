/**
 * 흘려보내는 길은 끝을 스스로 적어야 한다
 *
 * **왜**: 한 번에 묻고 답을 받는 길은 관문이 «부르고 받고 적는다» 를 한 덩어리로 싼다.
 * 흐름은 못 그런다 — 끝이 언제인지 부르는 쪽만 안다. 그래서 `done()` 을 부르는 일이
 * 호출하는 쪽에 남는다.
 *
 * 안 부르면 **전송 기록만 남고 호출 기록이 안 남는다.** 나간 것은 보이는데 얼마나
 * 걸렸는지 성공했는지가 없다. 화면에서는 아무 문제도 안 보인다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OPENERS = ['guardedGeminiStream', 'beginGuardedCall']

function files(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts')) continue
      out.push(full)
    }
  }
  for (const root of ['lib', 'app']) walk(join(WEB, root))
  return out
}

/** 선언한 자리(관문 자신)는 빼고, 실제로 여는 자리만 센다 */
function opensStream(src: string, rel: string): boolean {
  if (rel === 'lib/ai/guarded-call.ts' || rel === 'lib/ai/guarded-gemini.ts') return false
  return OPENERS.some((n) => new RegExp(`(await\\s+)?${n}\\s*\\(`).test(src))
}

test('★ 흐름을 여는 곳은 끝도 적는다', () => {
  const offenders: string[] = []
  let opened = 0
  for (const full of files()) {
    const rel = relative(WEB, full)
    const src = readFileSync(full, 'utf8')
    if (!opensStream(src, rel)) continue
    opened++
    if (!/\.done\s*\(/.test(src)) {
      offenders.push(`${rel} 이 흐름을 열고 done 을 안 부른다`)
    }
  }
  assert.deepEqual(offenders, [], [
    '흐름이 끝났는데 호출 기록이 안 남는다. 전송만 있고 결과가 없다:',
    ...offenders.map((o) => `  ${o}`),
  ].join('\n'))
  // 아무것도 안 훑으면 이 검사는 늘 통과한다
  assert.ok(opened > 0, '흐름을 여는 파일을 하나도 못 찾았다, 이름이 바뀌었는지 확인한다')
})

test('★ 흐르는 중 되돌리기는 반쪽 자리표를 안 내보낸다', async () => {
  const { unmaskStreaming } = await import('../ai/guarded-call.ts')
  const hits = [{ kind: 'name' as const, value: '김도현', token: '⟦PII_1⟧' }]
  assert.equal(unmaskStreaming('안녕 ⟦PII_1⟧ 님', hits), '안녕 김도현 님')
  // 반쪽이 오면 그 앞에서 끊는다 — 한 번 화면에 나간 글자는 못 지운다
  assert.equal(unmaskStreaming('안녕 ⟦PII_', hits), '안녕 ')
  assert.equal(unmaskStreaming('안녕 ⟦PII_1⟧ 님 ⟦PI', hits), '안녕 김도현 님 ')
})
