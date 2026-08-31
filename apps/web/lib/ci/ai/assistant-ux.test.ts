// lib/ci/ai/assistant-ux.test.ts — 어시스턴트가 «먹통»으로 보이지 않게 하는 가드
//
// 실측(2026-08-31): 자유 문장을 넣으면 AI 응답이 2초~60초를 오갔는데 패널에는
// 로딩 표시가 한 줄도 없었다. `busy` 는 버튼만 비활성화했고 화면은 처음 인사말
// 그대로였다. 그리고 60초 뒤 뜬 문장은 서버 오류 봉투와 **글자까지 같아**
// 어느 쪽에서 끊긴 것인지 아무도 구분할 수 없었다.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseIntent, getCommand, isExecutable } from './assistant.ts'

// here = apps/web/lib/ci/ai → 다섯 단계 올라가야 저장소 루트다
const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(here, '..', '..', '..', '..', '..', rel), 'utf8')

const PANEL = 'apps/web/components/ci/AssistantPanel.tsx'
const SERVER = 'apps/web/lib/ci/ai/assistant-server.ts'
const GEMINI = 'apps/web/lib/ci/ai/gemini.ts'

test('★ 기다리는 동안 화면이 기다린다고 말한다 — 침묵은 고장으로 읽힌다', () => {
  const src = read(PANEL)
  assert.match(src, /\{busy && \(/, 'busy 일 때 그리는 블록이 없다')
  assert.match(src, /생각하는 중/)
  assert.match(src, /초 지남/, '몇 초째인지 안 보이면 멈춘 것과 구분되지 않는다')
})

test('★ 화면이 스스로 끊는다 — 연결이 죽어도 「생각하는 중…」이 남으면 안 된다', () => {
  const src = read(PANEL)
  assert.match(src, /AbortController/)
  assert.match(src, /REQUEST_TIMEOUT_MS/)
  assert.match(src, /signal: ctl\.signal/)
})

test('★ 화면 상한이 서버 AI 상한보다 넉넉하다 — 서버가 준비한 답을 뺏으면 안 된다', () => {
  const panel = read(PANEL)
  const server = read(SERVER)
  const panelMs = Number(panel.match(/REQUEST_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ''))
  const serverMs = Number(server.match(/INTENT_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ''))
  assert.ok(panelMs > serverMs, `화면(${panelMs}) 이 서버(${serverMs}) 보다 커야 한다`)
})

test('★ AI 상한이 60초가 아니다 — 60초를 기다린 끝의 실패는 실패보다 나쁘다', () => {
  const server = read(SERVER)
  const ms = Number(server.match(/INTENT_TIMEOUT_MS = ([\d_]+)/)![1].replace(/_/g, ''))
  assert.ok(ms > 0 && ms <= 30_000, `상한이 ${ms}ms 다 — 사람이 기다릴 수 있는 범위를 넘는다`)
})

test('★ 실패 사유를 구분해서 말한다 — 뭉개면 사용자는 언제나 자기 문장을 의심한다', () => {
  const server = read(SERVER)
  for (const kind of ['not_understood', 'ai_timeout', 'ai_unavailable']) {
    assert.ok(server.includes(kind), `실패 사유 ${kind} 가 없다`)
  }
  const panel = read(PANEL)
  assert.match(panel, /aborted \? / , '화면도 시간 초과와 연결 끊김을 갈라야 한다')
})

test('★ 실패했을 때 같은 문장을 다시 치게 하지 않는다', () => {
  assert.match(read(PANEL), /다시 보내기/)
})

test('★ 명령 해석은 생각을 최소로 부른다 — 목록에서 하나 고르는 일이다', () => {
  const server = read(SERVER)
  assert.match(server, /thinkingLevel: 'low'/)
  const gemini = read(GEMINI)
  assert.match(gemini, /thinkingConfig/, '요청 본문에 안 실으면 옵션이 아무 일도 안 한다')
})

test('★ 지정하지 않은 호출은 요청 본문이 예전 그대로다 — 영상 이해가 얕게 생각하면 안 된다', () => {
  const gemini = read(GEMINI)
  assert.match(gemini, /input\.thinkingLevel \? \{ thinkingConfig/,
    '조건 없이 실으면 모든 호출의 생각 수준이 바뀐다')
})

test('★ AI 실패를 로그에 남긴다 — 화면에도 로그에도 안 남으면 2주가 지나도 모른다', () => {
  assert.match(read(SERVER), /recordSystemEventAsync\(/)
})

// ── 「추성훈 채널 신규 컨텐츠 올라왔어?」가 실제로 답을 얻는가 ──────

test('★ 그 질문이 규칙에서 바로 잡힌다 — AI 를 부르지 않고 즉답한다', () => {
  const intent = parseIntent('추성훈 채널 신규 컨텐츠 올라왔어?')
  assert.ok(intent, '규칙이 못 잡으면 다시 2~60초짜리 AI 호출로 내려간다')
  assert.equal(intent!.command, 'channels.latest')
  assert.equal(intent!.args.query, '추성훈', '채널 이름을 「채널」 앞자리에서 읽는다')
})

test('그 명령이 카탈로그에 실재하고 실행 가능하다 — 없으면 AI 가 null 을 낼 수밖에 없다', () => {
  assert.ok(getCommand('channels.latest'), '카탈로그에 없으면 LLM 도 고를 수 없다')
  assert.equal(isExecutable('channels.latest'), true)
})

test('채널 이름을 안 말하면 관심 채널 전체를 본다 — 문장 전체를 이름으로 삼지 않는다', () => {
  const intent = parseIntent('새 영상 올라온 거 있어?')
  assert.equal(intent!.command, 'channels.latest')
  assert.equal(intent!.args.query, undefined)
})

test('★ 「관심 채널 목록」은 여전히 목록이다 — 새 규칙이 기존 답을 가로채지 않는다', () => {
  assert.equal(parseIntent('관심 채널 목록')!.command, 'channels.list')
  assert.equal(parseIntent('이번 주 떡상 보여줘')!.command, 'trends.outliers')
  assert.equal(parseIntent('수집함 보여줘')!.command, 'inbox.list')
  assert.equal(parseIntent('성공 공식')!.command, 'trends.patterns')
})

test('★ 실행부가 실재한다 — 명령만 늘리면 「모르겠다」로 떨어진다', () => {
  const server = read(SERVER)
  assert.match(server, /case 'channels\.latest'/)
  assert.match(server, /마지막 수집/, '언제 훑었는지 없으면 0건의 뜻을 알 수 없다')
})
