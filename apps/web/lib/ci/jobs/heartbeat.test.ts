/**
 * 도는 동안 잠금을 다시 찍는가 (P0030 I03)
 *
 * ## 왜 소스를 읽는가
 *
 * queue.ts 와 drain.ts 는 Supabase 관리자 클라이언트를 끌어와 여기서 못 부른다.
 * 그런데 잠가야 할 것은 SQL 의 결과가 아니라 **배선**이다. 찍는 함수가 있어도
 * 아무도 안 부르면 없는 것과 같고, 끄는 자리가 없으면 끝난 잡의 잠금을 영원히 찍는다.
 * 규칙 자체(간격·창)는 순수 계층에서 drain-policy.test.ts 가 값으로 확인한다.
 *
 * ## 무엇을 막는가
 *
 * 좀비 판정은 **잡은 시각**만 본다. 5분을 넘기는 일은 멀쩡히 돌고 있어도 죽은 것으로
 * 회수돼 다른 워커가 처음부터 다시 했다. AI 를 부르는 단계는 한 번에 여러 건을 물어
 * 쉽게 그 선을 넘었다.
 *
 * 실측 2026-09-20: ci_jobs project 단계 STALLED 302건, 전부 시도 3회를 태우고 폐기.
 * 그 세 번이 매번 AI 배치를 처음부터 다시 돌렸다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'lib', 'ci', 'jobs')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const queue = strip(readFileSync(join(DIR, 'queue.ts'), 'utf8'))
const drain = strip(readFileSync(join(DIR, 'drain.ts'), 'utf8'))

test('잠금을 다시 찍는 함수가 있다', () => {
  assert.match(queue, /export async function touchJobLock\s*\(/, 'touchJobLock 이 없다')
})

test('★ 내 잠금일 때만 찍는다 — 남의 잠금을 밀어 주면 그 워커가 죽어도 회수가 안 된다', () => {
  const at = queue.indexOf('export async function touchJobLock')
  const body = queue.slice(at, at + 900)

  assert.match(body, /\.eq\(\s*'locked_by'\s*,\s*workerId\s*\)/, '집은 워커를 확인하지 않는다')
  assert.match(body, /\.eq\(\s*'status'\s*,\s*'running'\s*\)/, '이미 끝난 잡까지 찍는다')
  assert.match(body, /locked_at/, 'locked_at 을 갱신하지 않으면 찍는 의미가 없다')
})

test('★ 찍기 실패가 일을 멈추지 않는다', () => {
  const at = queue.indexOf('export async function touchJobLock')
  const body = queue.slice(at, at + 900)

  assert.match(
    body, /catch\s*\{[\s\S]{0,80}return false/,
    '던지면 멀쩡히 끝날 일이 네트워크 한 번 덜컹한 것 때문에 죽는다. '
    + '못 찍으면 최악이어도 예전과 같아질 뿐이다(회수돼 다시 돈다)',
  )
})

test('★ 드레인이 그 함수를 실제로 부른다 — 함수만 있고 안 부르면 없는 것과 같다', () => {
  assert.match(drain, /touchJobLock\s*\(/, '드레인이 touchJobLock 을 안 부른다')
  assert.match(
    drain, /setInterval\([\s\S]{0,160}touchJobLock/,
    '한 번만 찍으면 긴 일은 여전히 회수된다. 도는 동안 되풀이해야 한다',
  )
  assert.match(
    drain, /heartbeatIntervalMs\s*\(/,
    '간격을 여기서 따로 적고 있다. 좀비 창과 간격은 한 곳(drain-policy)에서 와야 한다',
  )
})

test('★ 끝나면 반드시 끈다 — 안 끄면 끝난 잡의 잠금을 계속 찍어 회수가 영영 안 된다', () => {
  assert.match(
    drain, /finally\s*\{[\s\S]{0,200}clearInterval/,
    'finally 에서 끄지 않는다. 단계가 던지면 타이머가 살아남는다',
  )
})

test('찍는 워커 이름이 집을 때와 같다 — 다르면 내 잠금을 내가 못 찍는다', () => {
  // claimJobs 에 넘긴 값과 touchJobLock 에 넘기는 값이 같은 변수여야 한다.
  const m = drain.match(/const\s+(\w+)\s*=\s*workerId\(prefix\)/)
  assert.ok(m, '워커 이름을 변수에 담지 않고 있다. 그러면 부를 때마다 새 이름이 생긴다')
  const name = m![1]
  assert.match(drain, new RegExp(`claimJobs\\([^)]*\\b${name}\\b`), `claimJobs 가 ${name} 를 안 쓴다`)
  assert.match(drain, new RegExp(`touchJobLock\\([^)]*\\b${name}\\b`), `touchJobLock 이 ${name} 를 안 쓴다`)
})
