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
import { DISCOVERY_PROMPT_VERSION } from '../analysis/contrast-key.ts'
import { DEFAULT_MAX_SETS } from '../analysis/discovery.ts'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CAPTION_CHARS, buildFindingPrompt } from './discover-prompt.ts'

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

/*
  프롬프트 길이 (P0030 I12)

  실측 2026-09-20: 사흘 50,243건 중 97.6% 가 이 발견 호출이었고, 입력 한 건이 평균 770토큰이었다.
  같은 것을 두 번 묻지 않게 만든 뒤(I04·I05)에도 «처음 한 번»의 값은 그대로 남으므로,
  한 번의 입력을 줄이는 것이 남은 절감분이다.

  설명 원문이 400자였다. 대조쌍 하나에 콘텐츠가 넷이니 설명만 최대 1,600자다.
  찾는 것은 잘된 하나에만 있는 차이인데, 유튜브 설명은 뒤쪽이 해시태그와 링크라
  뒤를 더 보낸다고 차이가 더 보이지 않는다.
*/
test('★ 설명 원문이 120자를 넘지 않는다 — 넷이 들어가므로 네 배로 붙는다', () => {
  assert.equal(CAPTION_CHARS, 120)
  const 긴설명 = '가'.repeat(2000)
  const set = {
    winner: { contentId: 'w', title: '제목', caption: 긴설명, durationSec: 60, publishedAt: '2026-09-01', outlierIndex: 3 },
    peers: [1, 2, 3].map((i) => ({
      contentId: `p${i}`, title: `평범 ${i}`, caption: 긴설명,
      durationSec: 60, publishedAt: '2026-09-01', outlierIndex: 1,
    })),
  } as never
  const prompt = buildFindingPrompt(set)
  const 설명들 = [...prompt.matchAll(/^설명: (.*)$/gm)].map((m) => m[1])
  assert.equal(설명들.length, 4, '대조쌍의 설명 넷이 다 안 들어갔다')
  for (const d of 설명들) {
    assert.ok(d.length <= CAPTION_CHARS, `설명이 ${d.length}자다. 상한이 안 걸렸다`)
  }
})

test('★ 같은 대조쌍의 프롬프트가 예전보다 짧다 — 수치로 확인한다', () => {
  const 긴설명 = '나'.repeat(2000)
  const 한건 = (id: string, idx: number) => ({
    contentId: id, title: `제목 ${id}`, caption: 긴설명,
    durationSec: 60, publishedAt: '2026-09-01', outlierIndex: idx,
  })
  const set = { winner: 한건('w', 3), peers: [한건('p1', 1), 한건('p2', 1), 한건('p3', 1)] } as never
  const 지금 = buildFindingPrompt(set).length
  const 예전 = 지금 + (400 - CAPTION_CHARS) * 4   // 설명 상한만 달랐다
  /*
    실측(설명이 상한을 꽉 채우는 경우): 2,397자 → 1,277자, 47% 감소.
    한국어를 대략 1.5자/토큰으로 보면 1,598토큰 → 851토큰이다.
    숫자를 여기 적어 두는 이유는, 다음에 프롬프트를 늘리는 사람이 무엇을 되돌리는지
    알게 하기 위함이다 — 「조금 더 보내자」가 모이면 원래대로 돌아간다.
  */
  assert.ok(지금 < 예전, `안 줄었다 (예전 ${예전} / 지금 ${지금})`)
  assert.ok(
    지금 / 예전 < 0.6,
    `${Math.round((1 - 지금 / 예전) * 100)}% 만 줄었다. 설명이 프롬프트의 절반이던 상태와 다를 것이 없다`,
  )
})

test('★ 프롬프트를 고쳤으면 판 번호가 올라가 있다 — 안 올리면 옛 답이 계속 나온다', () => {
  assert.ok(
    DISCOVERY_PROMPT_VERSION >= 2,
    '보내는 글을 줄였는데 판 번호가 1 이다. 저장된 옛 답이 새 프롬프트의 답인 척한다',
  )
})

test('★ 표본 수는 그대로다 — 줄이면 승격이 0건이 된 실측이 있다', () => {
  assert.equal(DEFAULT_MAX_SETS, 30, '주제당 표본을 바꿨다. 30건은 실측으로 정해진 값이다')
})

test('★ 출력 상한을 숫자로 박지 않고 능력이 정한다', () => {
  const src = readFileSync(join(process.cwd(), 'lib/ci/ai/discover-server.ts'), 'utf8')
  assert.ok(!/maxOutputTokens:\s*400/.test(src), '잘림이 나던 400 이 아직 박혀 있다')
  assert.match(src, /capability: 'suggest'/, '능력을 안 넘겨 상한이 예전 기본값으로 간다')
})
