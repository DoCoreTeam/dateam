import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { buildIntentPrompt, parseIntentResponse } from './intent-llm.ts'
import { COMMANDS } from './assistant.ts'

const here = dirname(fileURLToPath(import.meta.url))

// ── 프롬프트 ─────────────────────────────────────────────────────────

test('프롬프트에 고를 수 있는 커맨드가 전부 실린다 — 목록에 없으면 LLM이 알 길이 없다', () => {
  const p = buildIntentPrompt('이번 주에 뭐가 잘 됐어?')
  for (const c of COMMANDS.filter((x) => !x.assistantBlocked)) {
    assert.ok(p.includes(c.name), `${c.name}이 프롬프트에 없다`)
  }
})

test('어시스턴트가 만지면 안 되는 커맨드는 프롬프트에서 아예 뺀다', () => {
  const p = buildIntentPrompt('워크스페이스 지워줘')
  for (const c of COMMANDS.filter((x) => x.assistantBlocked)) {
    assert.ok(!p.includes(c.name), `차단 커맨드 ${c.name}이 프롬프트에 노출됐다`)
  }
})

test('사용자 문장이 프롬프트에 들어가고, 과도한 길이는 잘린다', () => {
  assert.ok(buildIntentPrompt('요리 채널 최근 흐름').includes('요리 채널 최근 흐름'))
  const long = 'ㄱ'.repeat(2000)
  assert.ok(buildIntentPrompt(long).length < 1500 + long.length)
})

test('"모르면 null" 지시가 프롬프트에 있다 — 억지로 고르면 엉뚱한 화면이 열린다', () => {
  assert.match(buildIntentPrompt('아무말'), /억지로 고르지 않는다/)
})

// ── 응답 검증 ────────────────────────────────────────────────────────

test('정상 응답을 Intent로 옮긴다', () => {
  const i = parseIntentResponse('{"command":"trends.outliers","args":{"windowDays":7},"say":"보여드릴게요"}')
  assert.equal(i?.command, 'trends.outliers')
  assert.equal(i?.args.windowDays, 7)
  assert.equal(i?.say, '보여드릴게요')
})

test('코드펜스로 감싸 와도 파싱한다 — LLM이 자주 그런다', () => {
  const i = parseIntentResponse('```json\n{"command":"inbox.list","args":{},"say":"수집함이요"}\n```')
  assert.equal(i?.command, 'inbox.list')
})

test('★ 카탈로그에 없는 이름은 버린다 — 환각 커맨드 실행 차단', () => {
  assert.equal(parseIntentResponse('{"command":"workspace.wipe","args":{},"say":"지울게요"}'), null)
  assert.equal(parseIntentResponse('{"command":"trends","args":{},"say":"x"}'), null)
})

test('★ 어시스턴트 차단 커맨드는 LLM이 골라도 거부한다', () => {
  const blocked = COMMANDS.filter((c) => c.assistantBlocked)
  assert.ok(blocked.length > 0, '차단 커맨드가 하나도 없으면 이 가드는 의미가 없다')
  for (const c of blocked) {
    assert.equal(
      parseIntentResponse(`{"command":"${c.name}","args":{},"say":"할게요"}`),
      null,
      `${c.name}이 통과했다`,
    )
  }
})

test('command가 null·빈값이면 null — "모르겠다"가 정상 답이다', () => {
  assert.equal(parseIntentResponse('{"command":null,"args":{},"say":"모르겠어요"}'), null)
  assert.equal(parseIntentResponse('{"command":"","args":{},"say":"x"}'), null)
})

test('깨진 JSON·비객체는 null (예외로 죽지 않는다)', () => {
  assert.equal(parseIntentResponse('그냥 문장입니다'), null)
  assert.equal(parseIntentResponse('[1,2,3]'), null)
  assert.equal(parseIntentResponse('null'), null)
  assert.equal(parseIntentResponse(''), null)
})

test('★ 화이트리스트 밖 args는 버린다 — 문장으로 인자를 밀어 넣지 못하게', () => {
  const i = parseIntentResponse(
    '{"command":"trends.outliers","args":{"windowDays":7,"workspaceId":"남의워크스페이스","limit":9999},"say":"x"}',
  )
  assert.deepEqual(i?.args, { windowDays: 7 })
})

test('기간이 범위를 벗어나면 그 인자를 버린다 — 클램프하면 말한 적 없는 기간으로 답하게 된다', () => {
  assert.deepEqual(parseIntentResponse('{"command":"trends.outliers","args":{"windowDays":3650},"say":"x"}')?.args, {})
  assert.deepEqual(parseIntentResponse('{"command":"trends.outliers","args":{"windowDays":0},"say":"x"}')?.args, {})
  assert.deepEqual(parseIntentResponse('{"command":"trends.outliers","args":{"windowDays":-5},"say":"x"}')?.args, {})
  assert.deepEqual(parseIntentResponse('{"command":"trends.outliers","args":{"windowDays":365},"say":"x"}')?.args, { windowDays: 365 })
})

test('say가 비면 커맨드 설명으로 채운다 — 빈 말풍선을 띄우지 않는다', () => {
  const i = parseIntentResponse('{"command":"inbox.list","args":{}}')
  assert.ok(i?.say && i.say.length > 0)
})

test('args가 배열·문자열이어도 빈 객체로 안전하게 떨어진다', () => {
  assert.deepEqual(parseIntentResponse('{"command":"inbox.list","args":[1,2],"say":"x"}')?.args, {})
  assert.deepEqual(parseIntentResponse('{"command":"inbox.list","args":"nope","say":"x"}')?.args, {})
})

// ── 배선 가드 ────────────────────────────────────────────────────────

test('가드: 어시스턴트가 규칙 실패 시 LLM을 실제로 부른다 — 만들어놓고 안 부르면 그대로다', () => {
  const src = readFileSync(join(here, 'assistant-server.ts'), 'utf8')
  assert.match(src, /parseIntent\(input\.message\)/, '규칙 파서를 먼저 부르지 않는다')
  // 한 줄이든 블록이든 «규칙이 실패했을 때만 LLM 을 부른다»가 지켜지면 된다.
  // 문법을 그대로 요구하면, 실패 사유를 함께 받으려고 블록으로 바꾸는 순간 가드가 깨진다.
  assert.match(src, /if \(!intent\)[\s\S]{0,200}?resolveIntentWithLlm\(input\.message\)/,
    'LLM 폴백이 규칙 실패 자리에 배선돼 있지 않다')
  assert.match(src, /parseIntentResponse\(/, '응답 검증(환각 차단)을 거치지 않는다')
})

test('가드: LLM이 골라도 위험 등급 판정은 그대로 거친다', () => {
  const src = readFileSync(join(here, 'assistant-server.ts'), 'utf8')
  const llmAt = src.indexOf('resolveIntentWithLlm(input.message)')
  const gateAt = src.indexOf('isExecutable(intent.command)')
  assert.ok(llmAt > 0 && gateAt > llmAt, 'LLM 결과가 실행 가능 판정을 건너뛴다')
})

test('가드: 온도 0 — 같은 질문에 같은 답이 나와야 사용자가 학습한다', () => {
  const src = readFileSync(join(here, 'assistant-server.ts'), 'utf8')
  assert.match(src, /temperature:\s*0\b/)
})
