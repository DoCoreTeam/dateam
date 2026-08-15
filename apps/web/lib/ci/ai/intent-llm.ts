// lib/ci/ai/intent-llm.ts — 규칙이 못 알아들은 말을 LLM이 커맨드로 옮긴다 (순수 함수)
//
// 왜 필요한가: 어시스턴트는 정규식만 봤다. 목록에 없는 표현이면 무조건
// "무슨 말인지 잘 모르겠어요"였다. 사용자가 "AI 어시스턴트는 아예 말을 안듣는다"고
// 한 것이 이 지점이다 — 화면은 자연어를 받는 것처럼 생겼는데 실제로는 키워드 검색이었다.
//
// 설계 원칙 셋:
//   1) **규칙이 먼저다.** 흔한 말은 LLM 없이 즉시 처리한다(빠르고 공짜고 결정론적).
//      LLM은 규칙이 실패했을 때만 부른다.
//   2) **카탈로그 밖은 없다.** LLM이 무슨 이름을 지어내든 COMMANDS에 없으면 버린다.
//      환각한 커맨드를 실행하는 것이 최악이다.
//   3) **위험 등급은 LLM이 못 바꾼다.** guarded는 여전히 제안까지만 —
//      말로 시켜서 되돌리기 어려운 일이 일어나는 길을 열지 않는다.

import { COMMANDS, getCommand } from './assistant.ts'
import type { Intent } from './assistant.ts'

/** LLM이 args로 넘길 수 있는 키. 이 밖의 키는 버린다(프롬프트 인젝션으로 인자를 밀어 넣지 못하게). */
const ALLOWED_ARG_KEYS = new Set(['windowDays', 'urls', 'input', 'title', 'query'])

/** 기간 인자의 허용 범위. LLM이 3650을 주면 전 코퍼스를 긁는 질의가 된다. */
const MIN_WINDOW_DAYS = 1
const MAX_WINDOW_DAYS = 365

const MAX_MESSAGE_CHARS = 500
const MAX_SAY_CHARS = 120

/**
 * 커맨드 카탈로그를 프롬프트에 실을 형태로 편다.
 * 설명을 그대로 넘긴다 — 카탈로그가 늘면 프롬프트도 자동으로 는다(두 곳을 고칠 일이 없다).
 */
export function buildIntentPrompt(message: string): string {
  const catalog = COMMANDS
    .filter((c) => !c.assistantBlocked)
    .map((c) => `- ${c.name} (${c.risk}): ${c.description}`)
    .join('\n')

  return [
    '너는 콘텐츠 분석 도구의 명령 해석기다.',
    '사용자의 한국어 문장을 아래 목록의 커맨드 **하나**로 옮겨라.',
    '',
    '## 고를 수 있는 커맨드',
    catalog,
    '',
    '## 규칙',
    '- 목록에 있는 이름만 쓴다. 새 이름을 지어내지 않는다.',
    '- 어느 것에도 해당하지 않으면 command를 null로 둔다. **억지로 고르지 않는다.**',
    '- args는 필요할 때만 넣는다. windowDays는 정수 일수(예: 7, 28, 90).',
    '- say는 "무엇을 하겠다"를 사용자에게 알리는 한 문장. 존댓말.',
    '',
    '## 출력',
    'JSON만 출력한다. 설명·코드펜스 없이.',
    '{"command": "trends.outliers" | null, "args": {}, "say": "..."}',
    '',
    '## 사용자 문장',
    message.slice(0, MAX_MESSAGE_CHARS),
  ].join('\n')
}

function stripFence(raw: string): string {
  return raw.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function sanitizeArgs(raw: unknown): Record<string, string | number | boolean> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, string | number | boolean> = {}

  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_ARG_KEYS.has(k)) continue

    if (k === 'windowDays') {
      const n = Math.round(Number(v))
      // 범위를 벗어나면 **버린다.** 클램프하면 사용자가 말한 적 없는 기간으로 답하게 된다.
      if (Number.isFinite(n) && n >= MIN_WINDOW_DAYS && n <= MAX_WINDOW_DAYS) out[k] = n
      continue
    }
    if (typeof v === 'string') {
      const s = v.trim()
      if (s) out[k] = s.slice(0, 500)
      continue
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
    else if (typeof v === 'boolean') out[k] = v
  }
  return out
}

/**
 * LLM 응답 → 검증된 Intent. 조금이라도 미심쩍으면 null.
 *
 * null을 돌려주는 것은 실패가 아니라 **정상 동작**이다 —
 * 호출자는 "무슨 말인지 모르겠다"고 정직하게 답하면 된다.
 * 억지로 커맨드를 만들어 엉뚱한 화면을 여는 쪽이 훨씬 나쁘다.
 */
export function parseIntentResponse(raw: string): Intent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const obj = parsed as Record<string, unknown>
  const name = typeof obj.command === 'string' ? obj.command.trim() : ''
  if (!name) return null

  // 카탈로그 밖 이름은 전부 버린다 — 환각 차단선이다.
  const spec = getCommand(name)
  if (!spec || spec.assistantBlocked) return null

  const say = typeof obj.say === 'string' && obj.say.trim()
    ? obj.say.trim().slice(0, MAX_SAY_CHARS)
    : spec.description

  return { command: name, args: sanitizeArgs(obj.args), say }
}
