/**
 * 발견이 저장된 답을 쓰는가 (P0030 I05)
 *
 * ## 왜 소스를 읽는가
 *
 * discover-server.ts 는 Supabase 와 Gemini 를 끌어와 여기서 못 부른다. 규칙 자체
 * (무엇이 같은 질문인가)는 순수 계층에서 contrast-key.test.ts 가 값으로 확인하므로,
 * 여기서 잠글 것은 **배선**이다. 지문을 만들고, 저장을 먼저 보고, 없는 것만 묻고,
 * 받은 답을 적는 순서가 한 군데라도 빠지면 절감이 통째로 사라진다.
 *
 * ## 무엇을 막는가
 *
 * 대조쌍의 입력은 수집이 끝나면 변하지 않고 호출은 temperature 0 이다. 같은 묶음에는
 * 같은 답이 온다. 그런데 답을 두는 자리가 없어 매번 처음부터 다시 물었다.
 *
 * 실측 2026-09-20: 서로 다른 질문이 최대 624개인데 사흘 동안 49,064번 물었다(78.6배).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
const src = strip(readFileSync(join(process.cwd(), 'lib/ci/ai/discover-server.ts'), 'utf8'))
const store = strip(readFileSync(join(process.cwd(), 'lib/ci/ai/discovery-answers.ts'), 'utf8'))
const stages = strip(readFileSync(join(process.cwd(), 'lib/ci/jobs/stages.ts'), 'utf8'))

/** 벤더를 실제로 부르는 반복문 본문 */
function askLoop(): string {
  const at = src.indexOf('for (const { set, key } of fresh)')
  assert.notEqual(at, -1, '물어보는 반복문이 fresh 를 돌지 않는다')
  return src.slice(at)
}

test('★ 묻기 전에 저장을 먼저 본다', () => {
  const loadAt = src.indexOf('loadAnswers(')
  const askAt = src.indexOf('for (const { set, key } of fresh)')
  assert.notEqual(loadAt, -1, '저장된 답을 안 읽는다')
  assert.ok(loadAt < askAt, '읽기가 묻기보다 뒤에 있다. 그러면 읽어도 소용이 없다')
})

test('★ 저장에 있는 묶음은 벤더에 안 간다 — fresh 만 돈다', () => {
  assert.match(src, /splitByKnown\s*\(/, '아는 것과 물을 것을 가르지 않는다')
  const loop = askLoop()
  assert.match(loop, /callGeminiJson\s*\(/, '반복문 안에서 벤더를 불러야 한다')
  // cached 를 도는 반복문에서는 벤더를 부르면 안 된다
  const cachedAt = src.indexOf('for (const { set, answer } of cached)')
  assert.notEqual(cachedAt, -1, '저장된 답을 담는 반복문이 없다')
  const cachedLoop = src.slice(cachedAt, src.indexOf('\n  }', cachedAt))
  assert.ok(
    !/callGeminiJson/.test(cachedLoop),
    '저장된 답을 쓰면서도 벤더를 부른다. 그러면 저장한 의미가 없다',
  )
})

test('★ 새로 물을 것이 없으면 묶기 호출도 안 하고 끝낸다', () => {
  const at = src.indexOf('if (fresh.length === 0)')
  assert.notEqual(at, -1, '물을 것이 없을 때 빠져나가는 길이 없다')
  const clusterAt = src.indexOf('ci-discover-cluster')
  assert.ok(
    at < clusterAt,
    '빠져나가는 자리가 묶기 호출보다 뒤에 있다. 아무것도 안 바뀐 날에도 AI 를 한 번 더 쓴다',
  )
  assert.match(src.slice(at, at + 300), /unchanged:\s*true/, '안 바뀌었다는 사실을 안 올린다')
})

test('★ 받은 답을 적는다 — 못 찾았다도 적는다', () => {
  const loop = askLoop()
  assert.match(loop, /saveAnswer\s*\(/, '받은 답을 저장하지 않는다. 다음번에 또 묻게 된다')

  const saveAt = loop.indexOf('saveAnswer(')
  const skipAt = loop.indexOf('if (!answer.found) continue')
  assert.notEqual(skipAt, -1, '못 찾은 답을 건너뛰는 자리가 없다')
  assert.ok(
    saveAt < skipAt,
    '못 찾았을 때 저장보다 먼저 건너뛴다. '
    + '「없다」를 확인하는 데도 호출 한 번이 들었는데, 안 적으면 그 묶음만 영원히 다시 묻는다',
  )
})

test('★ 지문에 프롬프트 판 번호가 실려 저장된다 — 질문을 바꾸면 다시 묻는다', () => {
  assert.match(src, /contrastKey\s*\(/, '지문을 안 만든다')
  assert.match(askLoop(), /promptVersion:\s*DISCOVERY_PROMPT_VERSION/, '판 번호를 안 적는다')
})

test('저장 실패가 발견을 죽이지 않는다', () => {
  for (const [name, body] of [['loadAnswers', store], ['saveAnswer', store]] as const) {
    const at = body.indexOf(`export async function ${name}`)
    assert.notEqual(at, -1, `${name} 이 없다`)
    assert.match(
      body.slice(at, at + 1600), /catch/,
      `${name} 이 던진다. 저장 하나가 삐끗했다고 발견 기능 전체가 죽으면 안 된다`,
    )
  }
  assert.match(
    store, /if \(error\)/,
    'supabase-js 는 오류를 던지지 않고 돌려준다. 안 읽으면 조용히 0건이 된다',
  )
})

test('★ 안 바뀐 주제는 저장된 발견을 건드리지 않는다', () => {
  // runDiscovery 본문만 본다 — runPatterns 도 보관 처리를 하므로 파일 전체를 훑으면
  // 엉뚱한 자리를 잡는다
  const start = stages.indexOf('export async function runDiscovery(')
  assert.notEqual(start, -1, 'runDiscovery 를 찾지 못했다')
  const end = stages.indexOf('export async function', start + 10)
  const body = stages.slice(start, end === -1 ? undefined : end)

  const at = body.indexOf('found.unchanged')
  assert.notEqual(at, -1, '안 바뀐 경우를 구분하지 않는다')
  const archiveAt = body.indexOf('is_archived: true')
  assert.notEqual(archiveAt, -1, 'runDiscovery 안에서 보관 처리를 찾지 못했다')
  assert.ok(
    at < archiveAt,
    '보관 처리보다 뒤에서 판단한다. 아무것도 안 바뀐 날에 발견이 이유 없이 뒤바뀐다',
  )
  assert.match(body.slice(at, at + 120), /continue/, '판단만 하고 건너뛰지 않는다')
})

test('AI 를 몇 번 썼고 몇 번을 아꼈는지 화면이 말할 수 있다', () => {
  assert.match(src, /asked:\s*number/, '물은 횟수를 안 돌려준다')
  assert.match(src, /cached:\s*number/, '아낀 횟수를 안 돌려준다')
  assert.match(stages, /AI \$\{askedTotal\}회/, '결과 문구에 숫자가 안 실린다')
})
